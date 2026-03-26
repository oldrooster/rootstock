from fastapi import APIRouter, Depends

from app.config import settings
from app.models.dashboard import CommitInfo, DashboardData
from app.services.container_store import ContainerStore
from app.services.git_service import GitService
from app.services.node_store import NodeStore
from app.services.vm_store import VMStore

router = APIRouter()


def get_container_store() -> ContainerStore:
    return ContainerStore(settings.homelab_repo_path)


def get_vm_store() -> VMStore:
    return VMStore(settings.homelab_repo_path)


def get_git() -> GitService:
    return GitService(settings.homelab_repo_path)


def get_node_store() -> NodeStore:
    return NodeStore(settings.homelab_repo_path)


@router.get("/")
async def get_dashboard(
    container_store: ContainerStore = Depends(get_container_store),
    vm_store: VMStore = Depends(get_vm_store),
    git: GitService = Depends(get_git),
    node_store: NodeStore = Depends(get_node_store),
) -> DashboardData:
    containers = container_store.list_all()
    vms = vm_store.list_all()
    nodes = node_store.list_all()

    host_names = set(n.name for n in nodes)
    for ctr in containers:
        host_names.update(ctr.hosts)
    for v in vms:
        host_names.add(v.node)
    hosts = sorted(host_names)

    commits = git.recent_commits(10)

    return DashboardData(
        total_services=len(containers),
        enabled_services=sum(1 for c in containers if c.enabled),
        total_vms=len(vms),
        enabled_vms=sum(1 for v in vms if v.enabled),
        total_nodes=len(nodes),
        hosts=hosts,
        recent_commits=[CommitInfo(**c) for c in commits],
    )
