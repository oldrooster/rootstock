from pathlib import Path

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.config import settings
from app.services.ansible_executor import prepare_ansible_workspace, run_ansible
from app.services.apply_state import get_dirty_areas, mark_all_applied, mark_applied
from app.services.container_store import ContainerStore
from app.services.git_service import GitService
from app.services.image_store import ImageStore
from app.services.node_store import NodeStore
from app.services.secret_store import SecretStore
from app.services.template_store import TemplateStore
from app.services.terraform_executor import prepare_workspace, run_terraform
from app.services.terraform_service import generate_main_tf
from app.services.vm_store import VMStore

router = APIRouter()


# --- Dependencies ---


def get_container_store() -> ContainerStore:
    return ContainerStore(settings.homelab_repo_path)


def get_vm_store() -> VMStore:
    return VMStore(settings.homelab_repo_path)


def get_node_store() -> NodeStore:
    return NodeStore(settings.homelab_repo_path)


def get_template_store() -> TemplateStore:
    return TemplateStore(settings.homelab_repo_path)


def get_image_store() -> ImageStore:
    return ImageStore(settings.homelab_repo_path)


def get_secret_store() -> SecretStore:
    return SecretStore(settings.homelab_repo_path)


def _terraform_dir() -> Path:
    return Path(settings.homelab_repo_path) / "terraform"


def _ansible_dir() -> Path:
    return Path(settings.homelab_repo_path) / "ansible"


# --- Status ---


class ApplyStatus(BaseModel):
    dirty: dict[str, bool]
    any_dirty: bool


@router.get("/status")
async def apply_status() -> ApplyStatus:
    dirty = get_dirty_areas(settings.homelab_repo_path)
    return ApplyStatus(dirty=dirty, any_dirty=any(dirty.values()))


# --- Preview ---


class ApplyPreview(BaseModel):
    total_services: int
    enabled_services: int
    total_vms: int
    enabled_vms: int


@router.get("/")
async def apply_preview(
    container_store: ContainerStore = Depends(get_container_store),
    vm_store: VMStore = Depends(get_vm_store),
) -> ApplyPreview:
    containers = container_store.list_all()
    vms = vm_store.list_all()
    return ApplyPreview(
        total_services=len(containers),
        enabled_services=sum(1 for c in containers if c.enabled),
        total_vms=len(vms),
        enabled_vms=sum(1 for v in vms if v.enabled),
    )


# --- Terraform ---


@router.post("/terraform/plan")
async def terraform_plan(
    vm_store: VMStore = Depends(get_vm_store),
    node_store: NodeStore = Depends(get_node_store),
    template_store: TemplateStore = Depends(get_template_store),
    image_store: ImageStore = Depends(get_image_store),
    secret_store: SecretStore = Depends(get_secret_store),
) -> StreamingResponse:
    vms = vm_store.list_all()
    nodes = node_store.list_all()
    templates = template_store.list_all()
    images = image_store.list_all()
    tf_dir = _terraform_dir()

    prepare_workspace(tf_dir, vms, nodes, templates, images, secret_store)

    async def stream():
        yield "--- Preparing workspace ---\n"
        yield f"Wrote main.tf and terraform.tfvars to {tf_dir}\n\n"

        yield "--- terraform init ---\n"
        async for line in run_terraform(["init", "-no-color"], tf_dir):
            yield line

        yield "\n--- terraform plan ---\n"
        async for line in run_terraform(["plan", "-no-color"], tf_dir):
            yield line

    return StreamingResponse(stream(), media_type="text/plain")


@router.post("/terraform/apply")
async def terraform_apply(
    vm_store: VMStore = Depends(get_vm_store),
    node_store: NodeStore = Depends(get_node_store),
    template_store: TemplateStore = Depends(get_template_store),
    image_store: ImageStore = Depends(get_image_store),
    secret_store: SecretStore = Depends(get_secret_store),
) -> StreamingResponse:
    vms = vm_store.list_all()
    nodes = node_store.list_all()
    templates = template_store.list_all()
    images = image_store.list_all()
    tf_dir = _terraform_dir()

    prepare_workspace(tf_dir, vms, nodes, templates, images, secret_store)

    async def stream():
        yield "--- Preparing workspace ---\n"
        yield f"Wrote main.tf and terraform.tfvars to {tf_dir}\n\n"

        yield "--- terraform init ---\n"
        async for line in run_terraform(["init", "-no-color"], tf_dir):
            yield line

        yield "\n--- terraform apply ---\n"
        apply_succeeded = False
        async for line in run_terraform(["apply", "-auto-approve", "-no-color"], tf_dir):
            yield line
            if "completed successfully" in line:
                apply_succeeded = True

        if apply_succeeded:
            mark_applied(settings.homelab_repo_path, "terraform")
            # Mark all enabled VMs as provisioned
            store = VMStore(settings.homelab_repo_path)
            git = GitService(settings.homelab_repo_path)
            updated = False
            for vm in store.list_all():
                if vm.enabled and not vm.provisioned:
                    vm.provisioned = True
                    store.write(vm)
                    updated = True
            if updated:
                git.commit_all("[terraform] mark VMs as provisioned")
                yield "\n--- Marked newly provisioned VMs ---\n"

    return StreamingResponse(stream(), media_type="text/plain")


