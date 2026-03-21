from pydantic import BaseModel


class MoveRequest(BaseModel):
    target_host: str


class MoveStep(BaseModel):
    name: str
    status: str  # pending, running, done, skipped
    detail: str = ""


class MoveResult(BaseModel):
    service: str
    from_host: str
    to_host: str
    steps: list[MoveStep]
