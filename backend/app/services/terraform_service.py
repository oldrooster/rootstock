from app.models.node import NodeDefinition
from app.models.template import TemplateDefinition
from app.models.vm import VMDefinition


# ---------------------------------------------------------------------------
# Internal helpers — each produces a list of HCL lines for one resource block
# ---------------------------------------------------------------------------

def _endpoint_host(endpoint: str) -> str:
    """Extract host/IP from an endpoint URL like https://10.0.2.19:8006."""
    host = endpoint.split("//")[-1]
    host = host.split(":")[0]
    host = host.split("/")[0]
    return host


def _hv_variables(hv: NodeDefinition, alias: str) -> list[str]:
    """Variable declarations for a hypervisor (API token + SSH private key)."""
    return [
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
    ]


def _provider_block(hv: NodeDefinition, alias: str, use_alias: bool) -> list[str]:
    """Provider block for a single hypervisor."""
    lines: list[str] = _hv_variables(hv, alias)

    if use_alias:
        lines.append(f'provider "proxmox" {{')
        lines.append(f'  alias    = "{alias}"')
    else:
        lines.append('provider "proxmox" {')
    lines.append(f'  endpoint = "{hv.endpoint}"')
    if hv.token_name:
        lines.append(f'  api_token = var.proxmox_api_token_{alias}')
    lines.append('  insecure = true')
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


def _image_download_variable(res_name: str, node: str, cloud_image: str) -> list[str]:
    """Variable + download resource for a cloud image."""
    dl_file_name = cloud_image
    if dl_file_name.endswith('.qcow2'):
        dl_file_name = dl_file_name[:-6] + '.img'
    return [
        '',
        f'variable "image_url_{res_name}" {{',
        '  type        = string',
        f'  description = "Download URL for {cloud_image} on {node}"',
        '  default     = ""',
        '}',
    ]


def _image_download_resource(
    res_name: str,
    node: str,
    cloud_image: str,
    use_aliases: bool,
    hv_alias_map: dict[str, str],
    pve_node_map: dict[str, str],
) -> list[str]:
    dl_file_name = cloud_image
    if dl_file_name.endswith('.qcow2'):
        dl_file_name = dl_file_name[:-6] + '.img'
    lines = [
        '',
        f'resource "proxmox_virtual_environment_download_file" "{res_name}" {{',
    ]
    if use_aliases and node in hv_alias_map:
        lines.append(f'  provider       = proxmox.{hv_alias_map[node]}')
    lines.extend([
        '  content_type   = "iso"',
        '  datastore_id   = "local"',
        f'  node_name      = "{pve_node_map.get(node, node)}"',
        f'  file_name      = "{dl_file_name}"',
        f'  url            = var.image_url_{res_name}',
        '  overwrite      = false',
        '}',
    ])
    return lines


