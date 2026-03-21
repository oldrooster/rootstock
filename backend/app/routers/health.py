from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class HealthResponse(BaseModel):
    status: str
    version: str


@router.get("/health", tags=["health"])
async def health_check() -> HealthResponse:
    return HealthResponse(status="ok", version="0.1.0")
