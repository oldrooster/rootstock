import asyncio
import io
import json
import logging
import re

import httpx
import paramiko
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
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
    ssh_private_key: str = ""  # PEM private key for SSH; empty = unmanaged import
    roles: list[str] = []
    managed: bool = True


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

    managed = body.managed and bool(ssh_key_ref)  # unmanaged if no SSH key

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
        roles=body.roles if managed else [],
        managed=managed,
        provisioned=True,  # imported VMs already exist in Proxmox
    )
    store.write(vm)
    git.commit_all(f"[vm] import: {body.name} on {body.node} ({'managed' if managed else 'unmanaged'})")
    return vm


async def _find_vmid(name: str, node, headers: dict) -> int | None:
    """Return the VMID for a VM by name on a Proxmox node, or None."""
    base = node.endpoint.rstrip("/")
    async with httpx.AsyncClient(verify=False, timeout=15.0) as client:
        r = await client.get(
            f"{base}/api2/json/nodes/{node.node_name}/qemu",
            headers=headers,
        )
        for pve_vm in r.json().get("data", []):
            if pve_vm.get("name") == name:
                return int(pve_vm["vmid"])
    return None


@router.get("/{name}/status")
async def vm_status(
    name: str,
    store: VMStore = Depends(get_store),
    git: GitService = Depends(get_git),
    node_store: NodeStore = Depends(get_node_store),
    secret_store: SecretStore = Depends(get_secret_store),
) -> dict:
    """Return the current power status of a VM from the Proxmox API.
    Auto-heals provisioned=False if the VM is found live in Proxmox.
    """
    vm = store.get(name)
    node = node_store.get(vm.node)
    headers = _proxmox_headers(node, secret_store)
    base = node.endpoint.rstrip("/")
    async with httpx.AsyncClient(verify=False, timeout=15.0) as client:
        r = await client.get(
            f"{base}/api2/json/nodes/{node.node_name}/qemu",
            headers=headers,
        )
        for pve_vm in r.json().get("data", []):
            if pve_vm.get("name") == name:
                status = pve_vm.get("status", "unknown")
                vmid = pve_vm.get("vmid")
                # Auto-heal: VM exists in Proxmox but is still marked unprovisioned
                if not vm.provisioned and status in ("running", "stopped"):
                    vm.provisioned = True
                    store.write(vm)
                    git.commit_all(f"[terraform] mark '{name}' as provisioned (auto-heal)")
                return {"status": status, "vmid": vmid}
    return {"status": "unknown", "vmid": None}


POWER_ACTIONS = {"start", "stop", "shutdown", "reboot"}


@router.post("/{name}/power/{action}")
async def vm_power_action(
    name: str,
    action: str,
    store: VMStore = Depends(get_store),
    node_store: NodeStore = Depends(get_node_store),
    secret_store: SecretStore = Depends(get_secret_store),
) -> dict:
    """Execute a power action (start/stop/shutdown/reboot) on a VM via Proxmox API."""
    if action not in POWER_ACTIONS:
        raise HTTPException(400, f"Invalid action. Allowed: {', '.join(sorted(POWER_ACTIONS))}")
    vm = store.get(name)
    node = node_store.get(vm.node)
    headers = _proxmox_headers(node, secret_store)
    base = node.endpoint.rstrip("/")

    vmid = await _find_vmid(name, node, headers)
    if vmid is None:
        raise HTTPException(404, f"VM '{name}' not found on Proxmox node '{vm.node}'")

    async with httpx.AsyncClient(verify=False, timeout=15.0) as client:
        r = await client.post(
            f"{base}/api2/json/nodes/{node.node_name}/qemu/{vmid}/status/{action}",
            headers=headers,
        )
        if not r.is_success:
            detail = r.json().get("errors") or r.text
            raise HTTPException(502, f"Proxmox API error: {detail}")

    return {"ok": True, "action": action, "vmid": vmid}


@router.post("/{name}/clone", status_code=201)
async def clone_vm(
    name: str,
    new_name: str,
    store: VMStore = Depends(get_store),
    git: GitService = Depends(get_git),
    node_store: NodeStore = Depends(get_node_store),
) -> VMDefinition:
    """Duplicate a VM configuration with a new name."""
    from app.models.common import _validate_name
    _validate_name(new_name)
    source = store.get(name)
    try:
        store.get(new_name)
        raise HTTPException(409, f"VM '{new_name}' already exists")
    except HTTPException as e:
        if e.status_code != 404:
            raise
    data = source.model_dump()
    data["name"] = new_name
    data["provisioned"] = False  # clone starts unprovisioned
    cloned = VMDefinition(**data)
    store.write(cloned)
    git.commit_all(f"[terraform] clone: {name} -> {new_name}")
    return cloned


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


