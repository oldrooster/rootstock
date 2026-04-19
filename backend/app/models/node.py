from pydantic import BaseModel, field_validator

from app.models.common import _validate_name


class NodeDefinition(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_must_be_valid(cls, v: str) -> str:
        return _validate_name(v)
    type: str = "proxmox"
    endpoint: str = ""
    node_name: str = ""
    username: str = "root@pam"
    token_name: str = ""
    ssh_user: str = "root"
    roles: list[str] = []
    enabled: bool = True
    snippets_storage: str = "local"  # storage with snippets content type enabled


class NodeCreate(BaseModel):
    name: str
    type: str = "proxmox"

    @field_validator("name")
    @classmethod
    def name_must_be_valid(cls, v: str) -> str:
        return _validate_name(v)

    endpoint: str = ""
    node_name: str = ""
    username: str = "root@pam"
    token_name: str = ""
    ssh_user: str = "root"
    roles: list[str] = []
    enabled: bool = True
    snippets_storage: str = "local"


class NodeUpdate(BaseModel):
    type: str | None = None
    endpoint: str | None = None
    node_name: str | None = None
    username: str | None = None
    token_name: str | None = None
    ssh_user: str | None = None
    roles: list[str] | None = None
    enabled: bool | None = None
    snippets_storage: str | None = None
