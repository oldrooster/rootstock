"""WebSocket SSH terminal proxy for VMs and Nodes."""

import asyncio
import io
import json
import logging

import httpx
import paramiko
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config import settings
from app.services.node_store import NodeStore
from app.services.secret_store import SecretStore
from app.services.vm_store import VMStore
from app.services.template_store import TemplateStore

logger = logging.getLogger(__name__)

router = APIRouter()


def _endpoint_host(endpoint: str) -> str:
    host = endpoint.split("//")[-1]
    host = host.split(":")[0]
    host = host.split("/")[0]
    return host


def _load_private_key(pem: str) -> paramiko.PKey:
    """Load a PEM private key, trying ed25519 first then RSA."""
    try:
        return paramiko.Ed25519Key.from_private_key(io.StringIO(pem))
    except Exception:
        return paramiko.RSAKey.from_private_key(io.StringIO(pem))


async def _ssh_proxy(
    websocket: WebSocket,
    host: str,
    username: str,
    private_key_pem: str,
) -> None:
    """Open an SSH session and proxy data between WebSocket and SSH channel."""
    ssh_client = paramiko.SSHClient()
    ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    pkey = _load_private_key(private_key_pem)

    try:
        await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: ssh_client.connect(
                hostname=host,
                username=username,
                pkey=pkey,
                timeout=15,
                look_for_keys=False,
                allow_agent=False,
            ),
        )
    except paramiko.AuthenticationException:
        await websocket.send_text(f"\r\nSSH authentication failed for {username}@{host}\r\n")
        await websocket.close()
        return
    except Exception as e:
        await websocket.send_text(f"\r\nSSH connection failed: {e}\r\n")
        await websocket.close()
        return

    transport = ssh_client.get_transport()
    channel = transport.open_session()
    channel.get_pty(term="xterm-256color", width=80, height=24)
    channel.invoke_shell()

    await websocket.send_text(f"\r\nConnected to {username}@{host}\r\n\r\n")

    async def read_ssh():
        loop = asyncio.get_event_loop()
        try:
            while not channel.closed:
                data = await loop.run_in_executor(None, lambda: channel.recv(4096))
                if not data:
                    break
                await websocket.send_text(data.decode("utf-8", errors="replace"))
        except Exception:
            pass

    async def read_ws():
        try:
            while True:
                msg = await websocket.receive_text()
                if msg.startswith("{"):
                    try:
                        ctrl = json.loads(msg)
                        if ctrl.get("type") == "resize":
                            channel.resize_pty(
                                width=ctrl.get("cols", 80),
                                height=ctrl.get("rows", 24),
                            )
                            continue
                    except json.JSONDecodeError:
                        pass
                channel.sendall(msg.encode("utf-8"))
        except WebSocketDisconnect:
            pass
        except Exception:
            pass

    try:
        ssh_task = asyncio.create_task(read_ssh())
        ws_task = asyncio.create_task(read_ws())
        done, pending = await asyncio.wait(
            [ssh_task, ws_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
    finally:
        try:
            ssh_client.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# VM terminal
# ---------------------------------------------------------------------------

def _resolve_private_key(
    vm_ssh_key: str,
    template_ssh_key_secret: str,
    secret_store: SecretStore,
) -> str | None:
    """Resolve the SSH private key for a VM."""
    ref = vm_ssh_key or template_ssh_key_secret
    if not ref:
        return None

    if "/" in ref:
        private_path = ref.replace("public", "private")
        if private_path != ref:
            try:
                return secret_store.get(private_path)
            except Exception:
                pass
        try:
            return secret_store.get(ref)
        except Exception:
            pass

    return None


async def _discover_vm_ip(
    vm_name: str,
    hv_endpoint: str,
    hv_username: str,
    hv_token_name: str,
    hv_name: str,
    node_name: str,
    secret_store: SecretStore,
) -> str | None:
    """Query Proxmox API to find a VM's IP address by name."""
    try:
        token_secret = secret_store.get(f"proxmox/{hv_name}/token_secret")
    except Exception:
        return None

    api_token = f"{hv_username}!{hv_token_name}={token_secret}"
    base = hv_endpoint.rstrip("/")
    headers = {"Authorization": f"PVEAPIToken={api_token}"}

    async with httpx.AsyncClient(verify=False, timeout=10.0) as client:
        r = await client.get(f"{base}/api2/json/nodes/{node_name}/qemu", headers=headers)
        r.raise_for_status()
        vms = r.json().get("data", [])

        vmid = None
        for vm in vms:
            if vm.get("name") == vm_name:
                vmid = vm.get("vmid")
                break

        if vmid is None:
            return None

        # Try QEMU guest agent
        try:
            r = await client.get(
                f"{base}/api2/json/nodes/{node_name}/qemu/{vmid}/agent/network-get-interfaces",
                headers=headers,
            )
            r.raise_for_status()
            interfaces = r.json().get("data", {}).get("result", [])
            for iface in interfaces:
                if iface.get("name") == "lo":
                    continue
                for addr in iface.get("ip-addresses", []):
                    if addr.get("ip-address-type") == "ipv4":
                        ip = addr.get("ip-address", "")
                        if ip and not ip.startswith("127."):
                            return ip
        except Exception:
            pass

        # Fallback: cloud-init ipconfig
        try:
            r = await client.get(
                f"{base}/api2/json/nodes/{node_name}/qemu/{vmid}/config",
                headers=headers,
            )
            r.raise_for_status()
            config = r.json().get("data", {})
            for key in ["ipconfig0", "ipconfig1"]:
                ipconfig = config.get(key, "")
                if "ip=" in ipconfig:
                    for part in ipconfig.split(","):
                        if part.startswith("ip="):
                            ip = part.split("=")[1].split("/")[0]
                            if ip and not ip.startswith("127."):
                                return ip
        except Exception:
            pass

    return None


@router.websocket("/{vm_name}/terminal")
async def vm_terminal(websocket: WebSocket, vm_name: str):
    await websocket.accept()

    store = VMStore(settings.homelab_repo_path)
    node_store = NodeStore(settings.homelab_repo_path)
    secret_store = SecretStore(settings.homelab_repo_path)
    tpl_store = TemplateStore(settings.homelab_repo_path)

    try:
        try:
            vm = store.get(vm_name)
        except Exception:
            await websocket.send_text(f"\r\nError: VM '{vm_name}' not found\r\n")
            await websocket.close()
            return

        try:
            hv = node_store.get(vm.node)
        except Exception:
            await websocket.send_text(f"\r\nError: Node '{vm.node}' not found\r\n")
            await websocket.close()
            return

        tpl_ssh_secret = ""
        if vm.template:
            try:
                tpl = tpl_store.get(vm.template)
                tpl_ssh_secret = tpl.ssh_key_secret
            except Exception:
                pass

        private_key_pem = _resolve_private_key(vm.ssh_key, tpl_ssh_secret, secret_store)
        if not private_key_pem:
            await websocket.send_text(
                "\r\nError: No SSH private key found.\r\n"
                "The VM's ssh_key (or template's ssh_key_secret) must reference a secret path\r\n"
                "containing 'public' so the private key can be derived.\r\n"
                f"VM ssh_key: '{vm.ssh_key}', Template ssh_key_secret: '{tpl_ssh_secret}'\r\n"
            )
            await websocket.close()
            return

        await websocket.send_text(f"Discovering IP for '{vm_name}' via Proxmox API...\r\n")
        ip = await _discover_vm_ip(
            vm_name, hv.endpoint, hv.username, hv.token_name, hv.name, hv.node_name, secret_store
        )
        if not ip:
            await websocket.send_text(
                f"\r\nError: Could not discover IP for VM '{vm_name}'.\r\n"
                "Ensure the VM is running and the QEMU guest agent is installed.\r\n"
            )
            await websocket.close()
            return

        ssh_user = vm.user or "deploy"
        await websocket.send_text(f"Connecting to {ssh_user}@{ip}...\r\n")
        await _ssh_proxy(websocket, ip, ssh_user, private_key_pem)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("Terminal error: %s", e)
        try:
            await websocket.send_text(f"\r\nError: {e}\r\n")
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Node terminal
# ---------------------------------------------------------------------------

@router.websocket("/node/{node_name}/terminal")
async def node_terminal(websocket: WebSocket, node_name: str):
    await websocket.accept()

    node_store = NodeStore(settings.homelab_repo_path)
    secret_store = SecretStore(settings.homelab_repo_path)

    try:
        try:
            node = node_store.get(node_name)
        except Exception:
            await websocket.send_text(f"\r\nError: Node '{node_name}' not found\r\n")
            await websocket.close()
            return

        host = _endpoint_host(node.endpoint)
        if not host:
            await websocket.send_text("\r\nError: Node has no endpoint configured\r\n")
            await websocket.close()
            return

        # Resolve SSH private key from secrets
        ssh_secret_key = f"proxmox/{node_name}/ssh_private_key"
        try:
            private_key_pem = secret_store.get(ssh_secret_key)
        except Exception:
            await websocket.send_text(
                f"\r\nError: No SSH key found at '{ssh_secret_key}'.\r\n"
                "Use the Setup SSH Key feature on the Nodes page first.\r\n"
            )
            await websocket.close()
            return

        ssh_user = node.ssh_user or "root"
        await websocket.send_text(f"Connecting to {ssh_user}@{host}...\r\n")
        await _ssh_proxy(websocket, host, ssh_user, private_key_pem)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("Node terminal error: %s", e)
        try:
            await websocket.send_text(f"\r\nError: {e}\r\n")
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
