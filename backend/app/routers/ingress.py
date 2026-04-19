import asyncio
import json
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.config import settings
from app.services.caddy_service import generate_caddyfile
from app.services.cloudflare_service import generate_tunnel_config
from app.services.container_store import ContainerStore
from app.services.ingress_service import (
    IngressSettings,
    ManualRule,
    get_manual_rules,
    get_settings,
    save_manual_rules,
    save_settings,
)
from app.services.node_store import NodeStore

logger = logging.getLogger(__name__)

router = APIRouter()


class IngressRule(BaseModel):
    name: str
    hostname: str
    backend: str
    caddy_host: str
    ingress_mode: str  # "caddy" | "direct" | "manual"
    external: bool
    enabled: bool
    source: str  # "container" | "manual"


def get_container_store() -> ContainerStore:
    return ContainerStore(settings.homelab_repo_path)


def get_node_store() -> NodeStore:
    return NodeStore(settings.homelab_repo_path)


def get_secret_store():
    from app.services.secret_store import SecretStore
    return SecretStore(settings.homelab_repo_path)


def _all_rules(
    container_store: ContainerStore,
) -> list[IngressRule]:
    """Merge container-derived and manual ingress rules."""
    rules: list[IngressRule] = []

    containers = container_store.list_all()
    for ctr in containers:
        if not ctr.dns_name or ctr.ingress_mode == "none":
            continue
        for host in ctr.hosts:
            rules.append(IngressRule(
                name=ctr.name,
                hostname=ctr.dns_name,
                backend=f"{ctr.name}:{ctr.ingress_port}" if ctr.ingress_port else ctr.name,
                caddy_host=host,
                ingress_mode=ctr.ingress_mode,
                external=ctr.external,
                enabled=ctr.enabled,
                source="container",
            ))

    for mr in get_manual_rules(settings.homelab_repo_path):
        rules.append(IngressRule(
            name=mr.name,
            hostname=mr.hostname,
            backend=mr.backend,
            caddy_host=mr.caddy_host,
            ingress_mode="manual",
            external=mr.external,
            enabled=True,
            source="manual",
        ))

    return rules


# --- All rules (derived + manual) ---


@router.get("/rules")
async def list_ingress_rules(
    store: ContainerStore = Depends(get_container_store),
) -> list[IngressRule]:
    return _all_rules(store)


# --- Settings ---


@router.get("/settings")
async def get_ingress_settings() -> IngressSettings:
    return get_settings(settings.homelab_repo_path)


@router.put("/settings")
async def update_ingress_settings(body: IngressSettings) -> IngressSettings:
    save_settings(settings.homelab_repo_path, body)
    return body


# --- Manual rules ---


@router.get("/manual")
async def list_manual_rules() -> list[ManualRule]:
    return get_manual_rules(settings.homelab_repo_path)


@router.post("/manual")
async def add_manual_rule(rule: ManualRule) -> list[ManualRule]:
    rules = get_manual_rules(settings.homelab_repo_path)
    if any(r.name == rule.name for r in rules):
        raise HTTPException(400, f"Manual rule '{rule.name}' already exists")
    rules.append(rule)
    save_manual_rules(settings.homelab_repo_path, rules)
    return rules


@router.put("/manual/{name}")
async def update_manual_rule(name: str, rule: ManualRule) -> list[ManualRule]:
    rules = get_manual_rules(settings.homelab_repo_path)
    found = False
    for i, r in enumerate(rules):
        if r.name == name:
            rules[i] = rule
            found = True
            break
    if not found:
        raise HTTPException(404, f"Manual rule '{name}' not found")
    save_manual_rules(settings.homelab_repo_path, rules)
    return rules


@router.delete("/manual/{name}")
async def delete_manual_rule(name: str) -> list[ManualRule]:
    rules = get_manual_rules(settings.homelab_repo_path)
    new_rules = [r for r in rules if r.name != name]
    if len(new_rules) == len(rules):
        raise HTTPException(404, f"Manual rule '{name}' not found")
    save_manual_rules(settings.homelab_repo_path, new_rules)
    return new_rules


# --- Previews ---


@router.get("/preview/{host}")
async def preview_caddyfile(
    host: str,
    store: ContainerStore = Depends(get_container_store),
) -> dict[str, str]:
    containers = store.list_all()
    manual_rules = get_manual_rules(settings.homelab_repo_path)
    ingress_settings = get_settings(settings.homelab_repo_path)
    content = generate_caddyfile(containers, host, manual_rules, ingress_settings)
    return {"content": content}


@router.get("/tunnel-preview/{host}")
async def preview_tunnel_config(
    host: str,
    store: ContainerStore = Depends(get_container_store),
) -> dict[str, str]:
    containers = store.list_all()
    manual_rules = get_manual_rules(settings.homelab_repo_path)
    content = generate_tunnel_config(host, containers, manual_rules)
    return {"content": content}


# --- Ingress service health checks ---


