from pathlib import Path

from pydantic import BaseModel

from app.models.container import ContainerDefinition
from app.services import yaml_service


class DNSRecord(BaseModel):
    hostname: str
    ip: str
    source: str  # "container" or "static"
    description: str = ""
    host: str = ""  # which node/VM this is derived from (for container records)


class DNSSettings(BaseModel):
    zones: list[dict] = []  # [{"name": "cbf.nz", "internal": true, "external": true}]
    pihole_host: str = ""  # node/VM name where Pi-hole runs
    pihole_config_path: str = "/etc/pihole/pihole.toml"


class StaticRecord(BaseModel):
    hostname: str
    ip: str
    description: str = ""


def _settings_path(repo_path: str) -> Path:
    return Path(repo_path) / "dns" / "settings.yml"


def _records_path(repo_path: str) -> Path:
    return Path(repo_path) / "dns" / "records.yml"


def get_settings(repo_path: str) -> DNSSettings:
    data = yaml_service.read_yaml(_settings_path(repo_path))
    return DNSSettings(**data) if data else DNSSettings()


def save_settings(repo_path: str, settings: DNSSettings) -> None:
    yaml_service.write_yaml(_settings_path(repo_path), settings.model_dump())


def get_static_records(repo_path: str) -> list[StaticRecord]:
    data = yaml_service.read_yaml(_records_path(repo_path))
    return [StaticRecord(**r) for r in data.get("static_records", [])]


def save_static_records(repo_path: str, records: list[StaticRecord]) -> None:
    yaml_service.write_yaml(
        _records_path(repo_path),
        {"static_records": [r.model_dump() for r in records]},
    )


def build_host_ip_map(nodes: list, vms: list | None = None) -> dict[str, str]:
    """Build a map of host name -> IP from node endpoints and VM names."""
    ip_map: dict[str, str] = {}
    for n in nodes:
        if n.endpoint:
            # Extract IP/host from endpoint URL
            host = n.endpoint.split("//")[-1].split(":")[0].split("/")[0]
            if host:
                ip_map[n.name] = host
    if vms:
        for vm in vms:
            if vm.name not in ip_map:
                ip_map[vm.name] = vm.ip if vm.ip else vm.name
    return ip_map


def get_all_records(
    containers: list[ContainerDefinition],
    repo_path: str,
    host_ip_map: dict[str, str] | None = None,
) -> list[DNSRecord]:
    """Merge DNS records from containers and from dns/records.yml."""
    records: list[DNSRecord] = []

    for ctr in containers:
        if not ctr.enabled or not ctr.dns_name:
            continue
        if ctr.ingress_mode == "none":
            continue
        for host in ctr.hosts:
            ip = (host_ip_map or {}).get(host, host)
            records.append(DNSRecord(
                hostname=ctr.dns_name,
                ip=ip,
                source="container",
                description=f"from container '{ctr.name}'",
                host=host,
            ))

    for sr in get_static_records(repo_path):
        records.append(DNSRecord(
            hostname=sr.hostname,
            ip=sr.ip,
            source="static",
            description=sr.description,
        ))

    return records


def generate_pihole_custom_dns(records: list[DNSRecord]) -> str:
    """Generate Pi-hole custom.list format: one 'IP hostname' line per record."""
    return "\n".join(f"{r.ip} {r.hostname}" for r in records)


def generate_pihole_toml_hosts(records: list[DNSRecord]) -> list[str]:
    """Generate the dns.hosts array entries for pihole.toml.

    Each entry is a string in the format 'IP hostname'.
    """
    return [f"{r.ip} {r.hostname}" for r in records]
