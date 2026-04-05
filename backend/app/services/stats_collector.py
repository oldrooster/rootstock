"""Background stats collector — polls Proxmox API and Docker SSH every N seconds."""

import asyncio
import io
import json
import logging
from collections import deque
from time import time

import httpx
import paramiko
from pydantic import BaseModel

logger = logging.getLogger(__name__)

HISTORY_LEN = 60  # snapshots kept in memory


# ── Data models ──────────────────────────────────────────────────────────────

class NodeStat(BaseModel):
    name: str
    cpu_pct: float
    mem_used_mb: int
    mem_total_mb: int
    disk_used_gb: float
    disk_total_gb: float
    uptime_s: int


class VMStat(BaseModel):
    name: str
    node: str
    status: str
    cpu_pct: float
    mem_used_mb: int
    mem_total_mb: int


class ContainerStat(BaseModel):
    name: str
    host: str
    cpu_pct: float
    mem_used_mb: float
    mem_limit_mb: float


class StatsSnapshot(BaseModel):
    timestamp: float
    nodes: list[NodeStat] = []
    vms: list[VMStat] = []
    containers: list[ContainerStat] = []


# ── State ─────────────────────────────────────────────────────────────────────

_history: deque[StatsSnapshot] = deque(maxlen=HISTORY_LEN)
_task: asyncio.Task | None = None
_running = False
_interval = 60


def get_latest() -> StatsSnapshot | None:
    return _history[-1] if _history else None


def get_history() -> list[StatsSnapshot]:
    return list(_history)


def is_running() -> bool:
    return _running


def get_interval() -> int:
    return _interval


# ── Collection helpers ────────────────────────────────────────────────────────

def _parse_mem_mb(s: str) -> float:
    """Parse Docker memory string ('123MiB', '1.5GiB', '500kB') → MB."""
    s = s.strip()
    for suffix, factor in [("GiB", 1024), ("MiB", 1), ("KiB", 1 / 1024), ("kB", 1 / 1024), ("B", 1 / 1_048_576)]:
        if s.endswith(suffix):
            try:
                return float(s[: -len(suffix)]) * factor
            except ValueError:
                return 0.0
    return 0.0