# ---------------------------------------------------------------------------
# VM Migration via vzdump + transfer + qmrestore
# ---------------------------------------------------------------------------

def _load_private_key(pem: str) -> paramiko.PKey:
    try:
        return paramiko.Ed25519Key.from_private_key(io.StringIO(pem))
    except Exception:
        return paramiko.RSAKey.from_private_key(io.StringIO(pem))


async def _open_ssh(ip: str, user: str, pem: str) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = _load_private_key(pem)
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        lambda: client.connect(hostname=ip, username=user, pkey=pkey,
                               timeout=15, look_for_keys=False, allow_agent=False),
    )
    return client


async def _run_remote(client: paramiko.SSHClient, cmd: str, send_line) -> int:
    """Run a command over SSH, streaming each output line via send_line(text).
    Returns the exit code."""
    loop = asyncio.get_event_loop()
    chan = client.get_transport().open_session()
    chan.exec_command(cmd)
    buf = b""
    while True:
        ready = await loop.run_in_executor(None, lambda: chan.recv_ready())
        if ready:
            chunk = await loop.run_in_executor(None, lambda: chan.recv(8192))
            if chunk:
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    text = line.decode("utf-8", errors="replace").strip()
                    if text:
                        await send_line(text)
        elif await loop.run_in_executor(None, lambda: chan.exit_status_ready()):
            break
        else:
            await asyncio.sleep(0.15)
    return await loop.run_in_executor(None, chan.recv_exit_status)


@router.get("/nodes/{node_name}/storages")
async def list_node_storages(
    node_name: str,
    node_store: NodeStore = Depends(get_node_store),
    secret_store: SecretStore = Depends(get_secret_store),
) -> list[dict]:
    """Return available storage pools on a Proxmox node."""
    node = node_store.get(node_name)
    headers = _proxmox_headers(node, secret_store)
    base = node.endpoint.rstrip("/")
    async with httpx.AsyncClient(verify=False, timeout=15.0) as client:
        r = await client.get(
            f"{base}/api2/json/nodes/{node.node_name}/storage",
            headers=headers,
        )
        if r.status_code != 200:
            raise HTTPException(502, f"Proxmox API error: {r.status_code}")
        storages = r.json().get("data", [])
        return [
            {
                "storage": s["storage"],
                "type": s.get("type", ""),
                "content": s.get("content", ""),
                "active": s.get("active", 0) == 1,
            }
            for s in storages
            if s.get("active", 0) == 1
        ]


