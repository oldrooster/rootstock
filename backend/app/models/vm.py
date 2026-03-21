from pydantic import BaseModel


class VMDefinition(BaseModel):
    name: str
    enabled: bool = True
    node: str
    cpu: int
    memory: int
    disk: int
    image: str
    user: str = "deploy"
    ssh_key: str = ""
    role: str = "container_host"


class VMCreate(BaseModel):
    name: str
    enabled: bool = True
    node: str
    cpu: int
    memory: int
    disk: int
    image: str
    user: str = "deploy"
    ssh_key: str = ""
    role: str = "container_host"


class VMUpdate(BaseModel):
    enabled: bool | None = None
    node: str | None = None
    cpu: int | None = None
    memory: int | None = None
    disk: int | None = None
    image: str | None = None
    user: str | None = None
    ssh_key: str | None = None
    role: str | None = None
