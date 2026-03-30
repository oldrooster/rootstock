from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.models.role import RoleCreate, RoleDefinition, RoleUpdate
from app.services.git_service import GitService
from app.services.global_settings import get_global_settings, save_global_settings
from app.services.node_store import NodeStore
from app.services.role_store import RoleStore
from app.services.vm_store import VMStore

router = APIRouter()


def get_store() -> RoleStore:
    return RoleStore(settings.homelab_repo_path)


def get_git() -> GitService:
    return GitService(settings.homelab_repo_path)


def get_node_store() -> NodeStore:
    return NodeStore(settings.homelab_repo_path)


def get_vm_store() -> VMStore:
    return VMStore(settings.homelab_repo_path)


# ── Role CRUD ────────────────────────────────────────────────────────────


@router.get("/")
async def list_roles(store: RoleStore = Depends(get_store)) -> list[RoleDefinition]:
    return store.list_all()


@router.post("/", status_code=201)
async def create_role(
    body: RoleCreate,
    store: RoleStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> RoleDefinition:
    role = RoleDefinition(**body.model_dump())
    store.create(role)
    # Append to role order
    gs = get_global_settings(settings.homelab_repo_path)
    if role.name not in gs.role_order:
        gs.role_order.append(role.name)
        save_global_settings(settings.homelab_repo_path, gs)
    git.commit_all(f"[role] add: {role.name}")
    return role


# NOTE: matrix and files endpoints are registered before /{name}
# to prevent FastAPI matching "matrix" or "files" as a role name.


@router.get("/matrix")
async def get_matrix(
    store: RoleStore = Depends(get_store),
    node_store: NodeStore = Depends(get_node_store),
    vm_store: VMStore = Depends(get_vm_store),
) -> dict:
    roles = store.list_all()
    nodes = node_store.list_all()
    vms = vm_store.list_all()

    role_names = [r.name for r in roles]
    hosts = []
    for n in nodes:
        hosts.append({
            "name": n.name,
            "type": "node",
            "roles": n.roles,
        })
    for vm in vms:
        hosts.append({
            "name": vm.name,
            "type": "vm",
            "roles": vm.roles,
        })

    return {"roles": role_names, "hosts": hosts}


class MatrixUpdate(BaseModel):
    assignments: dict[str, list[str]]  # host_name -> list of role names


@router.post("/matrix")
async def update_matrix(
    body: MatrixUpdate,
    store: RoleStore = Depends(get_store),
    node_store: NodeStore = Depends(get_node_store),
    vm_store: VMStore = Depends(get_vm_store),
    git: GitService = Depends(get_git),
) -> dict:
    nodes = {n.name: n for n in node_store.list_all()}
    vms = {vm.name: vm for vm in vm_store.list_all()}

    changed = False
    for host_name, roles in body.assignments.items():
        if host_name in nodes:
            node = nodes[host_name]
            if sorted(node.roles) != sorted(roles):
                node.roles = roles
                node_store.write(node)
                changed = True
        elif host_name in vms:
            vm = vms[host_name]
            if sorted(vm.roles) != sorted(roles):
                vm.roles = roles
                vm_store.write(vm)
                changed = True

    if changed:
        git.commit_all("[roles] update assignments")

    return {"updated": changed}


@router.get("/order")
async def get_role_order(store: RoleStore = Depends(get_store)) -> list[str]:
    """Return roles in execution order. Roles not in the saved order are appended alphabetically."""
    gs = get_global_settings(settings.homelab_repo_path)
    all_names = {r.name for r in store.list_all()}
    ordered = [n for n in gs.role_order if n in all_names]
    remaining = sorted(all_names - set(ordered))
    return ordered + remaining


class RoleOrderUpdate(BaseModel):
    order: list[str]


@router.put("/order")
async def set_role_order(
    body: RoleOrderUpdate,
    git: GitService = Depends(get_git),
) -> list[str]:
    gs = get_global_settings(settings.homelab_repo_path)
    gs.role_order = body.order
    save_global_settings(settings.homelab_repo_path, gs)
    git.commit_all("[settings] update role execution order")
    return body.order


@router.get("/{name}")
async def get_role(name: str, store: RoleStore = Depends(get_store)) -> RoleDefinition:
    return store.get(name)


@router.patch("/{name}")
async def update_role(
    name: str,
    body: RoleUpdate,
    store: RoleStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> RoleDefinition:
    existing = store.get(name)
    if body.description is not None:
        existing.description = body.description
    store.update(name, existing)
    git.commit_all(f"[role] update: {name}")
    return existing


@router.delete("/{name}", status_code=204)
async def delete_role(
    name: str,
    store: RoleStore = Depends(get_store),
    node_store: NodeStore = Depends(get_node_store),
    vm_store: VMStore = Depends(get_vm_store),
    git: GitService = Depends(get_git),
) -> None:
    store.get(name)  # ensure exists
    # Check no hosts reference this role
    referencing = []
    for n in node_store.list_all():
        if name in n.roles:
            referencing.append(n.name)
    for vm in vm_store.list_all():
        if name in vm.roles:
            referencing.append(vm.name)
    if referencing:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete role '{name}': assigned to: {', '.join(referencing)}",
        )
    store.delete(name)
    # Remove from role order
    gs = get_global_settings(settings.homelab_repo_path)
    if name in gs.role_order:
        gs.role_order.remove(name)
        save_global_settings(settings.homelab_repo_path, gs)
    git.commit_all(f"[role] remove: {name}")


# ── File operations ──────────────────────────────────────────────────────


@router.get("/{name}/files")
async def list_files(name: str, store: RoleStore = Depends(get_store)) -> list[str]:
    return store.list_files(name)


@router.get("/{name}/files/{file_path:path}")
async def read_file(
    name: str, file_path: str, store: RoleStore = Depends(get_store),
) -> dict:
    content = store.read_file(name, file_path)
    return {"path": file_path, "content": content}


class FileWrite(BaseModel):
    content: str


@router.put("/{name}/files/{file_path:path}")
async def write_file(
    name: str,
    file_path: str,
    body: FileWrite,
    store: RoleStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> dict:
    store.get(name)  # ensure role exists
    store.write_file(name, file_path, body.content)
    git.commit_all(f"[role] update file: {name}/{file_path}")
    return {"path": file_path, "saved": True}


@router.delete("/{name}/files/{file_path:path}", status_code=204)
async def delete_file(
    name: str,
    file_path: str,
    store: RoleStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> None:
    store.get(name)  # ensure role exists
    store.delete_file(name, file_path)
    git.commit_all(f"[role] delete file: {name}/{file_path}")
