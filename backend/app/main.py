from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.routers import apply, backups, containers, dashboard, dns, git, health, hosts, images, ingress, nodes, roles, secrets, services, settings_router, stats, templates, terminal, vms
from app.routers import auth_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.services.git_service import GitService
    from app.services import stats_collector

    from app.services.global_settings import get_global_settings
    GitService(settings.homelab_repo_path).ensure_initialized()
    gs = get_global_settings(settings.homelab_repo_path)
    if gs.stats.enabled:
        stats_collector.start(settings.homelab_repo_path, gs.stats.interval_seconds)
    yield
    stats_collector.stop()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
)

# Auth middleware must be registered BEFORE CORSMiddleware so that Starlette
# wraps it in the correct order: CORS runs outermost (first), auth runs inside.
# If auth is outermost, its 401 responses lack CORS headers and the browser
# reports a CORS error instead of a 401.
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path

    # Always allow CORS preflight, health check, and auth endpoints
    if request.method == "OPTIONS" or path == "/health" or path.startswith("/auth/"):
        return await call_next(request)

    # Extract token from Authorization header or ?token= query param (for WebSockets)
    auth_header = request.headers.get("Authorization", "")
    token = (
        auth_header[7:]
        if auth_header.startswith("Bearer ")
        else request.query_params.get("token", "")
    )

    if not token:
        return JSONResponse({"detail": "Not authenticated"}, status_code=401)

    from app.services import auth_service
    try:
        auth_service.verify_token(token)
    except ValueError:
        return JSONResponse({"detail": "Invalid or expired token"}, status_code=401)

    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(auth_router.router, prefix="/auth", tags=["auth"])
app.include_router(health.router)
app.include_router(containers.router, prefix="/containers", tags=["containers"])
app.include_router(services.router, prefix="/services", tags=["services"])  # legacy alias
app.include_router(vms.router, prefix="/vms", tags=["vms"])
app.include_router(nodes.router, prefix="/nodes", tags=["nodes"])
app.include_router(git.router, prefix="/git", tags=["git"])
app.include_router(apply.router, prefix="/apply", tags=["apply"])
app.include_router(hosts.router, prefix="/hosts", tags=["hosts"])
app.include_router(backups.router, prefix="/backups", tags=["backups"])
app.include_router(dns.router, prefix="/dns", tags=["dns"])
app.include_router(ingress.router, prefix="/ingress", tags=["ingress"])
app.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
app.include_router(settings_router.router, prefix="/settings", tags=["settings"])
app.include_router(secrets.router, prefix="/secrets", tags=["secrets"])
app.include_router(images.router, prefix="/images", tags=["images"])
app.include_router(templates.router, prefix="/templates", tags=["templates"])
app.include_router(roles.router, prefix="/roles", tags=["roles"])
app.include_router(terminal.router, prefix="/terminal", tags=["terminal"])
app.include_router(stats.router, prefix="/stats", tags=["stats"])
