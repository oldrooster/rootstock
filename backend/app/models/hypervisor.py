from pydantic import BaseModel


class HypervisorDefinition(BaseModel):
    name: str
    endpoint: str
    node_name: str
    username: str = "root@pam"
    token_name: str = ""
    enabled: bool = True


class HypervisorCreate(BaseModel):
    name: str
    endpoint: str
    node_name: str
    username: str = "root@pam"
    token_name: str = ""
    enabled: bool = True


class HypervisorUpdate(BaseModel):
    endpoint: str | None = None
    node_name: str | None = None
    username: str | None = None
    token_name: str | None = None
    enabled: bool | None = None
