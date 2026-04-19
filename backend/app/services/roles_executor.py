"""Ansible workspace generation for the 'roles' scope."""

from pathlib import Path

from app.models.node import NodeDefinition
from app.models.vm import VMDefinition
from app.services.inventory_service import safe_group_name
from app.services.playbook_util import dump_playbook


def _collect_hosts_with_roles(
    vms: list[VMDefinition],
    nodes: list[NodeDefinition],
) -> dict[str, list[str]]:
    """Build role -> [host_names] mapping."""
    from collections import defaultdict
    role_hosts: dict[str, list[str]] = defaultdict(list)
    for node in nodes:
        if not node.enabled:
            continue
        for role in node.roles:
            role_hosts[role].append(node.name)
    for vm in vms:
        if not vm.enabled:
            continue
        for role in vm.roles:
            role_hosts[role].append(vm.name)
    return dict(role_hosts)


def write_roles_playbook(
    workspace_dir: Path,
    vms: list[VMDefinition],
    nodes: list[NodeDefinition],
    filter_roles: set[str] | None = None,
    role_order: list[str] | None = None,
) -> None:
    """Generate playbook that applies roles to their assigned hosts."""
    role_hosts = _collect_hosts_with_roles(vms, nodes)
    plays: list[dict] = []

    if role_order:
        ordered = [r for r in role_order if r in role_hosts]
        remaining = sorted(set(role_hosts) - set(ordered))
        ordered_roles = ordered + remaining
    else:
        ordered_roles = sorted(role_hosts)

    for role in ordered_roles:
        if filter_roles is not None and role not in filter_roles:
            continue
        group = safe_group_name(role)
        plays.append({
            "name": f"Apply role '{role}'",
            "hosts": group,
            "become": True,
            "roles": [role],
        })

    if not plays:
        plays = [{
            "name": "No-op",
            "hosts": "localhost",
            "tasks": [{"debug": {"msg": "No roles to apply"}}],
        }]

    (workspace_dir / "playbook.yml").write_text(dump_playbook(plays))
