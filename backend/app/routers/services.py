from fastapi import APIRouter, Depends, HTTPException

from app.config import settings
from app.models.move import MoveRequest, MoveResult
from app.models.service import ServiceCreate, ServiceDefinition, ServiceUpdate
from app.services.git_service import GitService
from app.services.move_service import execute_move
from app.services.service_store import ServiceStore

router = APIRouter()


def get_store() -> ServiceStore:
    return ServiceStore(settings.homelab_repo_path)


def get_git() -> GitService:
    return GitService(settings.homelab_repo_path)


@router.get("/")
async def list_services(store: ServiceStore = Depends(get_store)) -> list[ServiceDefinition]:
    return store.list_all()


@router.post("/", status_code=201)
async def create_service(
    body: ServiceCreate,
    store: ServiceStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> ServiceDefinition:
    try:
        store.get(body.name)
        raise HTTPException(status_code=409, detail=f"Service '{body.name}' already exists")
    except HTTPException as e:
        if e.status_code != 404:
            raise

    svc = ServiceDefinition(**body.model_dump())
    store.write(svc)
    git.commit_all(f"[service] add: {body.name} on {body.host}")
    return svc


@router.get("/{name}")
async def get_service(
    name: str,
    store: ServiceStore = Depends(get_store),
) -> ServiceDefinition:
    return store.get(name)


@router.patch("/{name}")
async def update_service(
    name: str,
    body: ServiceUpdate,
    store: ServiceStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> ServiceDefinition:
    existing = store.get(name)
    updated_data = existing.model_dump()
    patch_data = body.model_dump(exclude_none=True)
    updated_data.update(patch_data)
    updated = ServiceDefinition(**updated_data)
    store.write(updated)
    git.commit_all(f"[service] update: {name}")
    return updated


@router.delete("/{name}", status_code=204)
async def delete_service(
    name: str,
    store: ServiceStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> None:
    store.delete(name)
    git.commit_all(f"[service] remove: {name}")


@router.post("/{name}/move")
async def move_service(
    name: str,
    body: MoveRequest,
    store: ServiceStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> MoveResult:
    return execute_move(name, body.target_host, store, git)
