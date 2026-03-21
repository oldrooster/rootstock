from collections import defaultdict

from ruamel.yaml import YAML
from io import StringIO

from app.models.vm import VMDefinition


def generate_inventory(vms: list[VMDefinition]) -> str:
    """Generate Ansible inventory YAML grouped by VM role."""
    groups: dict[str, dict] = defaultdict(lambda: {"hosts": {}})

    for vm in vms:
        if not vm.enabled:
            continue
        groups[vm.role]["hosts"][vm.name] = {
            "ansible_host": vm.name,
            "ansible_user": vm.user,
        }

    if not groups:
        return "# No VMs defined\nall:\n  hosts: {}\n"

    inventory = {"all": {"children": dict(groups)}}

    yaml = YAML()
    yaml.default_flow_style = False
    buf = StringIO()
    yaml.dump(inventory, buf)
    return buf.getvalue()
