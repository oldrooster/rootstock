from pydantic import BaseModel


class GitStatusResponse(BaseModel):
    branch: str
    is_dirty: bool
    staged_files: list[str]
    unstaged_files: list[str]
    untracked_files: list[str]
    ahead: int = 0
    behind: int = 0


class GitPushRequest(BaseModel):
    message: str | None = None


class GitPushResponse(BaseModel):
    committed: bool
    pushed: bool
    message: str
