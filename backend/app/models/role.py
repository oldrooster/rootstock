from pydantic import BaseModel


class RoleDefinition(BaseModel):
    name: str
    description: str = ""


class RoleCreate(BaseModel):
    name: str
    description: str = ""


class RoleUpdate(BaseModel):
    description: str | None = None
