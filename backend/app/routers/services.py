"""Legacy /services/ routes — aliases to /containers/ for backward compatibility."""
from fastapi import APIRouter, Depends, HTTPException

from app.config import settings
from app.models.container import ContainerCreate, ContainerDefinition, ContainerUpdate
from app.models.move import MoveRequest, MoveResult
from app.services.container_store import ContainerStore
from app.services.git_service import GitService
from app.services.move_service import execute_move

router = APIRouter()


def get_store() -> ContainerStore:
    return ContainerStore(settings.homelab_repo_path)


def get_git() -> GitService:
    return GitService(settings.homelab_repo_path)


@router.get("/")
async def list_services(store: ContainerStore = Depends(get_store)) -> list[ContainerDefinition]:
    return store.list_all()


@router.post("/", status_code=201)
async def create_service(
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


@router.get("/{name}")
async def get_service(name: str, store: ContainerStore = Depends(get_store)) -> ContainerDefinition:
    return store.get(name)


@router.patch("/{name}")
async def update_service(
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
async def delete_service(
    name: str,
    store: ContainerStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> None:
    store.delete(name)
    git.commit_all(f"[container] remove: {name}")


@router.post("/{name}/move")
async def move_service(
    name: str,
    body: MoveRequest,
    store: ContainerStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> MoveResult:
    return execute_move(name, body.target_host, store, git)
