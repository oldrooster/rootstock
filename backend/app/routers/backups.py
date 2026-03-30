import asyncio
import io
import json
import logging
import time
from datetime import datetime

import paramiko
from fastapi import APIRouter, Depends, HTTPException, WebSocket, Query
from pydantic import BaseModel

from app.config import settings
from app.services.backup_service import (
    BackupPath,
    ManualBackupPath,
    get_all_backup_paths,
    get_manual_paths,
    path_slug,
    save_manual_paths,
)
from app.services.container_store import ContainerStore
from app.services.global_settings import get_global_settings

logger = logging.getLogger(__name__)

router = APIRouter()

# --- In-memory stats cache ---

class PathStat(BaseModel):
    host: str
    path: str
    slug: str
    size_bytes: int = 0
    backup_sets: int = 0

class StatsCache(BaseModel):
    updated_at: float = 0.0  # unix timestamp
    stats: list[PathStat] = []

_stats_cache = StatsCache()


def get_store() -> ContainerStore:
    return ContainerStore(settings.homelab_repo_path)


def _load_private_key(pem: str) -> paramiko.PKey:
    try:
        return paramiko.Ed25519Key.from_private_key(io.StringIO(pem))
    except Exception:
        return paramiko.RSAKey.from_private_key(io.StringIO(pem))


def _ssh_exec(host: str, user: str, pem: str, command: str,
              timeout: int = 30) -> tuple[int, str, str]:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = _load_private_key(pem)
    try:
        client.connect(hostname=host, username=user, pkey=pkey, timeout=15,
                       look_for_keys=False, allow_agent=False)
        _, stdout, stderr = client.exec_command(command, timeout=timeout)
        exit_code = stdout.channel.recv_exit_status()
        return exit_code, stdout.read().decode(), stderr.read().decode()
    finally:
        client.close()


async def _resolve_host_ssh(host_name: str) -> tuple[str, str, str]:
    from app.routers.containers import _resolve_host_ssh as _resolve
    return await _resolve(host_name)


# --- All paths (derived + manual) ---


@router.get("/paths")
async def list_backup_paths(store: ContainerStore = Depends(get_store)) -> list[BackupPath]:
    containers = store.list_all()
    return get_all_backup_paths(containers, settings.homelab_repo_path)


# --- Manual paths ---


@router.get("/manual")
async def list_manual_paths() -> list[ManualBackupPath]:
    return get_manual_paths(settings.homelab_repo_path)


@router.post("/manual")
async def add_manual_path(entry: ManualBackupPath) -> list[ManualBackupPath]:
    paths = get_manual_paths(settings.homelab_repo_path)
    if any(p.host == entry.host and p.path == entry.path for p in paths):
        raise HTTPException(400, f"Manual path '{entry.path}' on host '{entry.host}' already exists")
    paths.append(entry)
    save_manual_paths(settings.homelab_repo_path, paths)
    return paths


@router.put("/manual/{index}")
async def update_manual_path(index: int, entry: ManualBackupPath) -> list[ManualBackupPath]:
    paths = get_manual_paths(settings.homelab_repo_path)
    if index < 0 or index >= len(paths):
        raise HTTPException(404, f"Manual path index {index} out of range")
    paths[index] = entry
    save_manual_paths(settings.homelab_repo_path, paths)
    return paths


@router.delete("/manual/{index}")
async def delete_manual_path(index: int) -> list[ManualBackupPath]:
    paths = get_manual_paths(settings.homelab_repo_path)
    if index < 0 or index >= len(paths):
        raise HTTPException(404, f"Manual path index {index} out of range")
    paths.pop(index)
    save_manual_paths(settings.homelab_repo_path, paths)
    return paths


# --- Backup path stats (size + backup set count, cached) ---


