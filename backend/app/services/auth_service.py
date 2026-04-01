import base64
import hashlib
import hmac
import json
import os
import time
from pathlib import Path

from app.config import settings

TOKEN_EXPIRY_SECONDS = 86400 * 7  # 7 days


def _auth_path() -> Path:
    return Path(settings.homelab_repo_path) / "auth.json"


def _load_auth() -> dict:
    p = _auth_path()
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception:
            pass
    return {}


def _save_auth(data: dict) -> None:
    p = _auth_path()
    p.write_text(json.dumps(data, indent=2))
    p.chmod(0o600)


def has_credentials() -> bool:
    data = _load_auth()
    return bool(data.get("username") and data.get("hashed_password"))


def _get_jwt_secret() -> str:
    data = _load_auth()
    secret = data.get("jwt_secret")
    if secret:
        return secret
    # Generate and persist a new JWT secret
    secret = os.urandom(32).hex()
    data["jwt_secret"] = secret
    _save_auth(data)
    return secret


# --- Password hashing via scrypt ---

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    return salt.hex() + ":" + dk.hex()


def verify_password(password: str, hashed: str) -> bool:
    try:
        salt_hex, dk_hex = hashed.split(":", 1)
        salt = bytes.fromhex(salt_hex)
        dk = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
        return hmac.compare_digest(dk.hex(), dk_hex)
    except Exception:
        return False


# --- Credential management ---

def save_credentials(username: str, password: str) -> None:
    data = _load_auth()
    data["username"] = username
    data["hashed_password"] = hash_password(password)
    if "jwt_secret" not in data:
        data["jwt_secret"] = os.urandom(32).hex()
    _save_auth(data)


def check_credentials(username: str, password: str) -> bool:
    data = _load_auth()
    if data.get("username") != username:
        return False
    return verify_password(password, data.get("hashed_password", ""))


# --- JWT (HS256, no external deps) ---

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    pad = 4 - len(s) % 4
    if pad != 4:
        s += "=" * pad
    return base64.urlsafe_b64decode(s)


def create_token(username: str) -> str:
    secret = _get_jwt_secret()
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64url_encode(json.dumps({
        "sub": username,
        "exp": int(time.time()) + TOKEN_EXPIRY_SECONDS,
        "iat": int(time.time()),
    }).encode())
    signing_input = f"{header}.{payload}"
    sig = _b64url_encode(
        hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    )
    return f"{signing_input}.{sig}"


def verify_token(token: str) -> str:
    """Verify token and return the username, or raise ValueError on failure."""
    secret = _get_jwt_secret()
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid token format")
    header, payload, sig = parts
    signing_input = f"{header}.{payload}"
    expected_sig = _b64url_encode(
        hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    )
    if not hmac.compare_digest(sig, expected_sig):
        raise ValueError("Invalid token signature")
    data = json.loads(_b64url_decode(payload))
    if data.get("exp", 0) < time.time():
        raise ValueError("Token expired")
    return data["sub"]
