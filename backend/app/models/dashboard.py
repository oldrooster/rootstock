from pydantic import BaseModel


class CommitInfo(BaseModel):
    hash: str
    message: str
    date: str


class DashboardData(BaseModel):
    total_services: int
    enabled_services: int
    total_vms: int
    enabled_vms: int
    total_nodes: int = 0
    hosts: list[str]
    recent_commits: list[CommitInfo]
