import io
import logging

import httpx
import paramiko
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.models.vm import VMCreate, VMDefinition, VMUpdate
from app.services.git_service import GitService
from app.services.node_store import NodeStore
from app.services.secret_store import SecretStore
from app.services.vm_store import VMStore

logger = logging.getLogger(__name__)

router = APIRouter()


def get_store() -> VMStore:
    return VMStore(settings.homelab_repo_path)


def get_git() -> GitService:
    return GitService(settings.homelab_repo_path)


def get_node_store() -> NodeStore:
    return NodeStore(settings.homelab_repo_path)


def get_secret_store() -> SecretStore:
    return SecretStore(settings.homelab_repo_path)


def _validate_node(node: str, node_store: NodeStore) -> None:
    """Ensure node matches an enabled node."""
    nodes = node_store.list_all()
    valid_nodes = {n.name for n in nodes if n.enabled}
    if node not in valid_nodes:
        raise HTTPException(
            status_code=400,
            detail=f"No node configured for '{node}'",
        )


def _validate_gpu_passthrough(
    vm_name: str, node: str, gpu_passthrough: bool, store: VMStore,
) -> None:
    """Ensure only one VM per node has iGPU passthrough enabled."""
    if not gpu_passthrough:
        return
    for vm in store.list_all():
        if vm.name == vm_name:
            continue
        if vm.enabled and vm.node == node and vm.gpu_passthrough:
            raise HTTPException(
                status_code=409,
                detail=f"iGPU passthrough already assigned to '{vm.name}' on {node}. Only one VM per host is allowed.",
            )


@router.get("/")
async def list_vms(store: VMStore = Depends(get_store)) -> list[VMDefinition]:
    return store.list_all()


@router.post("/", status_code=201)
async def create_vm(
    body: VMCreate,
    store: VMStore = Depends(get_store),
    git: GitService = Depends(get_git),
    node_store: NodeStore = Depends(get_node_store),
) -> VMDefinition:
    _validate_node(body.node, node_store)
    try:
        store.get(body.name)
        raise HTTPException(status_code=409, detail=f"VM '{body.name}' already exists")
    except HTTPException as e:
        if e.status_code != 404:
            raise

    _validate_gpu_passthrough(body.name, body.node, body.gpu_passthrough, store)
    vm = VMDefinition(**body.model_dump())
    store.write(vm)
    git.commit_all(f"[terraform] add: {body.name} on {body.node}")
    return vm


# ---------------------------------------------------------------------------
# Discover & import VMs from Proxmox
# ---------------------------------------------------------------------------


class DiscoveredVM(BaseModel):
    name: str
    vmid: int
    status: str  # running, stopped, etc.
    cpu: int
    memory: int  # in MB
    disk: int  # in GB
    ip: str


def _proxmox_headers(node, secret_store: SecretStore) -> dict:
    """Build Proxmox API auth headers."""
    try:
        token_secret = secret_store.get(f"proxmox/{node.name}/token_secret")
    except Exception:
        raise HTTPException(502, f"No API token configured for node '{node.name}'")
    api_token = f"{node.username}!{node.token_name}={token_secret}"
    return {"Authorization": f"PVEAPIToken={api_token}"}


