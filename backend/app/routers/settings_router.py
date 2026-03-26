from fastapi import APIRouter
from pydantic import BaseModel

from app.config import settings
from app.services.dns_service import DNSSettings, get_settings as get_dns_settings
from app.services.global_settings import (
    GlobalSettings,
    get_global_settings,
    save_global_settings,
)
from app.services.ingress_service import (
    IngressSettings,
    get_settings as get_ingress_settings,
)

router = APIRouter()


class AppInfo(BaseModel):
    app_name: str
    homelab_repo_path: str
    homelab_remote_url: str
    log_level: str


class AllSettings(BaseModel):
    app: AppInfo
    global_settings: GlobalSettings
    dns: DNSSettings
    ingress: IngressSettings


@router.get("/")
async def get_all_settings() -> AllSettings:
    return AllSettings(
        app=AppInfo(
            app_name=settings.app_name,
            homelab_repo_path=settings.homelab_repo_path,
            homelab_remote_url=settings.homelab_remote_url,
            log_level=settings.log_level,
        ),
        global_settings=get_global_settings(settings.homelab_repo_path),
        dns=get_dns_settings(settings.homelab_repo_path),
        ingress=get_ingress_settings(settings.homelab_repo_path),
    )


@router.put("/global")
async def update_global_settings(body: GlobalSettings) -> GlobalSettings:
    save_global_settings(settings.homelab_repo_path, body)
    return body
