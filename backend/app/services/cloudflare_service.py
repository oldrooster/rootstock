from app.models.container import ContainerDefinition
from app.services.ingress_service import ManualRule


def generate_tunnel_config(
    host: str,
    containers: list[ContainerDefinition],
    manual_rules: list[ManualRule],
    tunnel_name: str = "rootstock",
    credentials_file: str = "/etc/cloudflared/credentials.json",
) -> str:
    """Generate cloudflared tunnel config YAML for a given host.

    Includes external container services and external manual rules
    assigned to this host. All traffic routes through the local Caddy.
    """
    ingress_entries: list[str] = []

    for ctr in containers:
        if not ctr.enabled or not ctr.external or not ctr.dns_name:
            continue
        if ctr.ingress_mode == "none":
            continue
        if host not in ctr.hosts:
            continue
        ingress_entries.append(
            f"  - hostname: {ctr.dns_name}\n"
            f"    service: https://caddy:443"
        )

    for rule in manual_rules:
        if rule.caddy_host != host or not rule.external:
            continue
        ingress_entries.append(
            f"  - hostname: {rule.hostname}\n"
            f"    service: https://caddy:443"
        )

    if not ingress_entries:
        return ""

    # Always end with a catch-all
    ingress_entries.append("  - service: http_status:404")

    lines = [
        f"tunnel: {tunnel_name}",
        f"credentials-file: {credentials_file}",
        "ingress:",
        *ingress_entries,
    ]
    return "\n".join(lines)
