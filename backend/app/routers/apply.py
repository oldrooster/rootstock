from pathlib import Path

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.config import settings
from app.services.ansible_executor import prepare_ansible_workspace, run_ansible
from app.services.apply_history import load_history, record_run
from app.services.apply_state import get_dirty_areas, mark_all_applied, mark_applied
from app.services.container_store import ContainerStore
from app.services.git_service import GitService
from app.services.image_store import ImageStore
from app.services.node_store import NodeStore
from app.services.secret_store import SecretStore
from app.services.template_store import TemplateStore
from app.services.terraform_executor import (
    prepare_workspace,
    rollback_snapshot_exists,
    rollback_state,
    run_terraform,
    run_terraform_capture,
    snapshot_state,
)
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


# --- History ---


@router.get("/history")
async def apply_history(scope: str | None = None) -> dict:
    """Return apply run history. Optionally filtered by scope."""
    history = load_history(settings.homelab_repo_path)
    if scope:
        return {scope: history.get(scope, [])}
    return history


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


@router.post("/terraform/plan-diff")
async def terraform_plan_diff(
    vm_store: VMStore = Depends(get_vm_store),
    node_store: NodeStore = Depends(get_node_store),
    template_store: TemplateStore = Depends(get_template_store),
    image_store: ImageStore = Depends(get_image_store),
    secret_store: SecretStore = Depends(get_secret_store),
) -> dict:
    """Run terraform plan, then terraform show -json to return a structured diff."""
    import json as _json
    from fastapi import HTTPException

    vms = vm_store.list_all()
    nodes = node_store.list_all()
    templates = template_store.list_all()
    images = image_store.list_all()
    tf_dir = _terraform_dir()

    prepare_workspace(tf_dir, vms, nodes, templates, images, secret_store)

    # Init
    init_code, init_out = await run_terraform_capture(["init", "-no-color"], tf_dir)
    if init_code != 0:
        raise HTTPException(502, f"terraform init failed:\n{init_out[-2000:]}")

    # Plan to binary file
    plan_file = str(tf_dir / "tfplan.binary")
    plan_code, plan_out = await run_terraform_capture(
        ["plan", "-out", plan_file, "-no-color"], tf_dir
    )
    # plan exits 1 on error, 0 on no changes, 2 on changes (with -detailed-exitcode)
    # without -detailed-exitcode it always exits 0 on success
    if plan_code not in (0, 2):
        raise HTTPException(502, f"terraform plan failed:\n{plan_out[-2000:]}")

    # Show JSON
    show_code, show_out = await run_terraform_capture(
        ["show", "-json", plan_file], tf_dir
    )
    if show_code != 0:
        raise HTTPException(502, f"terraform show -json failed:\n{show_out[-2000:]}")

    try:
        plan_json = _json.loads(show_out)
    except _json.JSONDecodeError as e:
        raise HTTPException(502, f"Could not parse plan JSON: {e}")

    return _parse_plan_diff(plan_json)


def _parse_plan_diff(plan_json: dict) -> dict:
    """Extract structured diff from terraform show -json output."""
    resource_changes = plan_json.get("resource_changes", [])

    summary = {"add": 0, "change": 0, "destroy": 0, "no_op": 0}
    changes: list[dict] = []

    for rc in resource_changes:
        change = rc.get("change", {})
        actions: list[str] = change.get("actions", ["no-op"])

        # Map actions to a single label
        if actions == ["no-op"] or actions == ["read"]:
            summary["no_op"] += 1
            continue  # skip unchanged resources

        if "create" in actions and "delete" in actions:
            action_label = "replace"
            summary["destroy"] += 1
            summary["add"] += 1
        elif "create" in actions:
            action_label = "create"
            summary["add"] += 1
        elif "delete" in actions:
            action_label = "destroy"
            summary["destroy"] += 1
        elif "update" in actions:
            action_label = "update"
            summary["change"] += 1
        else:
            action_label = actions[0] if actions else "no-op"
            summary["no_op"] += 1
            continue

        before = change.get("before") or {}
        after = change.get("after") or {}
        after_unknown = change.get("after_unknown") or {}

        field_diffs = _diff_values(before, after, after_unknown, action_label)

        changes.append({
            "address": rc.get("address", ""),
            "module_address": rc.get("module_address"),
            "type": rc.get("type", ""),
            "name": rc.get("name", ""),
            "action": action_label,
            "fields": field_diffs,
        })

    # Sort: destroy first, then replace, then update, then create
    order = {"destroy": 0, "replace": 1, "update": 2, "create": 3}
    changes.sort(key=lambda c: (order.get(c["action"], 9), c["address"]))

    return {
        "summary": summary,
        "changes": changes,
        "format_version": plan_json.get("format_version"),
        "terraform_version": plan_json.get("terraform_version"),
    }


def _format_value(v: object) -> str:
    """Render a value as a compact string for display."""
    import json as _json
    if v is None:
        return "null"
    if isinstance(v, bool):
        return str(v).lower()
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        # Truncate long strings
        return v[:200] + "..." if len(v) > 200 else v
    # dict / list — compact JSON
    try:
        s = _json.dumps(v, separators=(",", ":"))
        return s[:300] + "..." if len(s) > 300 else s
    except Exception:
        return str(v)[:200]


