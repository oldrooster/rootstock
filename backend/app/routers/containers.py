import asyncio
import io
import json
import logging
from pathlib import Path

import paramiko
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.config import settings
from app.models.container import ContainerCreate, ContainerDefinition, ContainerUpdate, PortMapping, VolumeMount
from app.services.ansible_executor import prepare_ansible_workspace, run_ansible
from app.services.compose_service import DEFAULT_DOCKER_VOLS, generate_compose, generate_env_file, resolve_hosts
from app.services.container_store import ContainerStore
from app.services.git_service import GitService
from app.services.node_store import NodeStore
from app.services.secret_store import SecretStore
from app.services.template_store import TemplateStore
from app.services.vm_store import VMStore

logger = logging.getLogger(__name__)

router = APIRouter()


def get_store() -> ContainerStore:
    return ContainerStore(settings.homelab_repo_path)


def get_git() -> GitService:
    return GitService(settings.homelab_repo_path)


def get_node_store() -> NodeStore:
    return NodeStore(settings.homelab_repo_path)


def get_vm_store() -> VMStore:
    return VMStore(settings.homelab_repo_path)


@router.get("/")
async def list_containers(store: ContainerStore = Depends(get_store)) -> list[ContainerDefinition]:
    return store.list_all()


@router.post("/", status_code=201)
async def create_container(
    body: ContainerCreate,
    store: ContainerStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> ContainerDefinition:
    try:
        store.get(body.name)
        raise HTTPException(status_code=409, detail=f"Container '{body.name}' already exists")
    except HTTPException as e:
        if e.status_code != 404:
            raise

    ctr = ContainerDefinition(**body.model_dump())
    store.write(ctr)
    git.commit_all(f"[container] add: {body.name}")
    return ctr


@router.get("/compose/{host}")
async def preview_compose(
    host: str,
    store: ContainerStore = Depends(get_store),
    node_store: NodeStore = Depends(get_node_store),
    vm_store: VMStore = Depends(get_vm_store),
) -> dict:
    """Preview the generated docker-compose.yml for a given host."""
    containers = store.list_all()
    nodes = node_store.list_all()
    vms = vm_store.list_all()

    host_containers = []
    for ctr in containers:
        resolved = resolve_hosts(ctr, nodes, vms)
        if host in resolved:
            host_containers.append(ctr)

    compose_yaml = generate_compose(host, host_containers)
    return {"host": host, "compose": compose_yaml, "containers": len(host_containers)}


@router.get("/status/all")
async def all_container_status(
    store: ContainerStore = Depends(get_store),
) -> dict[str, dict[str, str]]:
    """Check running status of all containers across hosts.

    Returns {container_name: {host: status}} where status is
    'running', 'exited', 'paused', 'created', 'not found', or 'error'.
    """
    containers = store.list_all()

    # Group containers by host
    host_containers: dict[str, list[str]] = {}
    for ctr in containers:
        if not ctr.enabled or not ctr.hosts:
            continue
        for h in ctr.hosts:
            host_containers.setdefault(h, []).append(ctr.name)

    result: dict[str, dict[str, str]] = {}

    async def check_host(host: str, names: list[str]) -> None:
        try:
            ip, user, pem = await _resolve_host_ssh(host)
        except Exception:
            for n in names:
                result.setdefault(n, {})[host] = "unknown"
            return

        # Single SSH command: check all containers at once
        inspect_args = " ".join(names)
        cmd = (
            f"for c in {inspect_args}; do "
            f"status=$(sudo docker inspect -f '{{{{.State.Status}}}}' \"$c\" 2>/dev/null) && "
            f"echo \"$c=$status\" || echo \"$c=not found\"; done"
        )
        try:
            loop = asyncio.get_event_loop()
            _, stdout, _ = await loop.run_in_executor(
                None, lambda: _ssh_exec(ip, user, pem, cmd)
            )
            for line in stdout.strip().splitlines():
                if "=" in line:
                    cname, status = line.split("=", 1)
                    result.setdefault(cname, {})[host] = status
        except Exception:
            for n in names:
                result.setdefault(n, {})[host] = "error"

    await asyncio.gather(*(
        check_host(h, names) for h, names in host_containers.items()
    ))

    return result


# ---------------------------------------------------------------------------
# Discover & import containers from a remote host
# ---------------------------------------------------------------------------


class DiscoveredContainer(BaseModel):
    name: str
    image: str
    status: str
    ports: list[PortMapping] = []
    volumes: list[VolumeMount] = []
    env: dict[str, str] = {}
    network: str | None = None


class ImportContainerRequest(BaseModel):
    name: str
    host: str
    image: str
    ports: list[PortMapping] = []
    volumes: list[VolumeMount] = []
    env: dict[str, str] = {}
    network: str | None = None
    dns_name: str = ""
    ingress_mode: str = "none"
    ingress_port: int = 0


@router.get("/discover/{host_name}")
async def discover_containers(
    host_name: str,
    store: ContainerStore = Depends(get_store),
) -> list[DiscoveredContainer]:
    """List Docker containers on a remote host not yet managed by Rootstock."""
    ip, user, pem = await _resolve_host_ssh(host_name)
    existing_names = {c.name for c in store.list_all()}

    # Get full inspect JSON for all containers
    loop = asyncio.get_event_loop()
    exit_code, stdout, stderr = await loop.run_in_executor(
        None, lambda: _ssh_exec(ip, user, pem, "sudo docker inspect $(sudo docker ps -aq) 2>/dev/null || echo '[]'")
    )

    if exit_code != 0 and not stdout.strip():
        raise HTTPException(502, f"Failed to inspect containers: {stderr.strip()}")

    try:
        all_info = json.loads(stdout)
    except json.JSONDecodeError:
        raise HTTPException(502, "Failed to parse docker inspect output")

    discovered: list[DiscoveredContainer] = []
    for info in all_info:
        name = info.get("Name", "").lstrip("/")
        if not name or name in existing_names:
            continue

        config = info.get("Config", {})
        state = info.get("State", {})
        host_config = info.get("HostConfig", {})
        network_settings = info.get("NetworkSettings", {})

        image = config.get("Image", "")
        status = "running" if state.get("Running") else state.get("Status", "exited")

        # Parse port bindings
        ports: list[dict] = []
        port_bindings = host_config.get("PortBindings") or {}
        for container_port_proto, bindings in port_bindings.items():
            if not bindings:
                continue
            container_port = int(container_port_proto.split("/")[0])
            for binding in bindings:
                host_port = binding.get("HostPort")
                if host_port:
                    ports.append({"host": int(host_port), "container": container_port})

        # Parse volumes/bind mounts
        volumes: list[dict] = []
        mounts = info.get("Mounts", [])
        for mount in mounts:
            if mount.get("Type") == "bind":
                volumes.append({
                    "host_path": mount.get("Source", ""),
                    "container_path": mount.get("Destination", ""),
                    "backup": False,
                })

        # Parse environment variables (exclude common system vars)
        env: dict[str, str] = {}
        skip_env_prefixes = ("PATH=", "HOME=", "HOSTNAME=", "TERM=", "LANG=", "LC_")
        for entry in config.get("Env") or []:
            if "=" in entry:
                k, v = entry.split("=", 1)
                if not any(entry.startswith(p) for p in skip_env_prefixes):
                    env[k] = v

        # Detect network
        networks = list((network_settings.get("Networks") or {}).keys())
        network = None
        for net in networks:
            if net not in ("bridge", "host", "none"):
                network = net
                break

        discovered.append(DiscoveredContainer(
            name=name, image=image, status=status,
            ports=ports, volumes=volumes, env=env, network=network,
        ))

    return sorted(discovered, key=lambda c: c.name)


@router.post("/import", status_code=201)
async def import_container(
    body: ImportContainerRequest,
    store: ContainerStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> ContainerDefinition:
    """Import an existing container into Rootstock."""
    try:
        store.get(body.name)
        raise HTTPException(409, f"Container '{body.name}' already exists")
    except HTTPException as e:
        if e.status_code != 404:
            raise

    ctr = ContainerDefinition(
        name=body.name,
        enabled=True,
        image=body.image,
        hosts=[body.host],
        ports=body.ports,
        volumes=body.volumes,
        env=body.env,
        network=body.network,
        dns_name=body.dns_name,
        ingress_mode=body.ingress_mode,
        ingress_port=body.ingress_port,
    )
    store.write(ctr)
    git.commit_all(f"[container] import: {body.name} on {body.host}")
    return ctr


@router.get("/{name}")
async def get_container(name: str, store: ContainerStore = Depends(get_store)) -> ContainerDefinition:
    return store.get(name)


@router.patch("/{name}")
async def update_container(
    name: str,
    body: ContainerUpdate,
    store: ContainerStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> ContainerDefinition:
    existing = store.get(name)
    updated_data = existing.model_dump()
    patch_data = body.model_dump(exclude_none=True)
    updated_data.update(patch_data)
    updated = ContainerDefinition(**updated_data)
    store.write(updated)
    git.commit_all(f"[container] update: {name}")
    return updated


@router.delete("/{name}", status_code=204)
async def delete_container(
    name: str,
    store: ContainerStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> None:
    store.delete(name)
    git.commit_all(f"[container] remove: {name}")


# ---------------------------------------------------------------------------
# Remote docker actions via SSH
# ---------------------------------------------------------------------------

def _load_private_key(pem: str) -> paramiko.PKey:
    try:
        return paramiko.Ed25519Key.from_private_key(io.StringIO(pem))
    except Exception:
        return paramiko.RSAKey.from_private_key(io.StringIO(pem))


async def _resolve_host_ssh(host_name: str) -> tuple[str, str, str]:
    """Resolve SSH connection info (ip, user, private_key_pem) for a host.

    Tries nodes first, then VMs (with Proxmox API IP discovery).
    """
    from app.routers.terminal import _discover_vm_ip, _resolve_private_key
    from app.services.template_store import TemplateStore

    secret_store = SecretStore(settings.homelab_repo_path)
    node_store = NodeStore(settings.homelab_repo_path)
    vm_store = VMStore(settings.homelab_repo_path)

    # Try as a node
    try:
        node = node_store.get(host_name)
        host = node.endpoint.split("//")[-1].split(":")[0].split("/")[0]
        ssh_user = node.ssh_user or "root"
        pem = secret_store.get(f"proxmox/{host_name}/ssh_private_key")
        return host, ssh_user, pem
    except Exception:
        pass

    # Try as a VM — discover IP via Proxmox API
    try:
        vm = vm_store.get(host_name)
        tpl_store = TemplateStore(settings.homelab_repo_path)
        tpl_ssh_secret = ""
        if vm.template:
            try:
                tpl = tpl_store.get(vm.template)
                tpl_ssh_secret = tpl.ssh_key_secret
            except Exception:
                pass

        pem = _resolve_private_key(vm.ssh_key, tpl_ssh_secret, secret_store)
        if not pem:
            raise ValueError(f"No SSH key for VM '{host_name}'")

        ssh_user = vm.user or "deploy"

        # Discover IP via the Proxmox node that hosts this VM
        hv = node_store.get(vm.node)
        ip = await _discover_vm_ip(
            host_name, hv.endpoint, hv.username, hv.token_name,
            hv.name, hv.node_name, secret_store,
        )
        if not ip:
            raise ValueError(f"Could not discover IP for VM '{host_name}'")

        return ip, ssh_user, pem
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("VM SSH resolution failed for '%s': %s", host_name, e)

    raise HTTPException(404, f"Cannot resolve SSH for host '{host_name}'")


def _ssh_exec(host: str, user: str, pem: str, command: str) -> tuple[int, str, str]:
    """Execute a command over SSH and return (exit_code, stdout, stderr)."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = _load_private_key(pem)
    try:
        client.connect(hostname=host, username=user, pkey=pkey, timeout=15,
                       look_for_keys=False, allow_agent=False)
        _, stdout, stderr = client.exec_command(command, timeout=30)
        exit_code = stdout.channel.recv_exit_status()
        return exit_code, stdout.read().decode(), stderr.read().decode()
    finally:
        client.close()


async def _open_ssh_client(ip: str, user: str, pem: str) -> paramiko.SSHClient:
    """Open and return a connected SSH client."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = _load_private_key(pem)
    await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: client.connect(hostname=ip, username=user, pkey=pkey,
                               timeout=15, look_for_keys=False, allow_agent=False),
    )
    return client


ALLOWED_ACTIONS = {"start", "stop", "restart"}


@router.post("/{name}/action/{action}")
async def container_action(
    name: str,
    action: str,
    host: str | None = None,
) -> dict:
    """Execute a docker action (start/stop/restart) on a container via SSH."""
    if action not in ALLOWED_ACTIONS:
        raise HTTPException(400, f"Invalid action '{action}'. Allowed: {', '.join(ALLOWED_ACTIONS)}")

    store = ContainerStore(settings.homelab_repo_path)
    ctr = store.get(name)

    target_host = host or (ctr.hosts[0] if ctr.hosts else None)
    if not target_host:
        raise HTTPException(400, f"Container '{name}' has no hosts assigned")

    ip, user, pem = await _resolve_host_ssh(target_host)
    cmd = f"sudo docker {action} {name}"

    loop = asyncio.get_event_loop()
    exit_code, stdout, stderr = await loop.run_in_executor(
        None, lambda: _ssh_exec(ip, user, pem, cmd)
    )

    if exit_code != 0:
        raise HTTPException(502, f"docker {action} failed: {stderr.strip() or stdout.strip()}")

    return {"status": "ok", "action": action, "container": name, "host": target_host}


@router.websocket("/{name}/logs")
async def container_logs(websocket: WebSocket, name: str, host: str | None = None):
    """Stream docker logs via SSH WebSocket."""
    await websocket.accept()

    store = ContainerStore(settings.homelab_repo_path)
    try:
        ctr = store.get(name)
    except Exception:
        await websocket.send_text(f"\r\nError: Container '{name}' not found\r\n")
        await websocket.close()
        return

    target_host = host or (ctr.hosts[0] if ctr.hosts else None)
    if not target_host:
        await websocket.send_text(f"\r\nError: Container '{name}' has no hosts\r\n")
        await websocket.close()
        return

    try:
        ip, user, pem = await _resolve_host_ssh(target_host)
    except Exception as e:
        await websocket.send_text(f"\r\nError: {e}\r\n")
        await websocket.close()
        return

    try:
        client = await _open_ssh_client(ip, user, pem)
    except Exception as e:
        await websocket.send_text(f"\r\nSSH connection failed: {e}\r\n")
        await websocket.close()
        return

    transport = client.get_transport()
    channel = transport.open_session()
    channel.exec_command(f"sudo docker logs -f --tail 200 {name}")

    async def read_stream(is_stderr: bool = False):
        loop = asyncio.get_event_loop()
        recv = channel.recv_stderr if is_stderr else channel.recv
        try:
            while not channel.closed:
                data = await loop.run_in_executor(None, lambda: recv(4096))
                if not data:
                    break
                await websocket.send_text(data.decode("utf-8", errors="replace"))
        except Exception:
            pass

    async def read_ws():
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass

    try:
        out_task = asyncio.create_task(read_stream(False))
        err_task = asyncio.create_task(read_stream(True))
        ws_task = asyncio.create_task(read_ws())
        done, pending = await asyncio.wait(
            [out_task, err_task, ws_task], return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
    finally:
        try:
            client.close()
        except Exception:
            pass
        try:
            await websocket.close()
        except Exception:
            pass


@router.websocket("/{name}/shell")
async def container_shell(websocket: WebSocket, name: str, host: str | None = None):
    """Interactive shell into a docker container via SSH + docker exec."""
    await websocket.accept()

    store = ContainerStore(settings.homelab_repo_path)
    try:
        ctr = store.get(name)
    except Exception:
        await websocket.send_text(f"\r\nError: Container '{name}' not found\r\n")
        await websocket.close()
        return

    target_host = host or (ctr.hosts[0] if ctr.hosts else None)
    if not target_host:
        await websocket.send_text(f"\r\nError: Container '{name}' has no hosts\r\n")
        await websocket.close()
        return

    try:
        ip, user, pem = await _resolve_host_ssh(target_host)
    except Exception as e:
        await websocket.send_text(f"\r\nError: {e}\r\n")
        await websocket.close()
        return

    try:
        client = await _open_ssh_client(ip, user, pem)
    except Exception as e:
        await websocket.send_text(f"\r\nSSH connection failed: {e}\r\n")
        await websocket.close()
        return

    # Open interactive PTY and exec into the container
    transport = client.get_transport()
    channel = transport.open_session()
    channel.get_pty(term="xterm-256color", width=80, height=24)
    # Try bash first, fall back to sh
    channel.exec_command(
        f"sudo docker exec -it {name} /bin/bash 2>/dev/null || sudo docker exec -it {name} /bin/sh"
    )

    await websocket.send_text(f"Attached to container '{name}' on {target_host}\r\n\r\n")

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

    try:
        ssh_task = asyncio.create_task(read_ssh())
        ws_task = asyncio.create_task(read_ws())
        done, pending = await asyncio.wait(
            [ssh_task, ws_task], return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
    finally:
        try:
            client.close()
        except Exception:
            pass
        try:
            await websocket.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Container migration
# ---------------------------------------------------------------------------

def _resolve_vol_path(path: str) -> str:
    """Resolve ${DOCKER_VOLS} in a volume path."""
    return path.replace("${DOCKER_VOLS}", DEFAULT_DOCKER_VOLS)


@router.websocket("/{name}/migrate")
async def container_migrate(
    websocket: WebSocket, name: str, target_host: str,
    source_host: str | None = None, volumes: str | None = None,
):
    """Migrate a container from one host to another with volume transfer.

    Streams JSON progress messages: {step, status, detail}
    """
    await websocket.accept()
    loop = asyncio.get_event_loop()

    async def send_step(step: str, status: str, detail: str = ""):
        await websocket.send_text(json.dumps({"step": step, "status": status, "detail": detail}))

    try:
        # --- 1. Validate ---
        store = ContainerStore(settings.homelab_repo_path)
        git = GitService(settings.homelab_repo_path)
        ctr = store.get(name)

        src = source_host or (ctr.hosts[0] if ctr.hosts else None)
        if not src:
            await send_step("validate", "error", f"Container '{name}' has no hosts assigned")
            await websocket.close()
            return

        if src == target_host:
            await send_step("validate", "error", f"Container is already on '{target_host}'")
            await websocket.close()
            return

        if not ctr.enabled:
            await send_step("validate", "error", "Container is disabled — enable it first")
            await websocket.close()
            return

        await send_step("validate", "done", f"Migrating '{name}' from {src} to {target_host}")

        # Resolve SSH for both hosts
        try:
            src_ip, src_user, src_pem = await _resolve_host_ssh(src)
        except Exception as e:
            await send_step("validate", "error", f"Cannot resolve SSH for source '{src}': {e}")
            await websocket.close()
            return

        try:
            dst_ip, dst_user, dst_pem = await _resolve_host_ssh(target_host)
        except Exception as e:
            await send_step("validate", "error", f"Cannot resolve SSH for target '{target_host}': {e}")
            await websocket.close()
            return

        # --- 2. Stop source container ---
        await send_step("stop", "running", f"Stopping container on {src}...")
        exit_code, _, stderr = await loop.run_in_executor(
            None, lambda: _ssh_exec(src_ip, src_user, src_pem, f"sudo docker stop {name}")
        )
        if exit_code != 0 and "No such container" not in stderr:
            await send_step("stop", "error", f"Failed to stop: {stderr.strip()}")
            await websocket.close()
            return
        await send_step("stop", "done", f"Container stopped on {src}")

        # --- 3. Copy volumes ---
        # Filter volumes if a selection was provided (comma-separated host_paths)
        selected_volumes = set(volumes.split(",")) if volumes else None
        all_vol_paths = [_resolve_vol_path(v.host_path) for v in ctr.volumes if v.host_path.strip()]
        vol_paths = [p for p in all_vol_paths if selected_volumes is None or p in selected_volumes]
        skip_paths = [p for p in all_vol_paths if selected_volumes is not None and p not in selected_volumes]

        # Create empty directories for skipped volumes
        if skip_paths:
            await send_step("volumes", "running", f"Creating {len(skip_paths)} empty volume path(s)...")
            for sp in skip_paths:
                # For file mounts, create the parent dir; for dirs, create the dir itself
                # Heuristic: if the last path segment has a dot, it's likely a file
                last_seg = sp.rsplit("/", 1)[-1] if "/" in sp else sp
                create_path = sp.rsplit("/", 1)[0] if "." in last_seg else sp
                await loop.run_in_executor(
                    None, lambda p=create_path: _ssh_exec(dst_ip, dst_user, dst_pem, f"sudo mkdir -p {p}")
                )

        if vol_paths:
            await send_step("volumes", "running", f"Copying {len(vol_paths)} volume(s)...")

            for vol_path in vol_paths:
                await send_step("volumes", "running", f"Transferring {vol_path}...")

                # Create parent dir on destination
                parent = vol_path.rsplit("/", 1)[0] if "/" in vol_path else vol_path
                exit_code, _, stderr = await loop.run_in_executor(
                    None, lambda p=parent: _ssh_exec(dst_ip, dst_user, dst_pem, f"sudo mkdir -p {p}")
                )
                if exit_code != 0:
                    await send_step("volumes", "error", f"Failed to create dir on target: {stderr.strip()}")
                    await websocket.close()
                    return

                # Tar on source -> relay through backend -> untar on destination
                src_client = paramiko.SSHClient()
                src_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                src_pkey = _load_private_key(src_pem)

                dst_client = paramiko.SSHClient()
                dst_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                dst_pkey = _load_private_key(dst_pem)

                try:
                    await loop.run_in_executor(
                        None,
                        lambda: src_client.connect(hostname=src_ip, username=src_user, pkey=src_pkey,
                                                   timeout=15, look_for_keys=False, allow_agent=False),
                    )
                    await loop.run_in_executor(
                        None,
                        lambda: dst_client.connect(hostname=dst_ip, username=dst_user, pkey=dst_pkey,
                                                   timeout=15, look_for_keys=False, allow_agent=False),
                    )

                    # Stream tar from source and pipe to destination
                    src_transport = src_client.get_transport()
                    src_chan = src_transport.open_session()
                    src_chan.exec_command(f"sudo tar czf - -C / {vol_path.lstrip('/')}")

                    dst_transport = dst_client.get_transport()
                    dst_chan = dst_transport.open_session()
                    dst_chan.exec_command(f"sudo tar xzf - -C /")

                    # Relay data
                    total_bytes = 0
                    while True:
                        data = await loop.run_in_executor(None, lambda: src_chan.recv(65536))
                        if not data:
                            break
                        dst_chan.sendall(data)
                        total_bytes += len(data)

                    dst_chan.shutdown_write()

                    # Wait for both channels to finish
                    src_exit = await loop.run_in_executor(None, src_chan.recv_exit_status)
                    dst_exit = await loop.run_in_executor(None, dst_chan.recv_exit_status)

                    if src_exit != 0:
                        src_err = src_chan.recv_stderr(4096).decode()
                        await send_step("volumes", "error", f"Tar on source failed: {src_err}")
                        await websocket.close()
                        return

                    if dst_exit != 0:
                        dst_err = dst_chan.recv_stderr(4096).decode()
                        await send_step("volumes", "error", f"Untar on dest failed: {dst_err}")
                        await websocket.close()
                        return

                    size_mb = total_bytes / (1024 * 1024)
                    await send_step("volumes", "running", f"Transferred {vol_path} ({size_mb:.1f} MB)")

                finally:
                    src_client.close()
                    dst_client.close()

            await send_step("volumes", "done", f"All {len(vol_paths)} volume(s) copied")
        else:
            await send_step("volumes", "skipped", "No volumes to copy")

        # --- 4. Update container definition ---
        await send_step("update", "running", "Updating container definition...")
        new_hosts = [target_host if h == src else h for h in ctr.hosts]
        if target_host not in new_hosts:
            new_hosts = [target_host]
        ctr.hosts = new_hosts
        store.write(ctr)
        await send_step("update", "done", f"Hosts updated to {new_hosts}")

        # --- 5. Deploy on destination ---
        await send_step("deploy", "running", f"Deploying compose on {target_host}...")

        # Ensure docker network exists on destination
        if ctr.network:
            await loop.run_in_executor(
                None, lambda: _ssh_exec(dst_ip, dst_user, dst_pem,
                                        f"sudo docker network create {ctr.network} 2>/dev/null; true")
            )

        # Build from repo if needed
        if ctr.build_repo:
            await send_step("deploy", "running", f"Building image from {ctr.build_repo}...")
            build_dir = f"/opt/docker/build/{ctr.name}"
            build_cmd = (
                f"sudo mkdir -p /opt/docker/build && "
                f"(if [ -d {build_dir} ]; then "
                f"cd {build_dir} && sudo git fetch origin {ctr.build_branch} && sudo git reset --hard origin/{ctr.build_branch}; "
                f"else sudo git clone --depth 1 --branch {ctr.build_branch} {ctr.build_repo} {build_dir}; fi) && "
                f"cd {build_dir} && sudo docker build -t {ctr.image} -f {ctr.build_dockerfile} {ctr.build_context}"
            )
            exit_code, _, stderr = await loop.run_in_executor(
                None, lambda: _ssh_exec(dst_ip, dst_user, dst_pem, build_cmd)
            )
            if exit_code != 0:
                await send_step("deploy", "error", f"Image build failed: {stderr}")
                await websocket.close()
                return
            await send_step("deploy", "running", f"Image {ctr.image} built successfully")

        # Generate and deploy compose + .env
        all_containers = store.list_all()
        secret_store = SecretStore(settings.homelab_repo_path)
        dest_containers = [c for c in all_containers if c.enabled and target_host in c.hosts]
        compose_yaml = generate_compose(target_host, dest_containers)
        env_content = generate_env_file(target_host, dest_containers, secret_store)

        # Upload compose, .env, and start
        compose_cmd = (
            f"sudo mkdir -p /opt/docker && "
            f"cat > /tmp/_compose.yml && "
            f"sudo mv /tmp/_compose.yml /opt/docker/docker-compose.yml && "
            f"sudo docker compose -f /opt/docker/docker-compose.yml up -d"
        )
        dst_client = paramiko.SSHClient()
        dst_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        dst_pkey = _load_private_key(dst_pem)
        try:
            await loop.run_in_executor(
                None,
                lambda: dst_client.connect(hostname=dst_ip, username=dst_user, pkey=dst_pkey,
                                           timeout=15, look_for_keys=False, allow_agent=False),
            )

            # Upload .env file first if needed
            if env_content:
                transport = dst_client.get_transport()
                env_channel = transport.open_session()
                env_cmd = (
                    "cat > /tmp/_docker.env && "
                    "sudo mv /tmp/_docker.env /opt/docker/.env && "
                    "sudo chmod 600 /opt/docker/.env"
                )
                env_channel.exec_command(f"sudo mkdir -p /opt/docker && {env_cmd}")
                env_channel.sendall(env_content.encode())
                env_channel.shutdown_write()
                await loop.run_in_executor(None, env_channel.recv_exit_status)

            transport = dst_client.get_transport()
            channel = transport.open_session()
            channel.exec_command(compose_cmd)
            channel.sendall(compose_yaml.encode())
            channel.shutdown_write()

            exit_code = await loop.run_in_executor(None, channel.recv_exit_status)
            if exit_code != 0:
                err = channel.recv_stderr(4096).decode()
                await send_step("deploy", "error", f"Compose up failed: {err}")
                await websocket.close()
                return
        finally:
            dst_client.close()

        await send_step("deploy", "done", f"Container running on {target_host}")

        # --- 6. Clean up source ---
        await send_step("cleanup", "running", f"Removing container from {src}...")
        await loop.run_in_executor(
            None, lambda: _ssh_exec(src_ip, src_user, src_pem, f"sudo docker rm -f {name}")
        )

        # Re-generate compose + .env on source (without the migrated container)
        src_containers = [c for c in all_containers if c.enabled and src in c.hosts and c.name != name]
        if src_containers:
            src_compose = generate_compose(src, src_containers)
            src_env = generate_env_file(src, src_containers, secret_store)
            src_client_2 = paramiko.SSHClient()
            src_client_2.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            src_pkey_2 = _load_private_key(src_pem)
            try:
                await loop.run_in_executor(
                    None,
                    lambda: src_client_2.connect(hostname=src_ip, username=src_user, pkey=src_pkey_2,
                                                 timeout=15, look_for_keys=False, allow_agent=False),
                )
                t = src_client_2.get_transport()

                # Upload .env
                if src_env:
                    env_ch = t.open_session()
                    env_ch.exec_command(
                        "cat > /tmp/_docker.env && "
                        "sudo mv /tmp/_docker.env /opt/docker/.env && "
                        "sudo chmod 600 /opt/docker/.env"
                    )
                    env_ch.sendall(src_env.encode())
                    env_ch.shutdown_write()
                    await loop.run_in_executor(None, env_ch.recv_exit_status)

                ch = t.open_session()
                ch.exec_command(
                    "cat > /tmp/_compose.yml && "
                    "sudo mv /tmp/_compose.yml /opt/docker/docker-compose.yml"
                )
                ch.sendall(src_compose.encode())
                ch.shutdown_write()
                await loop.run_in_executor(None, ch.recv_exit_status)
            finally:
                src_client_2.close()

        await send_step("cleanup", "done", f"Removed from {src}")

        # --- 7. Update DNS ---
        await send_step("dns", "running", "Updating DNS records...")
        try:
            node_store = NodeStore(settings.homelab_repo_path)
            vm_store = VMStore(settings.homelab_repo_path)
            template_store = TemplateStore(settings.homelab_repo_path)
            secret_store = SecretStore(settings.homelab_repo_path)
            all_containers_fresh = store.list_all()
            nodes = node_store.list_all()
            vms = vm_store.list_all()
            templates = template_store.list_all()

            ansible_dir = Path(settings.homelab_repo_path) / "ansible" / "dns"
            prepare_ansible_workspace(
                ansible_dir, "dns", settings.homelab_repo_path,
                vms, nodes, all_containers_fresh,
                secret_store=secret_store, templates=templates,
            )
            dns_output = []
            async for line in run_ansible("playbook.yml", "inventory.yml", ansible_dir):
                dns_output.append(line)
            # Check for failure
            output_text = "".join(dns_output)
            if "failed=" in output_text and "failed=0" not in output_text:
                await send_step("dns", "error", "DNS playbook had failures (check Apply page)")
            else:
                await send_step("dns", "done", "DNS records updated")
        except Exception as e:
            await send_step("dns", "error", f"DNS update failed: {e}")

        # --- 8. Update Ingress ---
        await send_step("ingress", "running", "Updating ingress configuration...")
        try:
            ansible_dir = Path(settings.homelab_repo_path) / "ansible" / "ingress"
            prepare_ansible_workspace(
                ansible_dir, "ingress", settings.homelab_repo_path,
                vms, nodes, all_containers_fresh,
                secret_store=secret_store, templates=templates,
            )
            ingress_output = []
            async for line in run_ansible("playbook.yml", "inventory.yml", ansible_dir):
                ingress_output.append(line)
            output_text = "".join(ingress_output)
            if "failed=" in output_text and "failed=0" not in output_text:
                await send_step("ingress", "error", "Ingress playbook had failures (check Apply page)")
            else:
                # Reload Caddy on affected hosts (source and destination)
                for reload_host in {src, target_host}:
                    try:
                        r_ip, r_user, r_pem = await _resolve_host_ssh(reload_host)
                        exit_code, _, stderr = await loop.run_in_executor(
                            None, lambda ip=r_ip, u=r_user, p=r_pem: _ssh_exec(
                                ip, u, p, "sudo docker restart caddy"
                            )
                        )
                        await send_step("ingress", "running", f"Caddy reloaded on {reload_host}")
                    except Exception as re:
                        await send_step("ingress", "running", f"Caddy reload skipped on {reload_host}: {re}")
                await send_step("ingress", "done", "Ingress updated and Caddy reloaded")
        except Exception as e:
            await send_step("ingress", "error", f"Ingress update failed: {e}")

        # --- 9. Git commit ---
        await send_step("commit", "running", "Committing changes...")
        git.commit_all(f"[container] migrate: {name} from {src} to {target_host}")
        await send_step("commit", "done", "Changes committed")

        # --- Done ---
        await send_step("complete", "done", f"Migration of '{name}' complete")

    except WebSocketDisconnect:
        logger.info("Migration WebSocket disconnected for '%s'", name)
    except Exception as e:
        logger.error("Migration error for '%s': %s", name, e)
        try:
            await send_step("error", "error", str(e))
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
