from fastapi import APIRouter, Depends

from app.config import settings
from app.services.dns_service import DNSRecord, get_all_records
from app.services.service_store import ServiceStore

router = APIRouter()


def get_store() -> ServiceStore:
    return ServiceStore(settings.homelab_repo_path)


@router.get("/records")
async def list_dns_records(store: ServiceStore = Depends(get_store)) -> list[DNSRecord]:
    services = store.list_all()
    return get_all_records(services, settings.homelab_repo_path)