@router.post("/terraform/destroy")
async def terraform_destroy(
    vm_store: VMStore = Depends(get_vm_store),
    node_store: NodeStore = Depends(get_node_store),
    template_store: TemplateStore = Depends(get_template_store),
    image_store: ImageStore = Depends(get_image_store),
    secret_store: SecretStore = Depends(get_secret_store),
) -> StreamingResponse:
    vms = vm_store.list_all()
    nodes = node_store.list_all()
    templates = template_store.list_all()
    images = image_store.list_all()
    tf_dir = _terraform_dir()

    prepare_workspace(tf_dir, vms, nodes, templates, images, secret_store)

    async def stream():
        yield "--- Preparing workspace ---\n"
        yield f"Wrote main.tf and terraform.tfvars to {tf_dir}\n\n"

        yield "--- terraform init ---\n"
        async for line in run_terraform(["init", "-no-color"], tf_dir):
            yield line

        yield "\n--- terraform destroy ---\n"
        async for line in run_terraform(["destroy", "-auto-approve", "-no-color"], tf_dir):
            yield line

    return StreamingResponse(stream(), media_type="text/plain")


# --- Ansible ---


@router.post("/ansible/{scope}")
async def ansible_run(
    scope: str,
    roles: list[str] = Query(default=None),
    containers_filter: list[str] = Query(default=None, alias="containers"),
    hosts_filter: list[str] = Query(default=None, alias="hosts"),
    diff: bool = Query(default=True),
    verbosity: int = Query(default=0, ge=0, le=4),
    free_strategy: bool = Query(default=False),
    vm_store: VMStore = Depends(get_vm_store),
    node_store: NodeStore = Depends(get_node_store),
    container_store: ContainerStore = Depends(get_container_store),
    template_store: TemplateStore = Depends(get_template_store),
    secret_store: SecretStore = Depends(get_secret_store),
) -> StreamingResponse:
    """Run Ansible for a specific scope: roles, containers, dns, ingress."""
    valid_scopes = {"roles", "containers", "dns", "ingress", "backups"}
    if scope not in valid_scopes:
        from fastapi import HTTPException
        raise HTTPException(400, f"Invalid scope '{scope}'. Valid: {', '.join(sorted(valid_scopes))}")

    vms = vm_store.list_all()
    nodes = node_store.list_all()
    containers = container_store.list_all() if scope != "roles" else None
    templates = template_store.list_all()
    ansible_dir = _ansible_dir() / scope

    # For roles scope, optionally filter to selected roles
    filter_roles = set(roles) if scope == "roles" and roles else None
    # For containers scope, optionally filter to selected containers
    filter_containers = set(containers_filter) if scope == "containers" and containers_filter else None
    # For ingress scope, optionally filter to selected hosts
    filter_hosts = set(hosts_filter) if scope == "ingress" and hosts_filter else None

    prepare_ansible_workspace(
        ansible_dir, scope, settings.homelab_repo_path,
        vms, nodes, containers,
        secret_store=secret_store,
        templates=templates,
        filter_roles=filter_roles,
        filter_containers=filter_containers,
        filter_hosts=filter_hosts,
        free_strategy=free_strategy if scope == "containers" else False,
    )

    async def stream():
        yield f"--- Preparing Ansible workspace ({scope}) ---\n"
        yield f"Workspace: {ansible_dir}\n\n"

        async for line in run_ansible("playbook.yml", "inventory.yml", ansible_dir, diff=diff, verbosity=verbosity):
            yield line

        mark_applied(settings.homelab_repo_path, scope)

    return StreamingResponse(stream(), media_type="text/plain")


# --- Apply All ---


@router.post("/all")
async def apply_all(
    vm_store: VMStore = Depends(get_vm_store),
    node_store: NodeStore = Depends(get_node_store),
    container_store: ContainerStore = Depends(get_container_store),
    template_store: TemplateStore = Depends(get_template_store),
    image_store: ImageStore = Depends(get_image_store),
    secret_store: SecretStore = Depends(get_secret_store),
) -> StreamingResponse:
    """Run everything in order: Terraform, Roles, Containers, DNS, Ingress."""
    vms = vm_store.list_all()
    nodes = node_store.list_all()
    containers = container_store.list_all()
    templates = template_store.list_all()
    images = image_store.list_all()
    tf_dir = _terraform_dir()

    prepare_workspace(tf_dir, vms, nodes, templates, images, secret_store)

    async def stream():
        # 1. Terraform
        yield "=== TERRAFORM ===\n\n"
        yield "--- terraform init ---\n"
        async for line in run_terraform(["init", "-no-color"], tf_dir):
            yield line
        yield "\n--- terraform apply ---\n"
        async for line in run_terraform(["apply", "-auto-approve", "-no-color"], tf_dir):
            yield line
        mark_applied(settings.homelab_repo_path, "terraform")

        # 2-5. Ansible scopes
        for scope in ["roles", "containers", "dns", "ingress", "backups"]:
            yield f"\n\n=== ANSIBLE: {scope.upper()} ===\n\n"
            ansible_dir = _ansible_dir() / scope
            scope_containers = containers if scope != "roles" else None
            prepare_ansible_workspace(
                ansible_dir, scope, settings.homelab_repo_path,
                vms, nodes, scope_containers,
                secret_store=secret_store,
                templates=templates,
            )
            async for line in run_ansible("playbook.yml", "inventory.yml", ansible_dir):
                yield line
            mark_applied(settings.homelab_repo_path, scope)

        yield "\n\n=== ALL DONE ===\n"

    return StreamingResponse(stream(), media_type="text/plain")
