import asyncio

from fastapi import APIRouter
from pydantic import BaseModel

from app.config import settings
from app.services import stats_collector
from app.services.stats_collector import StatsSnapshot
from app.services.global_settings import get_global_settings, save_global_settings

router = APIRouter()


@router.get("/latest")
async def get_latest() -> StatsSnapshot:
    snap = stats_collector.get_latest()
    return snap if snap is not None else StatsSnapshot(timestamp=0)


@router.get("/history")
async def get_history() -> list[StatsSnapshot]:
    return stats_collector.get_history()


class StatsStatus(BaseModel):
    running: bool
    interval_seconds: int


@router.get("/status")
async def get_status() -> StatsStatus:
    return StatsStatus(
        running=stats_collector.is_running(),
        interval_seconds=stats_collector.get_interval(),
    )


@router.post("/start")
async def start_collector() -> StatsStatus:
    gs = get_global_settings(settings.homelab_repo_path)
    gs.stats.enabled = True
    save_global_settings(settings.homelab_repo_path, gs)
    stats_collector.start(settings.homelab_repo_path)
    return StatsStatus(running=stats_collector.is_running(), interval_seconds=stats_collector.get_interval())


@router.post("/stop")
async def stop_collector() -> StatsStatus:
    gs = get_global_settings(settings.homelab_repo_path)
    gs.stats.enabled = False
    save_global_settings(settings.homelab_repo_path, gs)
    stats_collector.stop()
    return StatsStatus(running=False, interval_seconds=stats_collector.get_interval())


class ConfigureRequest(BaseModel):
    interval_seconds: int


@router.post("/configure")
async def configure_collector(body: ConfigureRequest) -> StatsStatus:
    interval = max(10, body.interval_seconds)
    gs = get_global_settings(settings.homelab_repo_path)
    gs.stats.interval_seconds = interval
    save_global_settings(settings.homelab_repo_path, gs)
    stats_collector.reconfigure(settings.homelab_repo_path, interval)
    return StatsStatus(running=stats_collector.is_running(), interval_seconds=stats_collector.get_interval())


@router.post("/refresh")
async def trigger_refresh() -> dict:
    asyncio.create_task(stats_collector.collect_once(settings.homelab_repo_path))
    return {"ok": True}
