from app.models.node import NodeDefinition
from app.models.template import TemplateDefinition
from app.models.vm import VMDefinition


def _provider_block(
    hv: NodeDefinition,
    alias: str,
    use_alias: bool,
) -> list[str]:
    """Generate a provider block with API token and SSH config."""
    lines: list[str] = []

    # Variables for this hypervisor
    lines.extend([
        '',
        f'variable "proxmox_api_token_{alias}" {{',
        '  type      = string',
        '  sensitive = true',
        f'  description = "API token for hypervisor {hv.name}"',
        '  default   = ""',
        '}',
        '',
        f'variable "proxmox_ssh_private_key_{alias}" {{',
        '  type      = string',
        '  sensitive = true',
        f'  description = "SSH private key for hypervisor {hv.name}"',
        '  default   = ""',
        '}',
        '',
    ])

    # Provider block
    if use_alias:
        lines.append(f'provider "proxmox" {{')
        lines.append(f'  alias    = "{alias}"')
    else:
        lines.append('provider "proxmox" {')
    lines.append(f'  endpoint = "{hv.endpoint}"')
    if hv.token_name:
        lines.append(f'  api_token = var.proxmox_api_token_{alias}')
    lines.append('  insecure = true')

    # SSH block for file uploads and cloud-init drive creation
    lines.extend([
        '',
        '  ssh {',
        '    agent       = false',
        '    username    = "root"',
        f'    private_key = var.proxmox_ssh_private_key_{alias}',
        '',
        '    node {',
        f'      name    = "{hv.node_name}"',
        f'      address = "{_endpoint_host(hv.endpoint)}"',
        '    }',
        '  }',
        '}',
    ])

    return lines


def _endpoint_host(endpoint: str) -> str:
    """Extract host/IP from an endpoint URL like https://10.0.2.19:8006."""
    host = endpoint.split("//")[-1]  # strip scheme
    host = host.split(":")[0]  # strip port
    host = host.split("/")[0]  # strip path
    return host