async def _collect_proxmox(repo_path: str) -> tuple[list[NodeStat], list[VMStat]]:
    from app.services.node_store import NodeStore
    from app.services.secret_store import SecretStore

    node_store = NodeStore(repo_path)
    secret_store = SecretStore(repo_path)
    enabled = [n for n in node_store.list_all() if n.enabled and n.type == "proxmox"]

    node_stats: list[NodeStat] = []
    vm_stats: list[VMStat] = []

    async with httpx.AsyncClient(verify=False, timeout=10.0) as client:
        for node in enabled:
            try:
                try:
                    token_secret = secret_store.get(f"proxmox/{node.name}/token_secret")
                except Exception:
                    continue
                api_token = f"{node.username}!{node.token_name}={token_secret}"
                headers = {"Authorization": f"PVEAPIToken={api_token}"}
                base = node.endpoint.rstrip("/")
                pve = node.node_name or node.name

                r = await client.get(f"{base}/api2/json/nodes/{pve}/status", headers=headers)
                if r.status_code == 200:
                    d = r.json().get("data", {})
                    mem = d.get("memory", {})
                    disk = d.get("rootfs", {})
                    node_stats.append(NodeStat(
                        name=node.name,
                        cpu_pct=round(d.get("cpu", 0) * 100, 1),
                        mem_used_mb=mem.get("used", 0) // (1024 * 1024),
                        mem_total_mb=max(mem.get("total", 1) // (1024 * 1024), 1),
                        disk_used_gb=round(disk.get("used", 0) / 1e9, 1),
                        disk_total_gb=round(max(disk.get("total", 1), 1) / 1e9, 1),
                        uptime_s=d.get("uptime", 0),
                    ))

                r2 = await client.get(f"{base}/api2/json/nodes/{pve}/qemu", headers=headers)
                if r2.status_code == 200:
                    for vm in r2.json().get("data", []):
                        vm_stats.append(VMStat(
                            name=vm.get("name", ""),
                            node=node.name,
                            status=vm.get("status", "unknown"),
                            cpu_pct=round(vm.get("cpu", 0) * 100, 1),
                            mem_used_mb=vm.get("mem", 0) // (1024 * 1024),
                            mem_total_mb=max(vm.get("maxmem", 1) // (1024 * 1024), 1),
                        ))
            except Exception as e:
                logger.warning("Proxmox stats failed for %s: %s", node.name, e)

    return node_stats, vm_stats


async def _ssh_docker_stats(ip: str, user: str, pem: str) -> str:
    loop = asyncio.get_event_loop()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        try:
            pkey: paramiko.PKey = paramiko.Ed25519Key.from_private_key(io.StringIO(pem))
        except Exception:
            pkey = paramiko.RSAKey.from_private_key(io.StringIO(pem))
        await loop.run_in_executor(
            None,
            lambda: client.connect(
                hostname=ip, username=user, pkey=pkey,
                timeout=8, look_for_keys=False, allow_agent=False,
            ),
        )
        cmd = (
            "sudo docker stats --no-stream --format "
            '\'{"n":"{{.Name}}","c":"{{.CPUPerc}}","m":"{{.MemUsage}}"}\''
        )
        _, stdout, _ = client.exec_command(cmd, timeout=15)
        data = await loop.run_in_executor(None, stdout.read)
        return data.decode(errors="replace")
    finally:
        try:
            client.close()
        except Exception:
            pass


def _resolve_private_key_pem(ref: str, secret_store) -> str | None:
    """Resolve a secret path reference to a private key PEM string.

    Handles both public-key refs (replaces 'public' → 'private') and
    direct private-key refs (used as-is).
    """
    if not ref or "/" not in ref:
        return None
    private_path = ref.replace("public", "private")
    if private_path != ref:
        try:
            return secret_store.get(private_path)
        except Exception:
            pass
    # Try as-is (may already be a private key path)
    try:
        return secret_store.get(ref)
    except Exception:
        return None


async def _collect_containers(repo_path: str) -> list[ContainerStat]:
    from app.services.vm_store import VMStore
    from app.services.node_store import NodeStore
    from app.services.container_store import ContainerStore
    from app.services.secret_store import SecretStore
    from app.services.template_store import TemplateStore

    vm_store = VMStore(repo_path)
    node_store = NodeStore(repo_path)
    container_store = ContainerStore(repo_path)
    secret_store = SecretStore(repo_path)
    template_store = TemplateStore(repo_path)

    # Build host → (ip, user, pem) — resolve private key PEM eagerly
    host_pem: dict[str, tuple[str, str, str]] = {}

    for vm in vm_store.list_all():
        if not (vm.managed and vm.ip):
            continue
        # Use vm.ssh_key, fall back to template's ssh_key_secret
        ref = vm.ssh_key
        if not ref and vm.template:
            try:
                tpl = template_store.get(vm.template)
                ref = tpl.ssh_key_secret
            except Exception:
                pass
        if not ref:
            continue
        pem = _resolve_private_key_pem(ref, secret_store)
        if pem:
            host_pem[vm.name] = (vm.ip, vm.user or "deploy", pem)
        else:
            logger.warning("Could not resolve SSH private key for VM '%s' (ref=%r)", vm.name, ref)

    for node in node_store.list_all():
        if node.enabled and node.type == "bare-metal":
            ip = node.endpoint.split("//")[-1].split(":")[0].split("/")[0]
            pem = _resolve_private_key_pem(f"proxmox/{node.name}/ssh_private_key", secret_store)
            if pem:
                host_pem[node.name] = (ip, node.ssh_user or "root", pem)
            else:
                logger.warning("Could not resolve SSH private key for node '%s'", node.name)

    # Resolve which hosts have enabled containers (explicit hosts + host_rule)
    all_vms = vm_store.list_all()
    all_nodes = node_store.list_all()
    hosts: set[str] = set()
    for ctr in container_store.list_all():
        if not ctr.enabled:
            continue
        hosts.update(ctr.hosts)
        if ctr.host_rule.startswith("role:"):
            target_role = ctr.host_rule.split(":", 1)[1].strip()
            for node in all_nodes:
                if target_role in getattr(node, "roles", []):
                    hosts.add(node.name)
            for vm in all_vms:
                if target_role in getattr(vm, "roles", []):
                    hosts.add(vm.name)

    async def _collect_host(host: str) -> list[ContainerStat]:
        info = host_pem.get(host)
        if not info:
            logger.warning("No SSH credentials resolved for host '%s', skipping container stats", host)
            return []
        ip, user, pem = info
        try:
            raw = await _ssh_docker_stats(ip, user, pem)
        except Exception as e:
            logger.warning("Docker stats SSH failed for %s (%s): %s", host, ip, e)
            return []

        host_stats: list[ContainerStat] = []
        for line in raw.strip().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
                cpu_str = d.get("c", "0%").rstrip("%")
                mem_parts = d.get("m", "0MiB / 0MiB").split(" / ")
                mem_used = _parse_mem_mb(mem_parts[0])
                mem_limit = _parse_mem_mb(mem_parts[1]) if len(mem_parts) > 1 else 0.0
                host_stats.append(ContainerStat(
                    name=d.get("n", "").lstrip("/"),
                    host=host,
                    cpu_pct=round(float(cpu_str), 1),
                    mem_used_mb=round(mem_used, 1),
                    mem_limit_mb=round(mem_limit, 1),
                ))
            except Exception:
                pass
        return host_stats

    gathered = await asyncio.gather(*[_collect_host(h) for h in hosts], return_exceptions=True)
    results: list[ContainerStat] = []
    for item in gathered:
        if isinstance(item, list):
            results.extend(item)
    return results


# ── Public API ────────────────────────────────────────────────────────────────

async def collect_once(repo_path: str) -> None:
    try:
        node_stats, vm_stats = await _collect_proxmox(repo_path)
        container_stats = await _collect_containers(repo_path)
        _history.append(StatsSnapshot(
            timestamp=time(),
            nodes=node_stats,
            vms=vm_stats,
            containers=container_stats,
        ))
        logger.debug(
            "Stats collected: %d nodes, %d VMs, %d containers",
            len(node_stats), len(vm_stats), len(container_stats),
        )
    except Exception as e:
        logger.error("Stats collection error: %s", e, exc_info=True)


async def _run_loop(repo_path: str) -> None:
    global _running
    _running = True
    logger.info("Stats collector started (interval=%ds)", _interval)
    try:
        while True:
            await collect_once(repo_path)
            await asyncio.sleep(_interval)
    except asyncio.CancelledError:
        pass
    finally:
        _running = False
        logger.info("Stats collector stopped")


def start(repo_path: str, interval: int | None = None) -> None:
    global _task, _interval
    if interval is not None:
        _interval = max(10, interval)
    if _task and not _task.done():
        return  # already running
    _task = asyncio.create_task(_run_loop(repo_path))


def stop() -> None:
    global _task
    if _task:
        _task.cancel()
        _task = None


def reconfigure(repo_path: str, interval: int) -> None:
    """Stop and restart with a new interval."""
    global _interval
    _interval = max(10, interval)
    stop()
    start(repo_path)
