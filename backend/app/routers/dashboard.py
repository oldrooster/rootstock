from fastapi import APIRouter, Depends

from app.config import settings
from app.models.dashboard import CommitInfo, DashboardData
from app.services.git_service import GitService
from app.services.hypervisor_store import HypervisorStore
from app.services.service_store import ServiceStore
from app.services.vm_store import VMStore

router = APIRouter()


def get_service_store() -> ServiceStore:
    return ServiceStore(settings.homelab_repo_path)


def get_vm_store() -> VMStore:
    return VMStore(settings.homelab_repo_path)


def get_git() -> GitService:
    return GitService(settings.homelab_repo_path)


def get_hv_store() -> HypervisorStore:
    return HypervisorStore(settings.homelab_repo_path)


@router.get("/")
async def get_dashboard(
    service_store: ServiceStore = Depends(get_service_store),
    vm_store: VMStore = Depends(get_vm_store),
    git: GitService = Depends(get_git),
    hv_store: HypervisorStore = Depends(get_hv_store),
) -> DashboardData:
    services = service_store.list_all()
    vms = vm_store.list_all()
    hypervisors = hv_store.list_all()

    hosts = sorted(set(
        [hv.name for hv in hypervisors]
        + [s.host for s in services]
        + [v.node for v in vms]
    ))

    commits = git.recent_commits(10)

    return DashboardData(
        total_services=len(services),
        enabled_services=sum(1 for s in services if s.enabled),
        total_vms=len(vms),
        enabled_vms=sum(1 for v in vms if v.enabled),
        total_hypervisors=len(hypervisors),
        hosts=hosts,
        recent_commits=[CommitInfo(**c) for c in commits],
    )
