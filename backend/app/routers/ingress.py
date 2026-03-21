from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.config import settings
from app.services.service_store import ServiceStore

router = APIRouter()


class IngressRule(BaseModel):
    service_name: str
    hostname: str
    backend_port: int
    enabled: bool


def get_store() -> ServiceStore:
    return ServiceStore(settings.homelab_repo_path)


@router.get("/rules")
async def list_ingress_rules(store: ServiceStore = Depends(get_store)) -> list[IngressRule]:
    services = store.list_all()
    rules = []
    for svc in services:
        if svc.ingress is not None:
            rules.append(IngressRule(
                service_name=svc.name,
                hostname=svc.ingress.hostname,
                backend_port=svc.ingress.backend_port,
                enabled=svc.enabled,
            ))
    return rules
