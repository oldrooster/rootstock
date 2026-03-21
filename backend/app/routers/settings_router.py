from fastapi import APIRouter
from pydantic import BaseModel

from app.config import settings

router = APIRouter()


class SettingsResponse(BaseModel):
    app_name: str
    homelab_repo_path: str
    homelab_remote_url: str
    log_level: str


@router.get("/")
async def get_settings() -> SettingsResponse:
    return SettingsResponse(
        app_name=settings.app_name,
        homelab_repo_path=settings.homelab_repo_path,
        homelab_remote_url=settings.homelab_remote_url,
        log_level=settings.log_level,
    )
