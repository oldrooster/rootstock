from fastapi import APIRouter, Depends, HTTPException

from app.config import settings
from app.models.vm import VMCreate, VMDefinition, VMUpdate
from app.services.git_service import GitService
from app.services.hypervisor_store import HypervisorStore
from app.services.vm_store import VMStore

router = APIRouter()


def get_store() -> VMStore:
    return VMStore(settings.homelab_repo_path)


def get_git() -> GitService:
    return GitService(settings.homelab_repo_path)


def get_hv_store() -> HypervisorStore:
    return HypervisorStore(settings.homelab_repo_path)


def _validate_node(node: str, hv_store: HypervisorStore) -> None:
    """Ensure node matches an enabled hypervisor."""
    hypervisors = hv_store.list_all()
    valid_nodes = {hv.name for hv in hypervisors if hv.enabled}
    if node not in valid_nodes:
        raise HTTPException(
            status_code=400,
            detail=f"No hypervisor configured for node '{node}'",
        )


@router.get("/")
async def list_vms(store: VMStore = Depends(get_store)) -> list[VMDefinition]:
    return store.list_all()


@router.post("/", status_code=201)
async def create_vm(
    body: VMCreate,
    store: VMStore = Depends(get_store),
    git: GitService = Depends(get_git),
    hv_store: HypervisorStore = Depends(get_hv_store),
) -> VMDefinition:
    _validate_node(body.node, hv_store)
    try:
        store.get(body.name)
        raise HTTPException(status_code=409, detail=f"VM '{body.name}' already exists")
    except HTTPException as e:
        if e.status_code != 404:
            raise

    vm = VMDefinition(**body.model_dump())
    store.write(vm)
    git.commit_all(f"[terraform] add: {body.name} on {body.node}")
    return vm


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
    hv_store: HypervisorStore = Depends(get_hv_store),
) -> VMDefinition:
    if body.node is not None:
        _validate_node(body.node, hv_store)
    existing = store.get(name)
    updated_data = existing.model_dump()
    patch_data = body.model_dump(exclude_none=True)
    updated_data.update(patch_data)
    updated = VMDefinition(**updated_data)
    store.write(updated)
    git.commit_all(f"[terraform] update: {name}")
    return updated


@router.delete("/{name}", status_code=204)
async def delete_vm(
    name: str,
    store: VMStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> None:
    store.delete(name)
    git.commit_all(f"[terraform] destroy: {name}")