@router.get("/discover/{node_name}")
async def discover_vms(
    node_name: str,
    node_store: NodeStore = Depends(get_node_store),
    secret_store: SecretStore = Depends(get_secret_store),
    vm_store: VMStore = Depends(get_store),
) -> list[DiscoveredVM]:
    """List VMs on a Proxmox node that are not yet in Rootstock."""
    node = node_store.get(node_name)
    headers = _proxmox_headers(node, secret_store)
    base = node.endpoint.rstrip("/")

    existing_names = {vm.name for vm in vm_store.list_all()}

    async with httpx.AsyncClient(verify=False, timeout=15.0) as client:
        r = await client.get(
            f"{base}/api2/json/nodes/{node.node_name}/qemu",
            headers=headers,
        )
        if r.status_code != 200:
            raise HTTPException(502, f"Proxmox API error: {r.status_code}")

        pve_vms = r.json().get("data", [])
        discovered: list[DiscoveredVM] = []

        for pve_vm in pve_vms:
            vm_name = pve_vm.get("name", "")
            if not vm_name or vm_name in existing_names:
                continue

            vmid = pve_vm.get("vmid", 0)
            status = pve_vm.get("status", "unknown")
            cpus = pve_vm.get("cpus") or pve_vm.get("maxcpu", 1)
            mem_bytes = pve_vm.get("maxmem", 0)
            mem_mb = mem_bytes // (1024 * 1024) if mem_bytes > 1024 else mem_bytes
            disk_bytes = pve_vm.get("maxdisk", 0)
            disk_gb = disk_bytes // (1024 * 1024 * 1024) if disk_bytes > 1024 else disk_bytes

            # Try to discover IP
            ip = ""
            if status == "running":
                try:
                    r2 = await client.get(
                        f"{base}/api2/json/nodes/{node.node_name}/qemu/{vmid}/agent/network-get-interfaces",
                        headers=headers,
                    )
                    if r2.status_code == 200:
                        interfaces = r2.json().get("data", {}).get("result", [])
                        for iface in interfaces:
                            if iface.get("name") == "lo":
                                continue
                            for addr in iface.get("ip-addresses", []):
                                if addr.get("ip-address-type") == "ipv4":
                                    candidate = addr.get("ip-address", "")
                                    if candidate and not candidate.startswith("127."):
                                        ip = candidate
                                        break
                            if ip:
                                break
                except Exception:
                    pass

                # Fallback: cloud-init config
                if not ip:
                    try:
                        r3 = await client.get(
                            f"{base}/api2/json/nodes/{node.node_name}/qemu/{vmid}/config",
                            headers=headers,
                        )
                        if r3.status_code == 200:
                            config = r3.json().get("data", {})
                            for key in ["ipconfig0", "ipconfig1"]:
                                ipconfig = config.get(key, "")
                                if "ip=" in ipconfig:
                                    for part in ipconfig.split(","):
                                        if part.startswith("ip="):
                                            candidate = part.split("=")[1].split("/")[0]
                                            if candidate and not candidate.startswith("127."):
                                                ip = candidate
                                                break
                                if ip:
                                    break
                    except Exception:
                        pass

            discovered.append(DiscoveredVM(
                name=vm_name, vmid=vmid, status=status,
                cpu=cpus, memory=mem_mb, disk=disk_gb, ip=ip,
            ))

    return sorted(discovered, key=lambda v: v.name)


class ImportVMRequest(BaseModel):
    name: str
    node: str
    ip: str = ""
    cpu: int = 2
    memory: int = 4096
    disk: int = 32
    user: str = "deploy"
    ssh_private_key: str = ""  # PEM private key for SSH
    roles: list[str] = []


class SSHTestResult(BaseModel):
    success: bool
    detail: str


class SSHTestRequest(BaseModel):
    host: str
    user: str
    private_key: str


class SetupSSHKeyRequest(BaseModel):
    host: str
    user: str
    password: str


class SetupSSHKeyResult(BaseModel):
    success: bool
    detail: str
    private_key: str = ""


@router.post("/setup-ssh-key")
async def setup_ssh_key(body: SetupSSHKeyRequest) -> SetupSSHKeyResult:
    """Generate an Ed25519 key pair, deploy it to the VM via password auth."""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives import serialization

    # Generate key pair via cryptography lib
    priv = Ed25519PrivateKey.generate()
    private_pem = priv.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.OpenSSH,
        serialization.NoEncryption(),
    ).decode()

    # Load into paramiko to extract public key
    key = paramiko.Ed25519Key.from_private_key(io.StringIO(private_pem))
    pub_line = f"{key.get_name()} {key.get_base64()} rootstock@{body.host}"

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            hostname=body.host, username=body.user, password=body.password,
            timeout=10, look_for_keys=False, allow_agent=False,
        )
        # Deploy public key to authorized_keys
        cmd = (
            f"mkdir -p ~/.ssh && chmod 700 ~/.ssh && "
            f"echo '{pub_line}' >> ~/.ssh/authorized_keys && "
            f"chmod 600 ~/.ssh/authorized_keys"
        )
        _, stdout, stderr = client.exec_command(cmd, timeout=10)
        exit_code = stdout.channel.recv_exit_status()
        if exit_code != 0:
            err = stderr.read().decode().strip()
            return SetupSSHKeyResult(success=False, detail=f"Failed to deploy key: {err}")

        return SetupSSHKeyResult(success=True, detail=f"Key deployed to {body.user}@{body.host}", private_key=private_pem)
    except paramiko.AuthenticationException:
        return SetupSSHKeyResult(success=False, detail="Password authentication failed")
    except Exception as e:
        return SetupSSHKeyResult(success=False, detail=str(e))
    finally:
        client.close()