def _vm_resource(
    vm: VMDefinition,
    tpl: TemplateDefinition | None,
    image_downloads: dict[tuple[str, str], str],
    use_aliases: bool,
    hv_alias_map: dict[str, str],
    pve_node_map: dict[str, str],
    snippets_map: dict[str, str],
) -> list[str]:
    """VM resource + vendor config + SSH key variable blocks."""
    cloud_image = vm.image or (tpl.cloud_image if tpl else "")
    cpu = vm.cpu or (tpl.cpu if tpl else 2)
    cpu_type = vm.cpu_type or "host"
    memory = vm.memory or (tpl.memory if tpl else 4096)
    disk = vm.disk or (tpl.disk if tpl else 32)
    user = vm.user or (tpl.user if tpl else "deploy")
    timezone = tpl.timezone if tpl else "Pacific/Auckland"
    locale = tpl.locale if tpl else "en_NZ.UTF-8"

    net_gw = ""
    net_dns = ""
    subnet_mask = "/24"
    if tpl and tpl.network:
        net_gw = tpl.network.gateway
        net_dns = tpl.network.dns
        subnet_mask = tpl.network.subnet_mask or "/24"
    use_static = bool(vm.ip)
    net_ip = f"{vm.ip}{subnet_mask}" if vm.ip and "/" not in vm.ip else vm.ip

    resource_name = vm.name.replace("-", "_")
    lines: list[str] = [
        '',
        f'resource "proxmox_virtual_environment_vm" "{resource_name}" {{',
    ]
    if use_aliases and vm.node in hv_alias_map:
        lines.append(f'  provider  = proxmox.{hv_alias_map[vm.node]}')
    lines.extend([
        f'  name      = "{vm.name}"',
        f'  node_name = "{pve_node_map.get(vm.node, vm.node)}"',
        '  machine   = "q35"',
        '',
        '  agent {',
        '    enabled = true',
        '  }',
        '',
        '  cpu {',
        f'    cores = {cpu}',
        f'    type  = "{cpu_type}"',
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
    ])
    if cloud_image:
        dl_res = image_downloads[(vm.node, cloud_image)]
        lines.append(f'    file_id      = proxmox_virtual_environment_download_file.{dl_res}.id')
    lines.extend([
        '  }',
        '',
        '  network_device {',
        '    bridge = "vmbr0"',
        '  }',
    ])

    if vm.gpu_passthrough:
        lines.extend([
            '',
            '  hostpci {',
            '    device  = "hostpci0"',
            '    mapping = "iGPU"',
            '    pcie    = true',
            '    rombar  = true',
            '  }',
        ])

    lines.extend([
        '',
        '  initialization {',
        '    datastore_id = "local-lvm"',
        '',
        '    user_account {',
        f'      username = "{user}"',
        f'      keys     = [var.ssh_public_key_{resource_name}]',
        '    }',
        '',
        '    ip_config {',
        '      ipv4 {',
    ])
    if use_static and net_ip:
        lines.append(f'        address = "{net_ip}"')
        if net_gw:
            lines.append(f'        gateway = "{net_gw}"')
    else:
        lines.append('        address = "dhcp"')
    lines.extend(['      }', '    }'])

    if use_static and net_dns:
        lines.extend([
            '',
            '    dns {',
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

    # Vendor (cloud-init) config
    lines.extend([
        '',
        f'resource "proxmox_virtual_environment_file" "{resource_name}_vendor_config" {{',
    ])
    if use_aliases and vm.node in hv_alias_map:
        lines.append(f'  provider     = proxmox.{hv_alias_map[vm.node]}')
    lines.extend([
        '  content_type = "snippets"',
        f'  datastore_id = "{snippets_map.get(vm.node, "local")}"',
        f'  node_name    = "{pve_node_map.get(vm.node, vm.node)}"',
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

    # SSH public key variable
    lines.extend([
        '',
        f'variable "ssh_public_key_{resource_name}" {{',
        '  type        = string',
        f'  description = "SSH public key for {vm.name}"',
        '  default     = ""',
        '}',
    ])

    return lines


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

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

    lines: list[str] = [
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
    pve_node_map = {hv.name: hv.node_name or hv.name for hv in enabled_hvs}
    snippets_map = {hv.name: hv.snippets_storage or "local" for hv in enabled_hvs}

    # Deduplicate image downloads
    image_downloads: dict[tuple[str, str], str] = {}
    for vm in vms:
        if not vm.enabled:
            continue
        tpl = template_map.get(vm.template) if vm.template else None
        cloud_image = vm.image or (tpl.cloud_image if tpl else "")
        if cloud_image:
            key = (vm.node, cloud_image)
            if key not in image_downloads:
                safe_img = cloud_image.replace("-", "_").replace(".", "_")
                safe_node = vm.node.replace("-", "_")
                image_downloads[key] = f"image_{safe_img}_on_{safe_node}"

    for (node, cloud_image), res_name in image_downloads.items():
        lines.extend(_image_download_variable(res_name, node, cloud_image))
        lines.extend(_image_download_resource(res_name, node, cloud_image, use_aliases, hv_alias_map, pve_node_map))

    for vm in vms:
        if not vm.enabled:
            continue
        tpl = template_map.get(vm.template) if vm.template else None
        lines.extend(_vm_resource(vm, tpl, image_downloads, use_aliases, hv_alias_map, pve_node_map, snippets_map))

    return '\n'.join(lines) + '\n'
