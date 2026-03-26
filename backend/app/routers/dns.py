from fastapi import APIRouter, Depends, HTTPException

from app.config import settings
from app.services.container_store import ContainerStore
from app.services.node_store import NodeStore
from app.services.vm_store import VMStore
from app.services.dns_service import (
    DNSRecord,
    DNSSettings,
    StaticRecord,
    build_host_ip_map,
    generate_pihole_custom_dns,
    generate_pihole_toml_hosts,
    get_all_records,
    get_settings,
    get_static_records,
    save_settings,
    save_static_records,
)

router = APIRouter()


def get_container_store() -> ContainerStore:
    return ContainerStore(settings.homelab_repo_path)


def get_node_store() -> NodeStore:
    return NodeStore(settings.homelab_repo_path)


def get_vm_store() -> VMStore:
    return VMStore(settings.homelab_repo_path)


def _build_ip_map(node_store: NodeStore, vm_store: VMStore) -> dict[str, str]:
    nodes = node_store.list_all()
    vms = vm_store.list_all()
    return build_host_ip_map(nodes, vms)


# --- Settings ---


@router.get("/settings")
async def get_dns_settings() -> DNSSettings:
    return get_settings(settings.homelab_repo_path)


@router.put("/settings")
async def update_dns_settings(body: DNSSettings) -> DNSSettings:
    save_settings(settings.homelab_repo_path, body)
    return body


# --- Static records ---


@router.get("/static")
async def list_static_records() -> list[StaticRecord]:
    return get_static_records(settings.homelab_repo_path)


@router.post("/static")
async def add_static_record(record: StaticRecord) -> list[StaticRecord]:
    if not record.hostname or not record.hostname.strip():
        raise HTTPException(400, "Hostname is required")
    if not record.ip or not record.ip.strip():
        raise HTTPException(400, "IP address is required")
    records = get_static_records(settings.homelab_repo_path)
    # Prevent duplicate hostname
    if any(r.hostname == record.hostname for r in records):
        raise HTTPException(400, f"Static record '{record.hostname}' already exists")
    records.append(record)
    save_static_records(settings.homelab_repo_path, records)
    return records


@router.put("/static/{hostname}")
async def update_static_record(hostname: str, record: StaticRecord) -> list[StaticRecord]:
    records = get_static_records(settings.homelab_repo_path)
    found = False
    for i, r in enumerate(records):
        if r.hostname == hostname:
            records[i] = record
            found = True
            break
    if not found:
        raise HTTPException(404, f"Static record '{hostname}' not found")
    save_static_records(settings.homelab_repo_path, records)
    return records


@router.delete("/static/by-index/{index}")
async def delete_static_record_by_index(index: int) -> list[StaticRecord]:
    records = get_static_records(settings.homelab_repo_path)
    if index < 0 or index >= len(records):
        raise HTTPException(404, f"Static record index {index} out of range")
    records.pop(index)
    save_static_records(settings.homelab_repo_path, records)
    return records


@router.delete("/static/{hostname}")
async def delete_static_record(hostname: str) -> list[StaticRecord]:
    records = get_static_records(settings.homelab_repo_path)
    new_records = [r for r in records if r.hostname != hostname]
    if len(new_records) == len(records):
        raise HTTPException(404, f"Static record '{hostname}' not found")
    save_static_records(settings.homelab_repo_path, new_records)
    return new_records


# --- All records (derived + static) ---


@router.get("/records")
async def list_dns_records(
    store: ContainerStore = Depends(get_container_store),
    node_store: NodeStore = Depends(get_node_store),
    vm_store: VMStore = Depends(get_vm_store),
) -> list[DNSRecord]:
    containers = store.list_all()
    ip_map = _build_ip_map(node_store, vm_store)
    return get_all_records(containers, settings.homelab_repo_path, ip_map)


# --- Generated outputs ---


@router.get("/preview/custom-list")
async def preview_custom_list(
    store: ContainerStore = Depends(get_container_store),
    node_store: NodeStore = Depends(get_node_store),
    vm_store: VMStore = Depends(get_vm_store),
) -> dict[str, str]:
    containers = store.list_all()
    ip_map = _build_ip_map(node_store, vm_store)
    records = get_all_records(containers, settings.homelab_repo_path, ip_map)
    return {"content": generate_pihole_custom_dns(records)}


@router.get("/preview/pihole-toml")
async def preview_pihole_toml(
    store: ContainerStore = Depends(get_container_store),
    node_store: NodeStore = Depends(get_node_store),
    vm_store: VMStore = Depends(get_vm_store),
) -> dict[str, str]:
    containers = store.list_all()
    ip_map = _build_ip_map(node_store, vm_store)
    records = get_all_records(containers, settings.homelab_repo_path, ip_map)
    hosts = generate_pihole_toml_hosts(records)
    # Preview as TOML array
    lines = ["[dns]", "hosts = ["]
    for h in hosts:
        lines.append(f'  "{h}",')
    lines.append("]")
    return {"content": "\n".join(lines)}