@router.websocket("/{name}/migrate")
async def vm_migrate(
    websocket: WebSocket,
    name: str,
    target_node: str,
    target_storage: str = "local-lvm",
    delete_source: bool = True,
) -> None:
    await websocket.accept()

    async def send_step(step: str, status: str, detail: str = "") -> None:
        await websocket.send_text(json.dumps({"step": step, "status": status, "detail": detail}))

    src_client: paramiko.SSHClient | None = None
    tgt_client: paramiko.SSHClient | None = None
    loop = asyncio.get_event_loop()

    try:
        # ── VALIDATE ────────────────────────────────────────────────────────
        await send_step("validate", "running", "Checking configuration...")
        store = VMStore(settings.homelab_repo_path)
        node_store = NodeStore(settings.homelab_repo_path)
        secret_store = SecretStore(settings.homelab_repo_path)

        try:
            vm = store.get(name)
        except Exception:
            await send_step("validate", "error", f"VM '{name}' not found in Rootstock")
            return

        source_node_name = vm.node
        if source_node_name == target_node:
            await send_step("validate", "error", "Source and target nodes are the same")
            return

        try:
            src_node = node_store.get(source_node_name)
            tgt_node = node_store.get(target_node)
        except Exception as e:
            await send_step("validate", "error", f"Node lookup failed: {e}")
            return

        await send_step("validate", "done", f"'{name}' on {source_node_name} → {target_node}")

        # ── DISCOVER VMID ────────────────────────────────────────────────────
        await send_step("discover", "running", "Querying Proxmox API for VMID...")
        src_headers = _proxmox_headers(src_node, secret_store)
        tgt_headers = _proxmox_headers(tgt_node, secret_store)
        src_base = src_node.endpoint.rstrip("/")
        tgt_base = tgt_node.endpoint.rstrip("/")

        vmid: int | None = None
        async with httpx.AsyncClient(verify=False, timeout=15.0) as client:
            r = await client.get(
                f"{src_base}/api2/json/nodes/{src_node.node_name}/qemu",
                headers=src_headers,
            )
            r.raise_for_status()
            for pve_vm in r.json().get("data", []):
                if pve_vm.get("name") == name:
                    vmid = int(pve_vm["vmid"])
                    break

        if vmid is None:
            await send_step("discover", "error",
                            f"VM '{name}' not found on Proxmox node '{source_node_name}'")
            return
        await send_step("discover", "done", f"VMID {vmid} on {src_node.node_name}")

        # ── SHUTDOWN ─────────────────────────────────────────────────────────
        await send_step("shutdown", "running", "Checking VM power state...")
        async with httpx.AsyncClient(verify=False, timeout=30.0) as client:
            r = await client.get(
                f"{src_base}/api2/json/nodes/{src_node.node_name}/qemu/{vmid}/status/current",
                headers=src_headers,
            )
            status = r.json().get("data", {}).get("status", "unknown")

            if status != "stopped":
                await send_step("shutdown", "running", f"Sending shutdown (was: {status})...")
                await client.post(
                    f"{src_base}/api2/json/nodes/{src_node.node_name}/qemu/{vmid}/status/shutdown",
                    headers=src_headers,
                )
                for tick in range(120):
                    await asyncio.sleep(5)
                    r = await client.get(
                        f"{src_base}/api2/json/nodes/{src_node.node_name}/qemu/{vmid}/status/current",
                        headers=src_headers,
                    )
                    status = r.json().get("data", {}).get("status", "unknown")
                    await send_step("shutdown", "running",
                                    f"Waiting... {tick * 5}s elapsed (status: {status})")
                    if status == "stopped":
                        break
                else:
                    await send_step("shutdown", "error", "VM did not stop within 10 minutes")
                    return

        await send_step("shutdown", "done", "VM is stopped")

        # ── DUMP ─────────────────────────────────────────────────────────────
        await send_step("dump", "running", "Opening SSH to source node...")
        src_ip = src_node.endpoint.split("//")[-1].split(":")[0].split("/")[0]
        tgt_ip = tgt_node.endpoint.split("//")[-1].split(":")[0].split("/")[0]
        src_user = src_node.ssh_user or "root"
        tgt_user = tgt_node.ssh_user or "root"

        src_pem = secret_store.get(f"proxmox/{source_node_name}/ssh_private_key")
        tgt_pem = secret_store.get(f"proxmox/{target_node}/ssh_private_key")
        src_client = await _open_ssh(src_ip, src_user, src_pem)

        dump_output_lines: list[str] = []

        async def on_dump_line(text: str) -> None:
            dump_output_lines.append(text)
            await send_step("dump", "running", text)

        await send_step("dump", "running", f"Running vzdump on VMID {vmid}...")
        rc = await _run_remote(
            src_client,
            f"vzdump {vmid} --compress zstd --mode stop 2>&1",
            on_dump_line,
        )
        if rc != 0:
            await send_step("dump", "error", f"vzdump exited with code {rc}")
            return

        # Try to parse backup file path from vzdump output first
        dump_output_text = "\n".join(dump_output_lines)
        backup_file = None
        match = re.search(r"creating backup file (\S+)", dump_output_text)
        if match:
            backup_file = match.group(1)

        # Fallback 1: query Proxmox API for the latest backup for this VMID
        if not backup_file:
            await send_step("dump", "running", "Locating backup via Proxmox API...")
            try:
                async with httpx.AsyncClient(verify=False, timeout=15.0) as client:
                    r = await client.get(
                        f"{src_base}/api2/json/nodes/{src_node.node_name}/storage",
                        headers=src_headers,
                    )
                    for storage in r.json().get("data", []):
                        if "backup" not in (storage.get("content") or ""):
                            continue
                        storage_id = storage["storage"]
                        r2 = await client.get(
                            f"{src_base}/api2/json/nodes/{src_node.node_name}/storage/{storage_id}/content",
                            headers=src_headers,
                            params={"content": "backup", "vmid": vmid},
                        )
                        if r2.status_code != 200:
                            continue
                        items = r2.json().get("data", [])
                        items.sort(key=lambda x: x.get("ctime", 0), reverse=True)
                        if items:
                            volid = items[0].get("volid", "")
                            filename = volid.split("/")[-1] if "/" in volid else volid.split(":")[-1]
                            storage_path = storage.get("path", "/var/lib/vz")
                            backup_file = f"{storage_path}/dump/{filename}"
                            break
            except Exception:
                pass

        # Fallback 2: SSH glob for the most recent vzdump file for this VMID
        if not backup_file:
            await send_step("dump", "running", "Locating backup via SSH glob...")
            lines: list[str] = []
            await _run_remote(
                src_client,
                f"ls -t /var/lib/vz/dump/vzdump-qemu-{vmid}-*.vma* 2>/dev/null | head -1",
                lambda t: lines.append(t),
            )
            if lines and lines[0].strip():
                backup_file = lines[0].strip()

        if not backup_file:
            await send_step("dump", "error", "Could not locate backup file (tried output, API, and glob)")
            return

        await send_step("dump", "done", f"Backup: {backup_file.split('/')[-1]}")

        # ── TRANSFER ─────────────────────────────────────────────────────────
        await send_step("transfer", "running", "Opening SSH to target node...")
        tgt_client = await _open_ssh(tgt_ip, tgt_user, tgt_pem)

        sftp_src = await loop.run_in_executor(None, src_client.open_sftp)
        sftp_tgt = await loop.run_in_executor(None, tgt_client.open_sftp)

        file_size = (await loop.run_in_executor(None, lambda: sftp_src.stat(backup_file))).st_size
        remote_name = backup_file.split("/")[-1]
        target_dump_path = f"/var/lib/vz/dump/{remote_name}"
        size_mb = file_size // 1024 // 1024

        await send_step("transfer", "running", f"Transferring {size_mb} MB to {target_node}...")

        CHUNK = 1024 * 1024  # 1 MB
        transferred = 0
        f_src = await loop.run_in_executor(None, lambda: sftp_src.open(backup_file, "rb"))
        f_dst = await loop.run_in_executor(None, lambda: sftp_tgt.open(target_dump_path, "wb"))
        try:
            while True:
                chunk = await loop.run_in_executor(None, lambda: f_src.read(CHUNK))
                if not chunk:
                    break
                await loop.run_in_executor(None, lambda: f_dst.write(chunk))
                transferred += len(chunk)
                pct = int(transferred / file_size * 100) if file_size else 100
                done_mb = transferred // 1024 // 1024
                await send_step("transfer", "running", f"{pct}% — {done_mb} / {size_mb} MB")
        finally:
            await loop.run_in_executor(None, f_src.close)
            await loop.run_in_executor(None, f_dst.close)

        await send_step("transfer", "done", f"Transferred {size_mb} MB")

        # ── RESTORE ──────────────────────────────────────────────────────────
        await send_step("restore", "running", "Finding available VMID on target node...")
        new_vmid = vmid
        async with httpx.AsyncClient(verify=False, timeout=15.0) as client:
            r = await client.get(
                f"{tgt_base}/api2/json/nodes/{tgt_node.node_name}/qemu",
                headers=tgt_headers,
            )
            used_ids = {int(v["vmid"]) for v in r.json().get("data", [])}
            if new_vmid in used_ids:
                new_vmid = next(i for i in range(100, 10000) if i not in used_ids)

        await send_step("restore", "running",
                        f"Restoring as VMID {new_vmid} on storage '{target_storage}'...")

        async def on_restore_line(text: str) -> None:
            await send_step("restore", "running", text)

        rc = await _run_remote(
            tgt_client,
            f"qmrestore {target_dump_path} {new_vmid} --storage {target_storage} --unique 2>&1",
            on_restore_line,
        )
        if rc != 0:
            await send_step("restore", "error", f"qmrestore exited with code {rc}")
            return
        await send_step("restore", "done", f"VM restored as VMID {new_vmid}")

        # ── UPDATE CONFIG ─────────────────────────────────────────────────────
        await send_step("update", "running", "Updating VM configuration...")
        vm.node = target_node
        store.write(vm)
        await send_step("update", "done", f"VM node updated to '{target_node}'")

        # ── CLEANUP ───────────────────────────────────────────────────────────
        await send_step("cleanup", "running", "Removing backup files...")

        async def silent_rm(client: paramiko.SSHClient, path: str) -> None:
            chan = client.get_transport().open_session()
            chan.exec_command(f"rm -f {path}")
            await loop.run_in_executor(None, chan.recv_exit_status)

        await silent_rm(tgt_client, target_dump_path)
        await silent_rm(src_client, backup_file)

        if delete_source:
            await send_step("cleanup", "running",
                            f"Destroying VMID {vmid} on {source_node_name}...")

            async def on_destroy_line(text: str) -> None:
                await send_step("cleanup", "running", text)

            await _run_remote(src_client, f"qm destroy {vmid} --purge 2>&1", on_destroy_line)

        suffix = " and removed source VM" if delete_source else ""
        await send_step("cleanup", "done", f"Backup files removed{suffix}")

        # ── COMMIT ────────────────────────────────────────────────────────────
        await send_step("commit", "running", "Committing changes to git...")
        git = GitService(settings.homelab_repo_path)
        git.commit_all(f"Migrate VM '{name}' from {source_node_name} to {target_node}")
        await send_step("commit", "done", "Migration complete")

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.error("VM migration error for '%s': %s", name, exc, exc_info=True)
        try:
            await websocket.send_text(
                json.dumps({"step": "error", "status": "error", "detail": str(exc)})
            )
        except Exception:
            pass
    finally:
        for c in (src_client, tgt_client):
            if c:
                try:
                    c.close()
                except Exception:
                    pass
        try:
            await websocket.close()
        except Exception:
            pass
