from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.config import settings
from app.services.caddy_service import generate_caddyfile
from app.services.dns_service import DNSRecord, generate_pihole_custom_dns, get_all_records
from app.services.inventory_service import generate_inventory
from app.services.hypervisor_store import HypervisorStore
from app.services.service_store import ServiceStore
from app.services.terraform_service import generate_main_tf
from app.services.vm_store import VMStore

router = APIRouter()


class ApplyResult(BaseModel):
    caddyfile: str
    pihole_custom_dns: str
    dns_records: list[DNSRecord]
    terraform_main_tf: str
    ansible_inventory: str
    ansible_status: str


def get_service_store() -> ServiceStore:
    return ServiceStore(settings.homelab_repo_path)


def get_vm_store() -> VMStore:
    return VMStore(settings.homelab_repo_path)


def get_hv_store() -> HypervisorStore:
    return HypervisorStore(settings.homelab_repo_path)


class ApplyPreview(BaseModel):
    total_services: int
    enabled_services: int
    total_vms: int
    enabled_vms: int


@router.get("/")
async def apply_preview(
    service_store: ServiceStore = Depends(get_service_store),
    vm_store: VMStore = Depends(get_vm_store),
) -> ApplyPreview:
    services = service_store.list_all()
    vms = vm_store.list_all()
    return ApplyPreview(
        total_services=len(services),
        enabled_services=sum(1 for s in services if s.enabled),
        total_vms=len(vms),
        enabled_vms=sum(1 for v in vms if v.enabled),
    )


@router.post("/")
async def apply(
    service_store: ServiceStore = Depends(get_service_store),
    vm_store: VMStore = Depends(get_vm_store),
    hv_store: HypervisorStore = Depends(get_hv_store),
) -> ApplyResult:
    services = service_store.list_all()
    vms = vm_store.list_all()
    hypervisors = hv_store.list_all()

    caddyfile = generate_caddyfile(services)
    dns_records = get_all_records(services, settings.homelab_repo_path)
    pihole_dns = generate_pihole_custom_dns(dns_records)
    terraform_tf = generate_main_tf(vms, hypervisors)
    inventory = generate_inventory(vms)

    return ApplyResult(
        caddyfile=caddyfile,
        pihole_custom_dns=pihole_dns,
        dns_records=dns_records,
        terraform_main_tf=terraform_tf,
        ansible_inventory=inventory,
        ansible_status="configs generated, Ansible/Terraform execution not yet wired",
    )
