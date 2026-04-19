import re
from typing import Annotated

from pydantic import BaseModel, field_validator


class MessageResponse(BaseModel):
    message: str


# Shared name type: alphanumeric, hyphens, underscores only.
# Applied at the API layer before values reach shell commands or YAML keys.
_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


def _validate_name(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("Name must not be blank")
    if not _NAME_RE.match(v):
        raise ValueError(
            "Name may only contain letters, digits, hyphens and underscores"
        )
    return v
