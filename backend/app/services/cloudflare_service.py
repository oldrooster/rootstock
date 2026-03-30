import logging

import httpx

from app.models.container import ContainerDefinition
from app.services.ingress_service import ManualRule

logger = logging.getLogger(__name__)

CF_API_BASE = "https://api.cloudflare.com/client/v4"


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


# --- Cloudflare API helpers ---


def _cf_headers(api_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}


def get_account_id(api_token: str) -> str:
    """Get the account ID associated with this API token.

    Tries /user/tokens/verify first (works without Account:Read permission),
    then falls back to /accounts endpoint.
    """
    # Try token verify — returns the token's associated policies with account IDs
    try:
        r = httpx.get(f"{CF_API_BASE}/user/tokens/verify", headers=_cf_headers(api_token))
        r.raise_for_status()
        # Extract account ID from token policies
        policies = r.json().get("result", {}).get("policies", [])
        for policy in policies:
            for resource_group in policy.get("permission_groups", []):
                pass  # permission_groups don't contain account IDs
            resources = policy.get("resources", {})
            for resource_key in resources:
                # Resource keys look like "com.cloudflare.api.account.{account_id}"
                if "com.cloudflare.api.account." in resource_key:
                    account_id = resource_key.split("com.cloudflare.api.account.")[-1]
                    if account_id and account_id != "*":
                        return account_id
    except Exception as e:
        logger.debug("Token verify approach failed: %s", e)

    # Fallback: list accounts (requires Account:Read)
    r = httpx.get(f"{CF_API_BASE}/accounts", headers=_cf_headers(api_token), params={"per_page": 1})
    r.raise_for_status()
    accounts = r.json().get("result", [])
    if not accounts:
        raise RuntimeError(
            "Could not determine Cloudflare account ID. "
            "Either add 'Account:Read' permission to your API token, "
            "or set 'cloudflare_account_id' in ingress settings."
        )
    return accounts[0]["id"]


def list_tunnels(api_token: str, account_id: str) -> list[dict]:
    """List active Cloudflare tunnels."""
    r = httpx.get(
        f"{CF_API_BASE}/accounts/{account_id}/cfd_tunnel",
        headers=_cf_headers(api_token),
        params={"is_deleted": False, "per_page": 100},
    )
    if not r.is_success:
        detail = r.json().get("errors", r.text)
        raise RuntimeError(f"Cloudflare list tunnels failed: {detail}")
    return r.json().get("result", [])


def create_tunnel(api_token: str, account_id: str, name: str) -> dict:
    """Create a new Cloudflare tunnel and return the full tunnel object."""
    import base64
    import secrets as _secrets

    # CF API requires tunnel_secret as a base64-encoded 32-byte value
    tunnel_secret = base64.b64encode(_secrets.token_bytes(32)).decode()

    r = httpx.post(
        f"{CF_API_BASE}/accounts/{account_id}/cfd_tunnel",
        headers=_cf_headers(api_token),
        json={
            "name": name,
            "tunnel_secret": tunnel_secret,
            "config_src": "cloudflare",
        },
    )
    if not r.is_success:
        detail = r.json().get("errors", r.text)
        raise RuntimeError(f"Cloudflare tunnel create failed: {detail}")
    return r.json()["result"]


def get_tunnel_token(api_token: str, account_id: str, tunnel_id: str) -> str:
    """Get the connector token for an existing tunnel."""
    r = httpx.get(
        f"{CF_API_BASE}/accounts/{account_id}/cfd_tunnel/{tunnel_id}/token",
        headers=_cf_headers(api_token),
    )
    r.raise_for_status()
    return r.json()["result"]


def get_zone_id(api_token: str, domain: str) -> str:
    """Get the zone ID for a domain."""
    r = httpx.get(
        f"{CF_API_BASE}/zones",
        headers=_cf_headers(api_token),
        params={"name": domain},
    )
    r.raise_for_status()
    zones = r.json().get("result", [])
    if not zones:
        raise RuntimeError(f"No Cloudflare zone found for domain '{domain}'")
    return zones[0]["id"]


def ensure_tunnel_dns(
    api_token: str,
    account_id: str,
    zone_id: str,
    tunnel_id: str,
    hostname: str,
) -> None:
    """Create or update a CNAME DNS record pointing hostname to the tunnel."""
    tunnel_target = f"{tunnel_id}.cfargotunnel.com"

    # Check for existing record
    r = httpx.get(
        f"{CF_API_BASE}/zones/{zone_id}/dns_records",
        headers=_cf_headers(api_token),
        params={"type": "CNAME", "name": hostname},
    )
    r.raise_for_status()
    existing = r.json().get("result", [])

    record_data = {
        "type": "CNAME",
        "name": hostname,
        "content": tunnel_target,
        "proxied": True,
    }

    if existing:
        record_id = existing[0]["id"]
        if existing[0]["content"] != tunnel_target:
            r = httpx.put(
                f"{CF_API_BASE}/zones/{zone_id}/dns_records/{record_id}",
                headers=_cf_headers(api_token),
                json=record_data,
            )
            r.raise_for_status()
            logger.info("Updated DNS CNAME %s -> %s", hostname, tunnel_target)
    else:
        r = httpx.post(
            f"{CF_API_BASE}/zones/{zone_id}/dns_records",
            headers=_cf_headers(api_token),
            json=record_data,
        )
        r.raise_for_status()
        logger.info("Created DNS CNAME %s -> %s", hostname, tunnel_target)


def ensure_tunnel_for_host(
    api_token: str,
    account_id: str,
    host: str,
    hostnames: list[str],
    zone_id: str | None = None,
) -> str:
    """Ensure a tunnel exists for a host, create DNS records, and return the tunnel token.

    - Creates tunnel named 'rootstock-{host}' if it doesn't exist
    - Creates CNAME DNS records for each hostname pointing to the tunnel
    - Returns the tunnel connector token
    """
    tunnel_name = f"rootstock-{host}"

    # Find or create tunnel
    tunnels = list_tunnels(api_token, account_id)
    tunnel = next((t for t in tunnels if t["name"] == tunnel_name), None)

    if tunnel:
        tunnel_id = tunnel["id"]
        logger.info("Found existing tunnel '%s' (id=%s)", tunnel_name, tunnel_id)
    else:
        tunnel = create_tunnel(api_token, account_id, tunnel_name)
        tunnel_id = tunnel["id"]
        logger.info("Created tunnel '%s' (id=%s)", tunnel_name, tunnel_id)

    # Create DNS records if zone_id provided
    if zone_id:
        for hostname in hostnames:
            try:
                ensure_tunnel_dns(api_token, account_id, zone_id, tunnel_id, hostname)
            except Exception as e:
                logger.warning("Failed to create DNS for %s: %s", hostname, e)

    # Get token
    token = get_tunnel_token(api_token, account_id, tunnel_id)
    return token


def collect_external_hostnames(
    host: str,
    containers: list[ContainerDefinition],
    manual_rules: list[ManualRule],
) -> list[str]:
    """Collect all external hostnames for a given host."""
    hostnames: list[str] = []
    for ctr in containers:
        if not ctr.enabled or not ctr.external or not ctr.dns_name:
            continue
        if ctr.ingress_mode == "none":
            continue
        if host not in ctr.hosts:
            continue
        hostnames.append(ctr.dns_name)
    for rule in manual_rules:
        if rule.caddy_host != host or not rule.external:
            continue
        hostnames.append(rule.hostname)
    return hostnames