@router.get("/stats")
async def get_backup_stats(
    refresh: bool = False,
    store: ContainerStore = Depends(get_store),
):
    """Return size and backup set count per path. Cached; pass ?refresh=true to recalculate."""
    global _stats_cache

    # Return cache if fresh and not forcing refresh
    CACHE_TTL = 3600  # 1 hour
    if not refresh and _stats_cache.updated_at > 0 and (time.time() - _stats_cache.updated_at) < CACHE_TTL:
        return {"updated_at": _stats_cache.updated_at, "stats": [s.model_dump() for s in _stats_cache.stats]}

    gs = get_global_settings(settings.homelab_repo_path)
    backup_target = gs.backup_target
    if not backup_target:
        return {"updated_at": 0, "stats": []}

    containers = store.list_all()
    all_paths = get_all_backup_paths(containers, settings.homelab_repo_path)

    # Group paths by host
    by_host: dict[str, list[BackupPath]] = {}
    for p in all_paths:
        by_host.setdefault(p.host, []).append(p)

    loop = asyncio.get_event_loop()
    results: list[PathStat] = []

    for host, host_paths in by_host.items():
        try:
            ip, user, pem = await _resolve_host_ssh(host)
        except Exception as e:
            logger.warning("Stats: cannot resolve SSH for %s: %s", host, e)
            for bp in host_paths:
                results.append(PathStat(host=host, path=bp.path, slug=path_slug(bp.path)))
            continue

        # Build a single command that gets size and set count for all slugs on this host
        slugs = []
        for bp in host_paths:
            slug = path_slug(bp.path)
            slugs.append((bp.path, slug))

        # One SSH call per host: for each slug dir, output "slug<TAB>size<TAB>count"
        cmds = []
        for orig_path, slug in slugs:
            slug_dir = f"{backup_target}/{host}/{slug}"
            # du -sb for total size; ls -1d to count date dirs (exclude 'latest')
            cmds.append(
                f'slug_dir="{slug_dir}"; '
                f'if [ -d "$slug_dir" ]; then '
                f'  sz=$(sudo du -sb "$slug_dir" 2>/dev/null | cut -f1); '
                f'  cnt=$(sudo find "$slug_dir" -maxdepth 1 -mindepth 1 -type d ! -name latest 2>/dev/null | wc -l); '
                f'  echo "{slug}\t$sz\t$cnt"; '
                f'else echo "{slug}\t0\t0"; fi'
            )
        full_cmd = " && ".join(cmds)

        try:
            exit_code, stdout, stderr = await loop.run_in_executor(
                None, lambda: _ssh_exec(ip, user, pem, full_cmd, timeout=120)
            )
        except Exception as e:
            logger.warning("Stats SSH exec failed for %s: %s", host, e)
            for orig_path, slug in slugs:
                results.append(PathStat(host=host, path=orig_path, slug=slug))
            continue

        # Parse output
        stat_map: dict[str, tuple[int, int]] = {}
        if exit_code == 0 and stdout.strip():
            for line in stdout.strip().split("\n"):
                parts = line.strip().split("\t")
                if len(parts) >= 3:
                    try:
                        stat_map[parts[0]] = (int(parts[1]), int(parts[2]))
                    except ValueError:
                        pass

        for orig_path, slug in slugs:
            sz, cnt = stat_map.get(slug, (0, 0))
            results.append(PathStat(host=host, path=orig_path, slug=slug, size_bytes=sz, backup_sets=cnt))

    _stats_cache = StatsCache(updated_at=time.time(), stats=results)
    return {"updated_at": _stats_cache.updated_at, "stats": [s.model_dump() for s in results]}


# --- Snapshots (list available backup dates for a host) ---


@router.get("/snapshots/{host_name}")
async def list_snapshots(host_name: str) -> list[dict]:
    """List available backup snapshots for a host. Returns [{path, slug, dates}]."""
    gs = get_global_settings(settings.homelab_repo_path)
    backup_target = gs.backup_target
    try:
        ip, user, pem = await _resolve_host_ssh(host_name)
    except Exception as e:
        raise HTTPException(400, f"Cannot resolve SSH for '{host_name}': {e}")

    loop = asyncio.get_event_loop()
    # List all slug directories for this host
    host_dir = f"{backup_target}/{host_name}"
    exit_code, stdout, _ = await loop.run_in_executor(
        None, lambda: _ssh_exec(ip, user, pem,
                                f"sudo find {host_dir} -maxdepth 2 -mindepth 2 -type d 2>/dev/null | sort")
    )
    if exit_code != 0 or not stdout.strip():
        return []

    # Parse: /mnt/share/backups/docker/var_docker_vols_unifi/2026-03-27
    snapshots: dict[str, list[str]] = {}  # slug -> [dates]
    for line in stdout.strip().split("\n"):
        parts = line.strip().split("/")
        if len(parts) < 2:
            continue
        date_part = parts[-1]
        slug_part = parts[-2]
        if slug_part not in snapshots:
            snapshots[slug_part] = []
        snapshots[slug_part].append(date_part)

    return [{"slug": slug, "dates": sorted(dates, reverse=True)} for slug, dates in sorted(snapshots.items())]


# --- Backup WebSocket ---


