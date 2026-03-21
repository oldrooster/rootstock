from fastapi import APIRouter, Depends, HTTPException

from app.config import settings
from app.models.git import GitPushRequest, GitPushResponse, GitStatusResponse
from app.services.git_service import GitService

router = APIRouter()


def get_git_service() -> GitService:
    return GitService(settings.homelab_repo_path)


@router.get("/status")
async def git_status(svc: GitService = Depends(get_git_service)) -> GitStatusResponse:
    return svc.status()


@router.post("/push")
async def git_push(
    body: GitPushRequest,
    svc: GitService = Depends(get_git_service),
) -> GitPushResponse:
    committed = False
    if body.message:
        svc.commit_all(body.message)
        committed = True
    try:
        svc.push()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Push failed: {e}")
    return GitPushResponse(committed=committed, pushed=True, message="ok")
