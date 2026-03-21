import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.config import settings
from app.models.hypervisor import HypervisorCreate, HypervisorDefinition, HypervisorUpdate
from app.services.git_service import GitService
from app.services.hypervisor_store import HypervisorStore
from app.services.secret_store import SecretStore
from app.services.vm_store import VMStore

router = APIRouter()


def get_store() -> HypervisorStore:
    return HypervisorStore(settings.homelab_repo_path)


def get_git() -> GitService:
    return GitService(settings.homelab_repo_path)


def get_vm_store() -> VMStore:
    return VMStore(settings.homelab_repo_path)


def get_secret_store() -> SecretStore:
    return SecretStore(settings.homelab_repo_path)


@router.get("/")
async def list_hypervisors(store: HypervisorStore = Depends(get_store)) -> list[HypervisorDefinition]:
    return store.list_all()


@router.post("/", status_code=201)
async def create_hypervisor(
    body: HypervisorCreate,
    store: HypervisorStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> HypervisorDefinition:
    try:
        store.get(body.name)
        raise HTTPException(status_code=409, detail=f"Hypervisor '{body.name}' already exists")
    except HTTPException as e:
        if e.status_code != 404:
            raise

    hv = HypervisorDefinition(**body.model_dump())
    store.write(hv)
    git.commit_all(f"[hypervisor] add: {body.name}")
    return hv


@router.get("/{name}")
async def get_hypervisor(
    name: str,
    store: HypervisorStore = Depends(get_store),
) -> HypervisorDefinition:
    return store.get(name)


@router.patch("/{name}")
async def update_hypervisor(
    name: str,
    body: HypervisorUpdate,
    store: HypervisorStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> HypervisorDefinition:
    existing = store.get(name)
    updated_data = existing.model_dump()
    patch_data = body.model_dump(exclude_none=True)
    updated_data.update(patch_data)
    updated = HypervisorDefinition(**updated_data)
    store.write(updated)
    git.commit_all(f"[hypervisor] update: {name}")
    return updated


@router.delete("/{name}", status_code=204)
async def delete_hypervisor(
    name: str,
    store: HypervisorStore = Depends(get_store),
    git: GitService = Depends(get_git),
    vm_store: VMStore = Depends(get_vm_store),
) -> None:
    store.get(name)  # ensure exists
    # Check no VMs reference this hypervisor
    vms = vm_store.list_all()
    referencing = [vm.name for vm in vms if vm.node == name]
    if referencing:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete hypervisor '{name}': referenced by VM(s): {', '.join(referencing)}",
        )
    store.delete(name)
    git.commit_all(f"[hypervisor] remove: {name}")


@router.post("/{name}/test")
async def test_hypervisor(
    name: str,
    store: HypervisorStore = Depends(get_store),
    secret_store: SecretStore = Depends(get_secret_store),
) -> dict:
    hv = store.get(name)

    if not hv.token_name:
        return {"success": False, "message": "No API token name configured for this hypervisor"}

    secret_key = f"proxmox/{name}/token_secret"
    try:
        token_secret = secret_store.get(secret_key)
    except HTTPException as e:
        if e.status_code == 404:
            return {"success": False, "message": f"No secret stored for '{secret_key}' — add it on the Secrets page"}
        return {"success": False, "message": e.detail}

    api_token = f"{hv.username}!{hv.token_name}={token_secret}"
    url = f"{hv.endpoint.rstrip('/')}/api2/json/version"

    try:
        async with httpx.AsyncClient(verify=False, timeout=10.0) as client:
            r = await client.get(url, headers={"Authorization": f"PVEAPIToken={api_token}"})
            if r.status_code == 401:
                return {"success": False, "message": "Authentication failed — check token name and secret"}
            r.raise_for_status()
            data = r.json().get("data", {})
            version = data.get("version", "unknown")
            return {"success": True, "message": f"Connected — PVE {version}"}
    except httpx.ConnectError:
        return {"success": False, "message": f"Connection refused — cannot reach {hv.endpoint}"}
    except httpx.TimeoutException:
        return {"success": False, "message": f"Timeout — {hv.endpoint} did not respond within 10s"}
    except Exception as e:
        return {"success": False, "message": f"Error: {e}"}
