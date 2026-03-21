from app.models.hypervisor import HypervisorDefinition
from app.models.vm import VMDefinition


def generate_main_tf(
    vms: list[VMDefinition],
    hypervisors: list[HypervisorDefinition] | None = None,
) -> str:
    """Generate Terraform main.tf with bpg/proxmox provider and VM resources."""
    if hypervisors is None:
        hypervisors = []

    enabled_hvs = [hv for hv in hypervisors if hv.enabled]
    use_aliases = len(enabled_hvs) > 1

    lines = [
        'terraform {',
        '  required_providers {',
        '    proxmox = {',
        '      source  = "bpg/proxmox"',
        '      version = ">=0.38.0"',
        '    }',
        '  }',
        '}',
    ]

    if not enabled_hvs:
        lines.extend([
            '',
            'provider "proxmox" {',
            '  # Configured via environment variables:',
            '  # PROXMOX_VE_ENDPOINT, PROXMOX_VE_USERNAME, PROXMOX_VE_PASSWORD',
            '}',
        ])
    elif use_aliases:
        for hv in enabled_hvs:
            alias = hv.name.replace("-", "_")
            lines.extend([
                '',
                f'provider "proxmox" {{',
                f'  alias    = "{alias}"',
                f'  endpoint = "{hv.endpoint}"',
                f'  username = "{hv.username}"',
            ])
            if hv.token_name:
                lines.append(f'  # API token: {hv.token_name} (secret via PROXMOX_VE_API_TOKEN)')
            lines.append('}')
    else:
        hv = enabled_hvs[0]
        lines.extend([
            '',
            'provider "proxmox" {',
            f'  endpoint = "{hv.endpoint}"',
            f'  username = "{hv.username}"',
        ])
        if hv.token_name:
            lines.append(f'  # API token: {hv.token_name} (secret via PROXMOX_VE_API_TOKEN)')
        lines.append('}')

    hv_alias_map = {hv.name: hv.name.replace("-", "_") for hv in enabled_hvs}

    for vm in vms:
        if not vm.enabled:
            continue

        resource_name = vm.name.replace("-", "_")
        lines.extend([
            '',
            f'resource "proxmox_virtual_environment_vm" "{resource_name}" {{',
        ])

        if use_aliases and vm.node in hv_alias_map:
            lines.append(f'  provider  = proxmox.{hv_alias_map[vm.node]}')

        lines.extend([
            f'  name      = "{vm.name}"',
            f'  node_name = "{vm.node}"',
            '',
            '  cpu {',
            f'    cores = {vm.cpu}',
            '  }',
            '',
            '  memory {',
            f'    dedicated = {vm.memory}',
            '  }',
            '',
            '  disk {',
            '    datastore_id = "local-lvm"',
            f'    size         = {vm.disk}',
            '    interface    = "scsi0"',
            '  }',
            '',
            f'  clone {{',
            f'    vm_id = 9999  # Template ID for {vm.image}',
            '  }',
            '',
            '  initialization {',
            '    user_account {',
            f'      username = "{vm.user}"',
            f'      keys     = ["{vm.ssh_key}"]',
            '    }',
            '',
            '    ip_config {',
            '      ipv4 {',
            '        address = "dhcp"',
            '      }',
            '    }',
            '  }',
            '',
            '  tags = ["managed-by-rootstock", "role-' + vm.role + '"]',
            '}',
        ])

    return '\n'.join(lines) + '\n'