@router.post("/test-ssh")
async def test_ssh(body: SSHTestRequest) -> SSHTestResult:
    """Test SSH connectivity to a VM."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        try:
            pkey = paramiko.Ed25519Key.from_private_key(io.StringIO(body.private_key))
        except Exception:
            pkey = paramiko.RSAKey.from_private_key(io.StringIO(body.private_key))

        client.connect(
            hostname=body.host, username=body.user, pkey=pkey,
            timeout=10, look_for_keys=False, allow_agent=False,
        )
        _, stdout, _ = client.exec_command("hostname", timeout=5)
        hostname = stdout.read().decode().strip()
        return SSHTestResult(success=True, detail=f"Connected to {body.user}@{body.host} (hostname: {hostname})")
    except paramiko.AuthenticationException:
        return SSHTestResult(success=False, detail="Authentication failed — check username and private key")
    except Exception as e:
        return SSHTestResult(success=False, detail=str(e))
    finally:
        client.close()


@router.post("/import")
async def import_vm(
    body: ImportVMRequest,
    store: VMStore = Depends(get_store),
    git: GitService = Depends(get_git),
    node_store: NodeStore = Depends(get_node_store),
    secret_store: SecretStore = Depends(get_secret_store),
) -> VMDefinition:
    """Import an existing Proxmox VM into Rootstock."""
    _validate_node(body.node, node_store)

    try:
        store.get(body.name)
        raise HTTPException(409, f"VM '{body.name}' already exists")
    except HTTPException as e:
        if e.status_code != 404:
            raise

    # Store SSH private key if provided
    ssh_key_ref = ""
    if body.ssh_private_key.strip():
        private_path = f"ssh/{body.name}/private_key"
        public_path = f"ssh/{body.name}/public_key"
        secret_store.set(private_path, body.ssh_private_key.strip())

        # Derive public key from private key
        try:
            try:
                pkey = paramiko.Ed25519Key.from_private_key(io.StringIO(body.ssh_private_key))
            except Exception:
                pkey = paramiko.RSAKey.from_private_key(io.StringIO(body.ssh_private_key))
            pub = f"{pkey.get_name()} {pkey.get_base64()}"
            secret_store.set(public_path, pub)
        except Exception:
            pass  # Just store private, skip public derivation

        ssh_key_ref = public_path

    vm = VMDefinition(
        name=body.name,
        enabled=True,
        node=body.node,
        ip=body.ip,
        cpu=body.cpu,
        memory=body.memory,
        disk=body.disk,
        user=body.user,
        ssh_key=ssh_key_ref,
        roles=body.roles,
    )
    store.write(vm)
    git.commit_all(f"[vm] import: {body.name} on {body.node}")
    return vm


@router.get("/{name}")
async def get_vm(
    name: str,
    store: VMStore = Depends(get_store),
) -> VMDefinition:
    return store.get(name)


@router.patch("/{name}")
async def update_vm(
    name: str,
    body: VMUpdate,
    store: VMStore = Depends(get_store),
    git: GitService = Depends(get_git),
    node_store: NodeStore = Depends(get_node_store),
) -> VMDefinition:
    if body.node is not None:
        _validate_node(body.node, node_store)
    existing = store.get(name)
    updated_data = existing.model_dump()
    patch_data = body.model_dump(exclude_none=True)
    updated_data.update(patch_data)
    updated = VMDefinition(**updated_data)
    _validate_gpu_passthrough(name, updated.node, updated.gpu_passthrough, store)
    store.write(updated)
    git.commit_all(f"[terraform] update: {name}")
    return updated


@router.delete("/all", status_code=200)
async def delete_all_vms(
    store: VMStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> dict:
    count = store.delete_all()
    if count:
        git.commit_all(f"[terraform] destroy all VMs ({count})")
    return {"deleted": count}


@router.delete("/{name}", status_code=204)
async def delete_vm(
    name: str,
    store: VMStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> None:
    store.delete(name)
    git.commit_all(f"[terraform] destroy: {name}")
