from contextlib import asynccontextmanager
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

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

    # Allow static file requests (non-API paths — served directly)
    if not path.startswith("/api"):
        return await call_next(request)

    # Always allow CORS preflight, health check, and auth endpoints
    if request.method == "OPTIONS" or path == "/api/health" or path.startswith("/api/auth/"):
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


app.include_router(auth_router.router, prefix="/api/auth", tags=["auth"])
app.include_router(health.router, prefix="/api")
app.include_router(containers.router, prefix="/api/containers", tags=["containers"])
app.include_router(services.router, prefix="/api/services", tags=["services"])  # legacy alias
app.include_router(vms.router, prefix="/api/vms", tags=["vms"])
app.include_router(nodes.router, prefix="/api/nodes", tags=["nodes"])
app.include_router(git.router, prefix="/api/git", tags=["git"])
app.include_router(apply.router, prefix="/api/apply", tags=["apply"])
app.include_router(hosts.router, prefix="/api/hosts", tags=["hosts"])
app.include_router(backups.router, prefix="/api/backups", tags=["backups"])
app.include_router(dns.router, prefix="/api/dns", tags=["dns"])
app.include_router(ingress.router, prefix="/api/ingress", tags=["ingress"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(settings_router.router, prefix="/api/settings", tags=["settings"])
app.include_router(secrets.router, prefix="/api/secrets", tags=["secrets"])
app.include_router(images.router, prefix="/api/images", tags=["images"])
app.include_router(templates.router, prefix="/api/templates", tags=["templates"])
app.include_router(roles.router, prefix="/api/roles", tags=["roles"])
app.include_router(terminal.router, prefix="/api/terminal", tags=["terminal"])
app.include_router(stats.router, prefix="/api/stats", tags=["stats"])

# Serve pre-built React frontend (single-container mode).
# Falls back gracefully when static/ doesn't exist (dev with separate Vite server).
_static_dir = Path(__file__).parent.parent / "static"
if _static_dir.exists():
    app.mount("/assets", StaticFiles(directory=str(_static_dir / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        # Serve any root-level static file that exists (favicon, logo, etc.)
        candidate = _static_dir / full_path
        if candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(_static_dir / "index.html"))
