from fastapi import APIRouter, Depends

from app.config import settings
from app.models.secret import SecretSet
from app.services.secret_store import SecretStore

router = APIRouter()


def get_store() -> SecretStore:
    return SecretStore(settings.homelab_repo_path)


@router.get("/")
async def list_secrets(store: SecretStore = Depends(get_store)) -> list[str]:
    return store.list_keys()


@router.put("/")
async def set_secret(
    body: SecretSet,
    store: SecretStore = Depends(get_store),
) -> dict:
    store.set(body.key, body.value)
    return {"key": body.key, "status": "saved"}


@router.delete("/{key:path}", status_code=204)
async def delete_secret(
    key: str,
    store: SecretStore = Depends(get_store),
) -> None:
    store.delete(key)