@router.websocket("/run")
async def backup_run(
    websocket: WebSocket,
    volumes: str | None = None,
):
    """Run backup for selected volumes. Streams step-based progress.

    Query params:
      volumes: comma-separated "host:path" pairs to back up (all if omitted)
    """
    await websocket.accept()
    loop = asyncio.get_event_loop()

    async def send_step(step: str, status: str, detail: str = ""):
        await websocket.send_text(json.dumps({"step": step, "status": status, "detail": detail}))

    try:
        gs = get_global_settings(settings.homelab_repo_path)
        backup_target = gs.backup_target
        if not backup_target:
            await send_step("validate", "error", "Backup target not configured in settings")
            await websocket.close()
            return

        store = ContainerStore(settings.homelab_repo_path)
        containers = store.list_all()
        all_paths = get_all_backup_paths(containers, settings.homelab_repo_path)

        # Filter to selected volumes
        if volumes:
            selected = set(volumes.split(","))
            all_paths = [p for p in all_paths if f"{p.host}:{p.path}" in selected]

        if not all_paths:
            await send_step("validate", "error", "No backup volumes selected")
            await websocket.close()
            return

        await send_step("validate", "done", f"Backing up {len(all_paths)} volume(s)")

        # Group by host
        by_host: dict[str, list[BackupPath]] = {}
        for p in all_paths:
            by_host.setdefault(p.host, []).append(p)

        today = datetime.now().strftime("%Y-%m-%d")
        total = len(all_paths)
        done_count = 0

        for host, host_paths in sorted(by_host.items()):
            step_id = f"host:{host}"
            await send_step(step_id, "running", f"Connecting to {host}...")

            try:
                ip, user, pem = await _resolve_host_ssh(host)
            except Exception as e:
                await send_step(step_id, "error", f"SSH failed: {e}")
                continue

            for bp in host_paths:
                vol_step = f"vol:{host}:{bp.path}"
                slug = path_slug(bp.path)
                dest_latest = f"{backup_target}/{host}/{slug}/latest"
                dest_snapshot = f"{backup_target}/{host}/{slug}/{today}"

                await send_step(vol_step, "running", f"Syncing {bp.path}...")

                # rsync with --info=progress2 for progress, then hardlink snapshot
                exclude_flags = " ".join(f"--exclude '{e}'" for e in bp.exclusions) if bp.exclusions else ""
                rsync_cmd = (
                    f"sudo mkdir -p {dest_latest} && "
                    f"sudo rsync -a --delete --info=progress2 {exclude_flags} {bp.path}/ {dest_latest}/ 2>&1 && "
                    f"sudo rm -rf {dest_snapshot} && "
                    f"sudo cp -al {dest_latest} {dest_snapshot}"
                )

                try:
                    client = paramiko.SSHClient()
                    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                    pkey = _load_private_key(pem)
                    await loop.run_in_executor(
                        None,
                        lambda: client.connect(hostname=ip, username=user, pkey=pkey,
                                               timeout=15, look_for_keys=False, allow_agent=False),
                    )
                    transport = client.get_transport()
                    channel = transport.open_session()
                    channel.get_pty()
                    channel.exec_command(rsync_cmd)

                    # Stream rsync progress
                    buf = ""
                    while not channel.exit_status_ready():
                        if channel.recv_ready():
                            chunk = channel.recv(4096).decode(errors="replace")
                            buf += chunk
                            # rsync --info=progress2 uses \r for updates
                            lines = buf.replace("\r", "\n").split("\n")
                            buf = lines[-1]
                            for line in lines[:-1]:
                                line = line.strip()
                                if line and "%" in line:
                                    await send_step(vol_step, "running", line)
                        else:
                            await asyncio.sleep(0.2)

                    # Drain remaining
                    while channel.recv_ready():
                        chunk = channel.recv(4096).decode(errors="replace")
                        buf += chunk

                    exit_code = channel.recv_exit_status()
                    client.close()

                    if exit_code != 0:
                        await send_step(vol_step, "error", f"rsync failed (exit {exit_code}): {buf[-200:]}")
                    else:
                        done_count += 1
                        await send_step(vol_step, "done", f"Backed up ({done_count}/{total})")
                except Exception as e:
                    await send_step(vol_step, "error", f"Failed: {e}")

            await send_step(step_id, "done", f"All volumes on {host} complete")

        await send_step("complete", "done", f"Backup finished: {done_count}/{total} volumes")
        await websocket.close()

    except Exception as e:
        logger.exception("Backup failed")
        try:
            await send_step("error", "error", str(e))
            await websocket.close()
        except Exception:
            pass


# --- Restore WebSocket ---


