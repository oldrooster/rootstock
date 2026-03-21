import json
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

from app.config import settings


class SecretStore:
    def __init__(self, repo_path: str):
        self.secrets_path = Path(repo_path) / "secrets.enc"

    def _get_fernet(self) -> Fernet:
        key = settings.rootstock_secret_key
        if not key:
            raise HTTPException(
                status_code=503,
                detail="ROOTSTOCK_SECRET_KEY not configured",
            )
        return Fernet(key.encode())

    def _load(self) -> dict[str, str]:
        if not self.secrets_path.exists():
            return {}
        f = self._get_fernet()
        try:
            encrypted = self.secrets_path.read_bytes()
            decrypted = f.decrypt(encrypted)
            return json.loads(decrypted)
        except InvalidToken:
            raise HTTPException(
                status_code=500,
                detail="Failed to decrypt secrets — wrong ROOTSTOCK_SECRET_KEY?",
            )

    def _save(self, data: dict[str, str]) -> None:
        f = self._get_fernet()
        plaintext = json.dumps(data, sort_keys=True).encode()
        encrypted = f.encrypt(plaintext)
        self.secrets_path.parent.mkdir(parents=True, exist_ok=True)
        self.secrets_path.write_bytes(encrypted)

    def list_keys(self) -> list[str]:
        return sorted(self._load().keys())

    def get(self, key: str) -> str:
        data = self._load()
        if key not in data:
            raise HTTPException(status_code=404, detail=f"Secret '{key}' not found")
        return data[key]

    def set(self, key: str, value: str) -> None:
        data = self._load()
        data[key] = value
        self._save(data)

    def delete(self, key: str) -> None:
        data = self._load()
        if key not in data:
            raise HTTPException(status_code=404, detail=f"Secret '{key}' not found")
        del data[key]
        self._save(data)
