from pydantic import BaseModel


class NodeDefinition(BaseModel):
    name: str
    type: str = "proxmox"
    endpoint: str = ""
    node_name: str = ""
    username: str = "root@pam"
    token_name: str = ""
    ssh_user: str = "root"
    roles: list[str] = []
    enabled: bool = True


class NodeCreate(BaseModel):
    name: str
    type: str = "proxmox"
    endpoint: str = ""
    node_name: str = ""
    username: str = "root@pam"
    token_name: str = ""
    ssh_user: str = "root"
    roles: list[str] = []
    enabled: bool = True


class NodeUpdate(BaseModel):
    type: str | None = None
    endpoint: str | None = None
    node_name: str | None = None
    username: str | None = None
    token_name: str | None = None
    ssh_user: str | None = None
    roles: list[str] | None = None
    enabled: bool | None = None