def _diff_values(
    before: dict,
    after: dict,
    after_unknown: dict,
    action_label: str,
) -> list[dict]:
    """Return a list of {key, before, after, change_type} for each changed field."""
    all_keys = sorted(set(list(before.keys()) + list(after.keys())))
    fields: list[dict] = []

    for key in all_keys:
        bv = before.get(key)
        av = after.get(key)
        unknown = key in after_unknown and after_unknown[key] is True

        if action_label == "create":
            if av is None and not unknown:
                continue
            fields.append({
                "key": key,
                "before": None,
                "after": "(known after apply)" if unknown else _format_value(av),
                "change_type": "add",
            })
        elif action_label == "destroy":
            if bv is None:
                continue
            fields.append({
                "key": key,
                "before": _format_value(bv),
                "after": None,
                "change_type": "remove",
            })
        else:
            # update or replace — only show changed fields
            bv_str = _format_value(bv)
            av_str = "(known after apply)" if unknown else _format_value(av)
            if bv_str == av_str and not unknown:
                continue
            fields.append({
                "key": key,
                "before": bv_str,
                "after": av_str,
                "change_type": "update",
            })

    return fields


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
        log_lines: list[str] = []

        def _emit(line: str):
            log_lines.append(line)
            return line

        yield _emit("--- Preparing workspace ---\n")
        yield _emit(f"Wrote main.tf and terraform.tfvars to {tf_dir}\n\n")

        if snapshot_state(tf_dir):
            yield _emit("--- Snapshotted current state for rollback ---\n\n")

        yield _emit("--- terraform init ---\n")
        async for line in run_terraform(["init", "-no-color"], tf_dir):
            yield _emit(line)

        yield _emit("\n--- terraform apply ---\n")
        apply_succeeded = False
        async for line in run_terraform(["apply", "-auto-approve", "-no-color"], tf_dir):
            yield _emit(line)
            if "completed successfully" in line:
                apply_succeeded = True

        exit_code = 0 if apply_succeeded else 1
        if apply_succeeded:
            mark_applied(settings.homelab_repo_path, "terraform")
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
                yield _emit("\n--- Marked newly provisioned VMs ---\n")

        record_run(settings.homelab_repo_path, "terraform", exit_code, "".join(log_lines))

    return StreamingResponse(stream(), media_type="text/plain")


@router.post("/terraform/destroy-preview")
async def terraform_destroy_preview(
    vm_store: VMStore = Depends(get_vm_store),
    node_store: NodeStore = Depends(get_node_store),
    template_store: TemplateStore = Depends(get_template_store),
    image_store: ImageStore = Depends(get_image_store),
    secret_store: SecretStore = Depends(get_secret_store),
) -> dict:
    """Return a list of resource names that would be destroyed."""
    import re
    vms = vm_store.list_all()
    nodes = node_store.list_all()
    templates = template_store.list_all()
    images = image_store.list_all()
    tf_dir = _terraform_dir()

    prepare_workspace(tf_dir, vms, nodes, templates, images, secret_store)

    # Run terraform plan -destroy and parse output for resource names
    resources: list[str] = []
    async def _collect():
        async for line in run_terraform(["init", "-no-color"], tf_dir):
            pass
        async for line in run_terraform(["plan", "-destroy", "-no-color"], tf_dir):
            m = re.match(r'\s+#\s+([\w.[\]"]+)\s+will be destroyed', line)
            if m:
                resources.append(m.group(1))
    import asyncio
    await asyncio.get_event_loop().run_in_executor(None, lambda: None)  # flush
    # We have to await the async generator manually
    async def _run():
        async for line in run_terraform(["init", "-no-color"], tf_dir):
            pass
        async for line in run_terraform(["plan", "-destroy", "-no-color"], tf_dir):
            m = re.match(r'\s+#\s+([\w.\[\]"]+)\s+will be destroyed', line)
            if m:
                resources.append(m.group(1))
    await _run()

    return {"resources": resources, "count": len(resources)}


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


@router.get("/terraform/rollback-status")
async def terraform_rollback_status() -> dict:
    """Return whether a rollback snapshot exists."""
    tf_dir = _terraform_dir()
    return {"available": rollback_snapshot_exists(tf_dir)}


@router.post("/terraform/rollback")
async def terraform_rollback() -> dict:
    """Restore terraform.tfstate from the last snapshot taken before apply."""
    from fastapi import HTTPException

    tf_dir = _terraform_dir()
    if not rollback_state(tf_dir):
        raise HTTPException(409, "No rollback snapshot available.")
    return {"restored": True}


# --- Ansible ---


@router.post("/ansible/{scope}")
async def ansible_run(
    scope: str,
    roles: list[str] = Query(default=None),
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
    # For containers/ingress/backups scopes, optionally filter to selected hosts
    filter_hosts = set(hosts_filter) if hosts_filter else None

    prepare_ansible_workspace(
        ansible_dir, scope, settings.homelab_repo_path,
        vms, nodes, containers,
        secret_store=secret_store,
        templates=templates,
        filter_roles=filter_roles,
        filter_hosts=filter_hosts,
        free_strategy=free_strategy if scope == "containers" else False,
    )

    async def stream():
        log_lines: list[str] = []

        def _emit(line: str):
            log_lines.append(line)
            return line

        yield _emit(f"--- Preparing Ansible workspace ({scope}) ---\n")
        yield _emit(f"Workspace: {ansible_dir}\n\n")

        exit_code = 0
        async for line in run_ansible("playbook.yml", "inventory.yml", ansible_dir, diff=diff, verbosity=verbosity):
            yield _emit(line)
            if "failed (exit code" in line:
                exit_code = 1

        mark_applied(settings.homelab_repo_path, scope)
        record_run(settings.homelab_repo_path, scope, exit_code, "".join(log_lines))

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
