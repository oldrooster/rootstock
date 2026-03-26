import asyncio
import logging

import httpx
import paramiko
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.models.node import NodeCreate, NodeDefinition, NodeUpdate
from app.services.git_service import GitService
from app.services.node_store import NodeStore
from app.services.secret_store import SecretStore
from app.services.vm_store import VMStore

logger = logging.getLogger(__name__)

router = APIRouter()


def get_store() -> NodeStore:
    return NodeStore(settings.homelab_repo_path)


def get_git() -> GitService:
    return GitService(settings.homelab_repo_path)


def get_vm_store() -> VMStore:
    return VMStore(settings.homelab_repo_path)


def get_secret_store() -> SecretStore:
    return SecretStore(settings.homelab_repo_path)


@router.get("/")
async def list_nodes(store: NodeStore = Depends(get_store)) -> list[NodeDefinition]:
    return store.list_all()


@router.post("/", status_code=201)
async def create_node(
    body: NodeCreate,
    store: NodeStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> NodeDefinition:
    try:
        store.get(body.name)
        raise HTTPException(status_code=409, detail=f"Node '{body.name}' already exists")
    except HTTPException as e:
        if e.status_code != 404:
            raise

    node = NodeDefinition(**body.model_dump())
    store.write(node)
    git.commit_all(f"[node] add: {body.name}")
    return node


@router.get("/{name}")
async def get_node(
    name: str,
    store: NodeStore = Depends(get_store),
) -> NodeDefinition:
    return store.get(name)


@router.patch("/{name}")
async def update_node(
    name: str,
    body: NodeUpdate,
    store: NodeStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> NodeDefinition:
    existing = store.get(name)
    updated_data = existing.model_dump()
    patch_data = body.model_dump(exclude_none=True)
    updated_data.update(patch_data)
    updated = NodeDefinition(**updated_data)
    store.write(updated)
    git.commit_all(f"[node] update: {name}")
    return updated


@router.delete("/{name}", status_code=204)
async def delete_node(
    name: str,
    store: NodeStore = Depends(get_store),
    git: GitService = Depends(get_git),
    vm_store: VMStore = Depends(get_vm_store),
) -> None:
    store.get(name)  # ensure exists
    # Check no VMs reference this node
    vms = vm_store.list_all()
    referencing = [vm.name for vm in vms if vm.node == name]
    if referencing:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete node '{name}': referenced by VM(s): {', '.join(referencing)}",
        )
    store.delete(name)
    git.commit_all(f"[node] remove: {name}")


def _endpoint_host(endpoint: str) -> str:
    """Extract host/IP from an endpoint URL like https://10.0.2.19:8006."""
    host = endpoint.split("//")[-1]
    host = host.split(":")[0]
    host = host.split("/")[0]
    return host


async def _test_ssh(host: str, private_key_pem: str, ssh_user: str = "root") -> dict:
    """Test SSH connectivity to a host using asyncio subprocess."""
    import tempfile
    import os

    fd, key_path = tempfile.mkstemp(prefix="rootstock_ssh_", suffix=".key")
    try:
        os.write(fd, private_key_pem.encode())
        os.close(fd)
        os.chmod(key_path, 0o600)

        proc = await asyncio.create_subprocess_exec(
            "ssh",
            "-i", key_path,
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "ConnectTimeout=10",
            "-o", "BatchMode=yes",
            f"{ssh_user}@{host}",
            "echo ok",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15)
        if proc.returncode == 0:
            return {"success": True, "message": "SSH connected"}
        else:
            err = stderr.decode().strip()
            return {"success": False, "message": f"SSH failed: {err}"}
    except asyncio.TimeoutError:
        return {"success": False, "message": f"SSH timeout connecting to {host}"}
    except Exception as e:
        return {"success": False, "message": f"SSH error: {e}"}
    finally:
        try:
            os.unlink(key_path)
        except OSError:
            pass


@router.post("/{name}/test")
async def test_node(
    name: str,
    store: NodeStore = Depends(get_store),
    secret_store: SecretStore = Depends(get_secret_store),
) -> dict:
    node = store.get(name)
    results = []
    api_ok = False
    ssh_ok = False

    # --- Test API connectivity (Proxmox only) ---
    if node.type == "proxmox":
        if not node.token_name:
            results.append("API: no token name configured")
        else:
            secret_key = f"proxmox/{name}/token_secret"
            try:
                token_secret = secret_store.get(secret_key)
            except HTTPException as e:
                if e.status_code == 404:
                    results.append(f"API: missing secret '{secret_key}'")
                    token_secret = None
                else:
                    results.append(f"API: {e.detail}")
                    token_secret = None

            if token_secret:
                api_token = f"{node.username}!{node.token_name}={token_secret}"
                url = f"{node.endpoint.rstrip('/')}/api2/json/version"
                try:
                    async with httpx.AsyncClient(verify=False, timeout=10.0) as client:
                        r = await client.get(url, headers={"Authorization": f"PVEAPIToken={api_token}"})
                        if r.status_code == 401:
                            results.append("API: auth failed — check token name and secret")
                        else:
                            r.raise_for_status()
                            version = r.json().get("data", {}).get("version", "unknown")
                            results.append(f"API: connected — PVE {version}")
                            api_ok = True
                except httpx.ConnectError:
                    results.append(f"API: connection refused — cannot reach {node.endpoint}")
                except httpx.TimeoutException:
                    results.append(f"API: timeout — {node.endpoint} did not respond")
                except Exception as e:
                    results.append(f"API: {e}")
    else:
        # Non-proxmox nodes don't have API to test
        api_ok = True

    # --- Test SSH connectivity ---
    ssh_secret_key = f"proxmox/{name}/ssh_private_key"
    try:
        ssh_key = secret_store.get(ssh_secret_key)
    except HTTPException:
        ssh_key = None

    if not ssh_key:
        results.append(f"SSH: missing secret '{ssh_secret_key}'")
    else:
        host = _endpoint_host(node.endpoint)
        ssh_user = node.ssh_user or "root"
        ssh_result = await _test_ssh(host, ssh_key, ssh_user)
        if ssh_result["success"]:
            results.append(f"SSH: connected to {ssh_user}@{host}")
            ssh_ok = True
        else:
            results.append(f"SSH: {ssh_result['message']}")

    return {
        "success": api_ok and ssh_ok,
        "api_ok": api_ok,
        "ssh_ok": ssh_ok,
        "message": "\n".join(results),
    }


class SetupSSHRequest(BaseModel):
    username: str = "root"
    password: str


@router.post("/{name}/setup-ssh")
async def setup_ssh(
    name: str,
    body: SetupSSHRequest,
    store: NodeStore = Depends(get_store),
    secret_store: SecretStore = Depends(get_secret_store),
) -> dict:
    """Generate an SSH keypair, install the public key on the host, store both as secrets."""
    node = store.get(name)
    host = _endpoint_host(node.endpoint)

    # Generate ed25519 keypair
    private_key = Ed25519PrivateKey.generate()
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.OpenSSH,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    public_key = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.OpenSSH,
        format=serialization.PublicFormat.OpenSSH,
    ).decode()

    # Connect via password and install the public key
    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None,
            _install_ssh_key,
            host,
            body.username,
            body.password,
            public_key,
        )
        if not result["success"]:
            return result
    except Exception as e:
        return {"success": False, "message": f"SSH connection failed: {e}"}

    # Store both keys as secrets
    secret_store.set(f"proxmox/{name}/ssh_private_key", private_pem)
    secret_store.set(f"proxmox/{name}/ssh_public_key", public_key)

    return {
        "success": True,
        "message": f"SSH key installed on {body.username}@{host} and saved to secrets",
        "public_key": public_key,
    }


def _install_ssh_key(host: str, username: str, password: str, public_key: str) -> dict:
    """Connect to host with password, add public key to authorized_keys."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            hostname=host,
            username=username,
            password=password,
            timeout=15,
            look_for_keys=False,
            allow_agent=False,
        )
        cmd = (
            f'mkdir -p ~/.ssh && chmod 700 ~/.ssh && '
            f'echo "{public_key}" >> ~/.ssh/authorized_keys && '
            f'chmod 600 ~/.ssh/authorized_keys'
        )
        stdin, stdout, stderr = client.exec_command(cmd)
        exit_code = stdout.channel.recv_exit_status()
        if exit_code != 0:
            err = stderr.read().decode().strip()
            return {"success": False, "message": f"Failed to install key: {err}"}
        return {"success": True}
    except paramiko.AuthenticationException:
        return {"success": False, "message": "Authentication failed — check username and password"}
    except paramiko.SSHException as e:
        return {"success": False, "message": f"SSH error: {e}"}
    except Exception as e:
        return {"success": False, "message": f"Connection error: {e}"}
    finally:
        client.close()