@router.get("/health")
async def ingress_health_check(
    store: ContainerStore = Depends(get_container_store),
) -> list[dict]:
    """Check HTTP reachability of each configured upstream backend.

    Returns a list of {name, hostname, backend, status, http_code, latency_ms}.
    """
    rules = _all_rules(store)
    results: list[dict] = []

    async def check_rule(rule: IngressRule):
        # Derive the URL to probe
        backend = rule.backend
        scheme = "https" if rule.ingress_mode == "caddy" else "http"
        if "://" not in backend:
            # backend is "container:port" or just "container"
            parts = backend.split(":")
            host = parts[0]
            port = parts[1] if len(parts) > 1 else ("443" if scheme == "https" else "80")
            url = f"{scheme}://{host}:{port}/"
        else:
            url = backend

        entry: dict = {
            "name": rule.name,
            "hostname": rule.hostname,
            "backend": rule.backend,
            "url": url,
            "enabled": rule.enabled,
            "source": rule.source,
        }

        if not rule.enabled:
            entry.update({"status": "disabled", "http_code": None, "latency_ms": None})
            results.append(entry)
            return

        import time
        t0 = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=5, verify=False) as client:
                resp = await client.get(url, follow_redirects=True)
            latency = round((time.monotonic() - t0) * 1000)
            ok = resp.status_code < 500
            entry.update({
                "status": "healthy" if ok else "unhealthy",
                "http_code": resp.status_code,
                "latency_ms": latency,
            })
        except Exception as exc:
            entry.update({
                "status": "unreachable",
                "http_code": None,
                "latency_ms": None,
                "error": str(exc)[:120],
            })
        results.append(entry)

    await asyncio.gather(*(check_rule(r) for r in rules))
    return sorted(results, key=lambda r: r["name"])


# --- Cloudflare tunnel status ---


@router.get("/tunnel-status")
async def tunnel_status(secret_store=Depends(get_secret_store)) -> list[dict]:
    """Return status of all Cloudflare tunnels via the Cloudflare API."""
    ingress_settings = get_settings(settings.homelab_repo_path)

    cf_token = ""
    if ingress_settings.cloudflare_api_token_secret:
        try:
            cf_token = secret_store.get(ingress_settings.cloudflare_api_token_secret)
        except Exception:
            pass

    if not cf_token:
        return []

    try:
        from app.services.cloudflare_service import get_account_id, list_tunnels
        account_id = ingress_settings.cloudflare_account_id or get_account_id(cf_token)
        raw_tunnels = list_tunnels(cf_token, account_id)

        # Filter to rootstock-managed tunnels and enrich with connections info
        result: list[dict] = []
        headers = {"Authorization": f"Bearer {cf_token}"}
        async with httpx.AsyncClient(timeout=10) as client:
            for tunnel in raw_tunnels:
                if not tunnel.get("name", "").startswith("rootstock-"):
                    continue
                tid = tunnel["id"]
                # Fetch connection status
                try:
                    r = await client.get(
                        f"https://api.cloudflare.com/client/v4/accounts/{account_id}/cfd_tunnel/{tid}/connections",
                        headers=headers,
                    )
                    conn_data = r.json().get("result", [])
                    connected = len(conn_data) > 0
                    conns = len(conn_data)
                except Exception:
                    connected = False
                    conns = 0

                result.append({
                    "id": tid,
                    "name": tunnel.get("name"),
                    "status": tunnel.get("status", "unknown"),
                    "connected": connected,
                    "connections": conns,
                    "created_at": tunnel.get("created_at"),
                })
        return result
    except Exception as e:
        logger.warning("Could not fetch tunnel status: %s", e)
        return []


# --- Caddy container management (restart / logs) ---


@router.post("/caddy/{host_name}/restart")
async def restart_caddy(host_name: str) -> dict:
    """Restart the Caddy container on a host via SSH."""
    from app.routers.containers import _resolve_host_ssh, _ssh_exec

    ip, user, pem = await _resolve_host_ssh(host_name)
    loop = asyncio.get_event_loop()
    exit_code, stdout, stderr = await loop.run_in_executor(
        None, lambda: _ssh_exec(ip, user, pem, "sudo docker restart caddy")
    )
    if exit_code != 0:
        raise HTTPException(502, f"Failed to restart Caddy: {stderr.strip() or stdout.strip()}")
    return {"status": "ok", "host": host_name}


@router.websocket("/caddy/{host_name}/logs")
async def caddy_logs(websocket: WebSocket, host_name: str, tail: int = 200):
    """Stream Caddy container logs via SSH WebSocket."""
    from app.routers.containers import _resolve_host_ssh, _open_ssh_client

    await websocket.accept()

    try:
        ip, user, pem = await _resolve_host_ssh(host_name)
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
    channel.exec_command(f"sudo docker logs -f --tail {tail} caddy")

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


# --- Cloudflared container management (restart / logs) ---


@router.post("/cloudflared/{host_name}/restart")
async def restart_cloudflared(host_name: str) -> dict:
    """Restart the cloudflared container on a host via SSH."""
    from app.routers.containers import _resolve_host_ssh, _ssh_exec

    ip, user, pem = await _resolve_host_ssh(host_name)
    loop = asyncio.get_event_loop()
    exit_code, stdout, stderr = await loop.run_in_executor(
        None, lambda: _ssh_exec(ip, user, pem, "sudo docker restart cloudflared")
    )
    if exit_code != 0:
        raise HTTPException(502, f"Failed to restart cloudflared: {stderr.strip() or stdout.strip()}")
    return {"status": "ok", "host": host_name}


@router.websocket("/cloudflared/{host_name}/logs")
async def cloudflared_logs(websocket: WebSocket, host_name: str, tail: int = 200):
    """Stream cloudflared container logs via SSH WebSocket."""
    from app.routers.containers import _resolve_host_ssh, _open_ssh_client

    await websocket.accept()

    try:
        ip, user, pem = await _resolve_host_ssh(host_name)
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
    channel.exec_command(f"sudo docker logs -f --tail {tail} cloudflared")

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
