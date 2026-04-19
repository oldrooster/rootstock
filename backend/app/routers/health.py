from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from app.config import settings

router = APIRouter()


class HealthResponse(BaseModel):
    status: str
    version: str
    repo_accessible: bool
    secrets_readable: bool
    checks: dict[str, str]


@router.get("/health", tags=["health"])
async def health_check() -> HealthResponse:
    checks: dict[str, str] = {}

    # Check homelab repo is accessible
    repo_path = Path(settings.homelab_repo_path)
    repo_accessible = repo_path.is_dir()
    checks["repo"] = "ok" if repo_accessible else f"directory not found: {repo_path}"

    # Check secrets store can decrypt
    secrets_readable = False
    try:
        from app.services.secret_store import SecretStore
        store = SecretStore(settings.homelab_repo_path)
        # list() exercises the decrypt path without requiring any specific secret
        store.list()
        secrets_readable = True
        checks["secrets"] = "ok"
    except Exception as e:
        checks["secrets"] = f"error: {e}"

    overall = "ok" if (repo_accessible and secrets_readable) else "degraded"
    return HealthResponse(
        status=overall,
        version="0.1.0",
        repo_accessible=repo_accessible,
        secrets_readable=secrets_readable,
        checks=checks,
    )
