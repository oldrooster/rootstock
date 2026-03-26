from fastapi import APIRouter, Depends

from app.config import settings
from app.models.host import HostInfo
from app.services.container_store import ContainerStore
from app.services.node_store import NodeStore
from app.services.vm_store import VMStore

router = APIRouter()


def get_container_store() -> ContainerStore:
    return ContainerStore(settings.homelab_repo_path)


def get_vm_store() -> VMStore:
    return VMStore(settings.homelab_repo_path)


def get_node_store() -> NodeStore:
    return NodeStore(settings.homelab_repo_path)


@router.get("/")
async def list_hosts(
    container_store: ContainerStore = Depends(get_container_store),
    vm_store: VMStore = Depends(get_vm_store),
    node_store: NodeStore = Depends(get_node_store),
) -> list[HostInfo]:
    containers = container_store.list_all()
    vms = vm_store.list_all()
    nodes = node_store.list_all()

    hosts: dict[str, HostInfo] = {}

    for n in nodes:
        hosts[n.name] = HostInfo(
            name=n.name,
            type=n.type,
            status="configured" if n.enabled else "disabled",
        )

    for ctr in containers:
        for host in ctr.hosts:
            if host not in hosts:
                hosts[host] = HostInfo(
                    name=host,
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
