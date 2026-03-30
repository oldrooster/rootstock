import re
from collections import defaultdict
from io import StringIO

from ruamel.yaml import YAML

from app.models.node import NodeDefinition
from app.models.vm import VMDefinition


def safe_group_name(name: str) -> str:
    """Convert a role name to a valid Ansible group name (alphanumeric + underscores)."""
    return re.sub(r"[^a-zA-Z0-9_]", "_", name)


def generate_inventory(
    vms: list[VMDefinition],
    nodes: list[NodeDefinition] | None = None,
    ssh_key_files: dict[str, str] | None = None,
) -> str:
    """Generate Ansible inventory YAML grouped by role.

    Hosts can appear in multiple role groups if they have multiple roles.
    ssh_key_files: optional map of host_name -> path to private key file.
    """
    groups: dict[str, dict] = defaultdict(lambda: {"hosts": {}})
    all_hosts: dict[str, dict] = {}

    if nodes:
        for node in nodes:
            if not node.enabled:
                continue
            host_vars: dict[str, str] = {
                "ansible_host": node.endpoint.split("//")[-1].split(":")[0].split("/")[0],
                "ansible_user": node.ssh_user or "root",
            }
            if ssh_key_files and node.name in ssh_key_files:
                host_vars["ansible_ssh_private_key_file"] = ssh_key_files[node.name]
            all_hosts[node.name] = dict(host_vars)
            for role in node.roles:
                groups[safe_group_name(role)]["hosts"][node.name] = dict(host_vars)

    for vm in vms:
        if not vm.enabled:
            continue
        host_vars = {
            "ansible_host": vm.ip if vm.ip else vm.name,
            "ansible_user": vm.user,
        }
        if ssh_key_files and vm.name in ssh_key_files:
            host_vars["ansible_ssh_private_key_file"] = ssh_key_files[vm.name]
        all_hosts[vm.name] = dict(host_vars)
        for role in vm.roles:
            groups[safe_group_name(role)]["hosts"][vm.name] = dict(host_vars)

    if not all_hosts:
        return "# No hosts defined\nall:\n  hosts: {}\n"

    inventory: dict = {"all": {"hosts": all_hosts}}
    if groups:
        inventory["all"]["children"] = dict(groups)

    yaml = YAML()
    yaml.default_flow_style = False
    buf = StringIO()
    yaml.dump(inventory, buf)
    return buf.getvalue()
