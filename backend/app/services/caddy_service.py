from app.models.container import ContainerDefinition
from app.services.ingress_service import IngressSettings, ManualRule


def generate_caddyfile(
    containers: list[ContainerDefinition],
    host: str | None = None,
    manual_rules: list[ManualRule] | None = None,
    ingress_settings: IngressSettings | None = None,
) -> str:
    """Generate a Caddyfile for a given host.

    Includes:
    - Global block with ACME email and Cloudflare DNS challenge (if configured)
    - Container-derived reverse proxy rules (using Docker service name as upstream)
    - Manual proxy rules assigned to this host
    """
    blocks: list[str] = []

    # Global block
    global_lines: list[str] = []
    if ingress_settings and ingress_settings.acme_email:
        global_lines.append(f"    email {ingress_settings.acme_email}")
    if ingress_settings and ingress_settings.cloudflare_api_token_secret:
        global_lines.append(f"    acme_dns cloudflare {{env.CF_API_TOKEN}}")
    if global_lines:
        blocks.append("{\n" + "\n".join(global_lines) + "\n}")

    # Container-derived rules
    for ctr in containers:
        if not ctr.enabled or ctr.ingress_mode != "caddy":
            continue
        if not ctr.dns_name or not ctr.ingress_port:
            continue
        if host and host not in ctr.hosts:
            continue

        upstream = f"{ctr.name}:{ctr.ingress_port}"
        blocks.append(
            f"{ctr.dns_name} {{\n"
            f"    reverse_proxy {upstream}\n"
            f"}}"
        )

    # Manual proxy rules
    if manual_rules:
        for rule in manual_rules:
            if host and rule.caddy_host != host:
                continue
            # If backend is HTTPS, add tls_insecure_skip_verify for self-signed certs
            if rule.backend.lower().startswith("https://"):
                blocks.append(
                    f"{rule.hostname} {{\n"
                    f"    reverse_proxy {rule.backend} {{\n"
                    f"        transport http {{\n"
                    f"            tls\n"
                    f"            tls_insecure_skip_verify\n"
                    f"        }}\n"
                    f"    }}\n"
                    f"}}"
                )
            else:
                blocks.append(
                    f"{rule.hostname} {{\n"
                    f"    reverse_proxy {rule.backend}\n"
                    f"}}"
                )

    return "\n\n".join(blocks)