def generate_main_tf(
    vms: list[VMDefinition],
    nodes: list[NodeDefinition] | None = None,
    templates: list[TemplateDefinition] | None = None,
) -> str:
    """Generate Terraform main.tf with bpg/proxmox provider and VM resources."""
    if nodes is None:
        nodes = []
    if templates is None:
        templates = []

    template_map = {t.name: t for t in templates}
    enabled_hvs = [hv for hv in nodes if hv.enabled]
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
    else:
        for hv in enabled_hvs:
            alias = hv.name.replace("-", "_")
            lines.extend(_provider_block(hv, alias, use_aliases))

    hv_alias_map = {hv.name: hv.name.replace("-", "_") for hv in enabled_hvs}

    # Deduplicate image downloads: one resource per (node, image_filename)
    # Collect which images are needed on which nodes
    image_downloads: dict[tuple[str, str], str] = {}  # (node, filename) -> resource_name
    for vm in vms:
        if not vm.enabled:
            continue
        tpl = template_map.get(vm.template) if vm.template else None
        cloud_image = vm.image or (tpl.cloud_image if tpl else "")
        if cloud_image:
            key = (vm.node, cloud_image)
            if key not in image_downloads:
                # Use sanitized image name for resource, e.g. "ubuntu_24_04_minimal_cloudimg_amd64_img_on_g2minihv"
                safe_img = cloud_image.replace("-", "_").replace(".", "_")
                safe_node = vm.node.replace("-", "_")
                image_downloads[key] = f"image_{safe_img}_on_{safe_node}"

    # Emit shared image download resources
    for (node, cloud_image), res_name in image_downloads.items():
        # Variable for the image URL
        lines.extend([
            '',
            f'variable "image_url_{res_name}" {{',
            '  type        = string',
            f'  description = "Download URL for {cloud_image} on {node}"',
            '  default     = ""',
            '}',
        ])
        # Download resource
        lines.extend([
            '',
            f'resource "proxmox_virtual_environment_download_file" "{res_name}" {{',
        ])
        if use_aliases and node in hv_alias_map:
            lines.append(f'  provider       = proxmox.{hv_alias_map[node]}')
        lines.extend([
            '  content_type   = "iso"',
            '  datastore_id   = "local"',
            f'  node_name      = "{node}"',
            f'  file_name      = "{cloud_image}"',
            f'  url            = var.image_url_{res_name}',
            '  overwrite      = false',
            '}',
        ])

    for vm in vms:
        if not vm.enabled:
            continue

        # Resolve template defaults
        tpl = template_map.get(vm.template) if vm.template else None
        cloud_image = vm.image or (tpl.cloud_image if tpl else "")
        cpu = vm.cpu or (tpl.cpu if tpl else 2)
        memory = vm.memory or (tpl.memory if tpl else 4096)
        disk = vm.disk or (tpl.disk if tpl else 32)
        user = vm.user or (tpl.user if tpl else "deploy")
        ssh_key = vm.ssh_key or (tpl.ssh_key_secret if tpl else "")
        timezone = tpl.timezone if tpl else "Pacific/Auckland"
        locale = tpl.locale if tpl else "en_NZ.UTF-8"

        # Network config: VM ip takes precedence, template provides subnet/gw/dns
        net_gw = ""
        net_dns = ""
        subnet_mask = "/24"
        if tpl and tpl.network:
            net_gw = tpl.network.gateway
            net_dns = tpl.network.dns
            subnet_mask = tpl.network.subnet_mask or "/24"
        # If VM has an IP, use static; otherwise use template type or dhcp
        use_static = bool(vm.ip)
        net_ip = f"{vm.ip}{subnet_mask}" if vm.ip and "/" not in vm.ip else vm.ip

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
            '  agent {',
            '    enabled = true',
            '  }',
            '',
            '  cpu {',
            f'    cores = {cpu}',
            '  }',
            '',
            '  memory {',
            f'    dedicated = {memory}',
            '  }',
            '',
            '  disk {',
            '    datastore_id = "local-lvm"',
            f'    size         = {disk}',
            '    interface    = "scsi0"',
            f'    file_id      = proxmox_virtual_environment_download_file.{image_downloads.get((vm.node, cloud_image), resource_name + "_image")}.id',
            '  }',
            '',
            '  network_device {',
            '    bridge = "vmbr0"',
            '  }',
            '',
            '  initialization {',
            '    datastore_id = "local-lvm"',
            '',
            '    user_account {',
            f'      username = "{user}"',
            f'      keys     = [var.ssh_public_key_{resource_name}]',
            '    }',
        ])

        # Network
        lines.append('')
        lines.append('    ip_config {')
        lines.append('      ipv4 {')
        if use_static and net_ip:
            lines.append(f'        address = "{net_ip}"')
            if net_gw:
                lines.append(f'        gateway = "{net_gw}"')
        else:
            lines.append('        address = "dhcp"')
        lines.append('      }')
        lines.append('    }')

        if use_static and net_dns:
            lines.extend([
                '',
                f'    dns {{',
                f'      servers = ["{net_dns}"]',
                '    }',
            ])

        lines.extend([
            '',
            f'    vendor_data_file_id = proxmox_virtual_environment_file.{resource_name}_vendor_config.id',
            '  }',
            '',
            '  tags = ["managed-by-rootstock"' + ''.join(f', "role-{r}"' for r in vm.roles) + ']',
            '}',
        ])

        # Cloud-init vendor config (installs qemu-guest-agent)
        lines.extend([
            '',
            f'resource "proxmox_virtual_environment_file" "{resource_name}_vendor_config" {{',
        ])
        if use_aliases and vm.node in hv_alias_map:
            lines.append(f'  provider     = proxmox.{hv_alias_map[vm.node]}')
        lines.extend([
            '  content_type = "snippets"',
            '  datastore_id = "local"',
            f'  node_name    = "{vm.node}"',
            '',
            '  source_raw {',
            f'    file_name = "{vm.name}-vendor-config.yaml"',
            '    data      = <<EOF',
            '#cloud-config',
            'package_update: true',
            'packages:',
            '  - qemu-guest-agent',
            'runcmd:',
            '  - systemctl enable --now qemu-guest-agent',
            'EOF',
            '  }',
            '}',
        ])

        # SSH key variable for this VM
        lines.extend([
            '',
            f'variable "ssh_public_key_{resource_name}" {{',
            '  type        = string',
            f'  description = "SSH public key for {vm.name}"',
            '  default     = ""',
            '}',
        ])

    return '\n'.join(lines) + '\n'
