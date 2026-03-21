from fastapi import APIRouter, Depends

from app.config import settings
from app.models.host import HostInfo
from app.services.hypervisor_store import HypervisorStore
from app.services.service_store import ServiceStore
from app.services.vm_store import VMStore

router = APIRouter()


def get_service_store() -> ServiceStore:
    return ServiceStore(settings.homelab_repo_path)


def get_vm_store() -> VMStore:
    return VMStore(settings.homelab_repo_path)


def get_hv_store() -> HypervisorStore:
    return HypervisorStore(settings.homelab_repo_path)


@router.get("/")
async def list_hosts(
    service_store: ServiceStore = Depends(get_service_store),
    vm_store: VMStore = Depends(get_vm_store),
    hv_store: HypervisorStore = Depends(get_hv_store),
) -> list[HostInfo]:
    services = service_store.list_all()
    vms = vm_store.list_all()
    hypervisors = hv_store.list_all()

    hosts: dict[str, HostInfo] = {}

    for hv in hypervisors:
        hosts[hv.name] = HostInfo(
            name=hv.name,
            type="proxmox",
            status="configured" if hv.enabled else "disabled",
        )

    for svc in services:
        if svc.host not in hosts:
            hosts[svc.host] = HostInfo(
                name=svc.host,
                type="container_host",
                status="configured",
            )

    for vm in vms:
        if vm.node not in hosts:
            hosts[vm.node] = HostInfo(
                name=vm.node,
                type="proxmox",
                status="configured",
            )

    return sorted(hosts.values(), key=lambda h: h.name)
