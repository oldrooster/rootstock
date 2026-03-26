from fastapi import APIRouter, Depends, HTTPException

from app.config import settings
from app.models.template import TemplateCreate, TemplateDefinition, TemplateUpdate
from app.services.git_service import GitService
from app.services.template_store import TemplateStore

router = APIRouter()


def get_store() -> TemplateStore:
    return TemplateStore(settings.homelab_repo_path)


def get_git() -> GitService:
    return GitService(settings.homelab_repo_path)


@router.get("/")
async def list_templates(store: TemplateStore = Depends(get_store)) -> list[TemplateDefinition]:
    return store.list_all()


@router.post("/", status_code=201)
async def create_template(
    body: TemplateCreate,
    store: TemplateStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> TemplateDefinition:
    try:
        store.get(body.name)
        raise HTTPException(status_code=409, detail=f"Template '{body.name}' already exists")
    except HTTPException as e:
        if e.status_code != 404:
            raise

    template = TemplateDefinition(**body.model_dump())
    store.write(template)
    git.commit_all(f"[template] add: {body.name}")
    return template


@router.get("/{name}")
async def get_template(
    name: str,
    store: TemplateStore = Depends(get_store),
) -> TemplateDefinition:
    return store.get(name)


@router.patch("/{name}")
async def update_template(
    name: str,
    body: TemplateUpdate,
    store: TemplateStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> TemplateDefinition:
    existing = store.get(name)
    updated_data = existing.model_dump()
    patch_data = body.model_dump(exclude_none=True)
    updated_data.update(patch_data)
    updated = TemplateDefinition(**updated_data)
    store.write(updated)
    git.commit_all(f"[template] update: {name}")
    return updated


@router.delete("/{name}", status_code=204)
async def delete_template(
    name: str,
    store: TemplateStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> None:
    store.delete(name)
    git.commit_all(f"[template] remove: {name}")
