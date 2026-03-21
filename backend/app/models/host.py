from pydantic import BaseModel


class HostInfo(BaseModel):
    name: str
    type: str  # "proxmox" | "container_host" | "management"
    status: str = "unknown"
