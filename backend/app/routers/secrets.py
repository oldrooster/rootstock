from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.config import settings
from app.models.secret import SecretSet
from app.services.secret_store import SecretStore

router = APIRouter()


def get_store() -> SecretStore:
    return SecretStore(settings.homelab_repo_path)


class GenerateSSHKeyRequest(BaseModel):
    key_name: str


class GenerateSSHKeyResponse(BaseModel):
    private_key_secret: str
    public_key: str


@router.get("/")
async def list_secrets(store: SecretStore = Depends(get_store)) -> list[str]:
    return store.list_keys()


@router.get("/{key:path}")
async def get_secret(key: str, store: SecretStore = Depends(get_store)) -> dict:
    return {"key": key, "value": store.get(key)}


@router.put("/")
async def set_secret(
    body: SecretSet,
    store: SecretStore = Depends(get_store),
) -> dict:
    store.set(body.key, body.value)
    return {"key": body.key, "status": "saved"}


@router.post("/generate-ssh-key")
async def generate_ssh_key(
    body: GenerateSSHKeyRequest,
    store: SecretStore = Depends(get_store),
) -> GenerateSSHKeyResponse:
    private_key = Ed25519PrivateKey.generate()
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.OpenSSH,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    public_key = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.OpenSSH,
        format=serialization.PublicFormat.OpenSSH,
    ).decode()

    secret_key = f"ssh/{body.key_name}/private_key"
    store.set(secret_key, private_pem)

    public_secret_key = f"ssh/{body.key_name}/public_key"
    store.set(public_secret_key, public_key)

    return GenerateSSHKeyResponse(
        private_key_secret=secret_key,
        public_key=public_key,
    )


@router.delete("/{key:path}", status_code=204)
async def delete_secret(
    key: str,
    store: SecretStore = Depends(get_store),
) -> None:
    store.delete(key)
