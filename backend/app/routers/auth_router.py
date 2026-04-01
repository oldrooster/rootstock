import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import auth_service

logger = logging.getLogger(__name__)
router = APIRouter()


class SetupRequest(BaseModel):
    username: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


@router.get("/status")
def auth_status():
    """Check if credentials have been configured (first-run detection)."""
    return {"setup_required": not auth_service.has_credentials()}


@router.post("/setup")
def auth_setup(body: SetupRequest):
    """First-run: create the initial username and password.

    Returns a token on success. Fails with 409 if credentials already exist.
    """
    if auth_service.has_credentials():
        raise HTTPException(status_code=409, detail="Credentials already configured")
    if not body.username.strip():
        raise HTTPException(status_code=400, detail="Username cannot be empty")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    username = body.username.strip()
    auth_service.save_credentials(username, body.password)
    token = auth_service.create_token(username)
    logger.info("Initial credentials created for user '%s'", username)
    return {"token": token, "username": username}


@router.post("/login")
def auth_login(body: LoginRequest):
    """Exchange credentials for a JWT token."""
    if not auth_service.has_credentials():
        raise HTTPException(
            status_code=400,
            detail="No credentials configured. Complete first-run setup first.",
        )
    if not auth_service.check_credentials(body.username, body.password):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = auth_service.create_token(body.username)
    return {"token": token, "username": body.username}
