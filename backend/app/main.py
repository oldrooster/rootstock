from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import apply, backups, dashboard, dns, git, health, hosts, hypervisors, ingress, secrets, services, settings_router, vms


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.services.git_service import GitService

    GitService(settings.homelab_repo_path).ensure_initialized()
    yield


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(services.router, prefix="/services", tags=["services"])
app.include_router(vms.router, prefix="/vms", tags=["vms"])
app.include_router(hypervisors.router, prefix="/hypervisors", tags=["hypervisors"])
app.include_router(git.router, prefix="/git", tags=["git"])
app.include_router(apply.router, prefix="/apply", tags=["apply"])
app.include_router(hosts.router, prefix="/hosts", tags=["hosts"])
app.include_router(backups.router, prefix="/backups", tags=["backups"])
app.include_router(dns.router, prefix="/dns", tags=["dns"])
app.include_router(ingress.router, prefix="/ingress", tags=["ingress"])
app.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
app.include_router(settings_router.router, prefix="/settings", tags=["settings"])
app.include_router(secrets.router, prefix="/secrets", tags=["secrets"])
