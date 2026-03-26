from fastapi import APIRouter, Depends, HTTPException

from app.config import settings
from app.services.backup_service import (
    BackupPath,
    ManualBackupPath,
    get_all_backup_paths,
    get_manual_paths,
    save_manual_paths,
)
from app.services.container_store import ContainerStore

router = APIRouter()


def get_store() -> ContainerStore:
    return ContainerStore(settings.homelab_repo_path)


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
    # Prevent exact duplicate (same host + path)
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
