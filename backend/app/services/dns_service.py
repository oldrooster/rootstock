from pathlib import Path

from pydantic import BaseModel

from app.models.service import ServiceDefinition
from app.services import yaml_service


class DNSRecord(BaseModel):
    hostname: str
    ip: str
    source: str  # "service" or "static"


def get_all_records(services: list[ServiceDefinition], repo_path: str) -> list[DNSRecord]:
    """Merge DNS records from services and from dns/records.yml."""
    records: list[DNSRecord] = []

    for svc in services:
        if svc.dns is not None and svc.enabled:
            records.append(DNSRecord(
                hostname=svc.dns.hostname,
                ip=svc.dns.ip,
                source="service",
            ))

    static_path = Path(repo_path) / "dns" / "records.yml"
    static_data = yaml_service.read_yaml(static_path)
    for entry in static_data.get("static_records", []):
        records.append(DNSRecord(
            hostname=entry["hostname"],
            ip=entry["ip"],
            source="static",
        ))

    return records


def generate_pihole_custom_dns(records: list[DNSRecord]) -> str:
    """Generate Pi-hole custom.list format: one 'IP hostname' line per record."""
    return "\n".join(f"{r.ip} {r.hostname}" for r in records)
