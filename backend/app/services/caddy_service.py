from app.models.service import ServiceDefinition


def generate_caddyfile(services: list[ServiceDefinition]) -> str:
    """Generate a Caddyfile from services that have ingress configured."""
    blocks = []
    for svc in services:
        if svc.ingress is not None and svc.enabled:
            block = (
                f"{svc.ingress.hostname} {{\n"
                f"    reverse_proxy {svc.dns.ip}:{svc.ingress.backend_port}\n"
                f"}}"
            ) if svc.dns else (
                f"{svc.ingress.hostname} {{\n"
                f"    reverse_proxy localhost:{svc.ingress.backend_port}\n"
                f"}}"
            )
            blocks.append(block)

    return "\n\n".join(blocks)