@router.websocket("/restore")
async def backup_restore(
    websocket: WebSocket,
    host: str = "",
    paths: str = "",
    snapshot: str = "",
    target_host: str = "",
):
    """Restore volumes from a backup snapshot.

    Query params:
      host: source hostname (where backups were taken from)
      paths: comma-separated original volume paths
      snapshot: date string (e.g. 2026-03-27)
      target_host: optional different host to restore onto (defaults to host)
    """
    await websocket.accept()
    loop = asyncio.get_event_loop()

    async def send_step(step: str, status: str, detail: str = ""):
        await websocket.send_text(json.dumps({"step": step, "status": status, "detail": detail}))

    try:
        if not host or not paths or not snapshot:
            await send_step("validate", "error", "Missing host, paths, or snapshot parameter")
            await websocket.close()
            return

        restore_paths = [p.strip() for p in paths.split(",") if p.strip()]
        if not restore_paths:
            await send_step("validate", "error", "No volumes selected")
            await websocket.close()
            return

        # target_host defaults to the source host
        dest_host = target_host if target_host else host

        gs = get_global_settings(settings.homelab_repo_path)
        backup_target = gs.backup_target
        store = ContainerStore(settings.homelab_repo_path)
        containers = store.list_all()

        target_label = f" → {dest_host}" if dest_host != host else ""
        await send_step("validate", "done",
                        f"Restoring {len(restore_paths)} volume(s) from {host}{target_label} ({snapshot})")

        # Resolve SSH to the destination host
        try:
            ip, user, pem = await _resolve_host_ssh(dest_host)
        except Exception as e:
            await send_step("connect", "error", f"SSH failed for {dest_host}: {e}")
            await websocket.close()
            return
        await send_step("connect", "done", f"Connected to {dest_host}")

        # Find all affected containers on the destination host
        affected_containers: set[str] = set()
        docker_vols_base = gs.docker_vols_base
        for ctr in containers:
            if not ctr.enabled or dest_host not in ctr.hosts:
                continue
            for vol in ctr.volumes:
                resolved = vol.host_path.replace("${DOCKER_VOLS}", docker_vols_base)
                if resolved in restore_paths:
                    affected_containers.add(ctr.name)
                    break

        # Stop affected containers
        affected_list = sorted(affected_containers)
        if affected_list:
            await send_step("stop", "running", f"Stopping {', '.join(affected_list)}...")
            for ctr_name in affected_list:
                await loop.run_in_executor(
                    None, lambda n=ctr_name: _ssh_exec(ip, user, pem,
                                                       f"sudo docker stop {n}", timeout=60)
                )
            await send_step("stop", "done", f"Stopped {len(affected_list)} container(s)")
        else:
            await send_step("stop", "done", "No containers to stop")

        # Restore each volume — source path uses original host, destination is dest_host
        for vol_path in restore_paths:
            slug = path_slug(vol_path)
            src_dir = f"{backup_target}/{host}/{slug}/{snapshot}"
            vol_step = f"restore:{slug}"
            await send_step(vol_step, "running", f"Restoring {vol_path}...")

            rsync_cmd = f"sudo mkdir -p {vol_path} && sudo rsync -a --delete --info=progress2 {src_dir}/ {vol_path}/ 2>&1"

            try:
                client = paramiko.SSHClient()
                client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                pkey = _load_private_key(pem)
                await loop.run_in_executor(
                    None,
                    lambda: client.connect(hostname=ip, username=user, pkey=pkey,
                                           timeout=15, look_for_keys=False, allow_agent=False),
                )
                transport = client.get_transport()
                channel = transport.open_session()
                channel.get_pty()
                channel.exec_command(rsync_cmd)

                buf = ""
                while not channel.exit_status_ready():
                    if channel.recv_ready():
                        chunk = channel.recv(4096).decode(errors="replace")
                        buf += chunk
                        lines = buf.replace("\r", "\n").split("\n")
                        buf = lines[-1]
                        for line in lines[:-1]:
                            line = line.strip()
                            if line and "%" in line:
                                await send_step(vol_step, "running", line)
                    else:
                        await asyncio.sleep(0.2)

                while channel.recv_ready():
                    chunk = channel.recv(4096).decode(errors="replace")
                    buf += chunk

                exit_code = channel.recv_exit_status()
                client.close()

                if exit_code != 0:
                    await send_step(vol_step, "error",
                                    f"rsync failed (exit {exit_code}): {buf[-200:]}")
                else:
                    await send_step(vol_step, "done", f"Restored {vol_path}")
            except Exception as e:
                await send_step(vol_step, "error", f"Failed: {e}")

        # Restart affected containers
        if affected_list:
            await send_step("start", "running", f"Starting {', '.join(affected_list)}...")
            for ctr_name in affected_list:
                await loop.run_in_executor(
                    None, lambda n=ctr_name: _ssh_exec(ip, user, pem,
                                                       f"sudo docker start {n}", timeout=60)
                )
            await send_step("start", "done", f"Started {len(affected_list)} container(s)")
        else:
            await send_step("start", "done", "No containers to restart")

        await send_step("complete", "done", "Restore complete")
        await websocket.close()

    except Exception as e:
        logger.exception("Restore failed")
        try:
            await send_step("error", "error", str(e))
            await websocket.close()
        except Exception:
            pass
