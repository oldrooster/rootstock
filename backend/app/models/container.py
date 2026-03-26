from pydantic import BaseModel, model_validator


class PortMapping(BaseModel):
    host: int
    container: int


class VolumeMount(BaseModel):
    host_path: str
    container_path: str
    backup: bool = False


class ComposeExtra(BaseModel):
    """A sidecar/companion container within the same compose service."""
    image: str
    volumes: list[str] = []
    environment: dict[str, str] = {}
    ports: list[str] = []
    command: str = ""


class ContainerDefinition(BaseModel):
    name: str
    enabled: bool = True
    image: str
    hosts: list[str] = []
    host_rule: str = ""  # e.g. "role:docker"
    dns_name: str = ""
    ingress_mode: str = "none"  # "caddy" | "direct" | "none"
    ingress_port: int = 0
    external: bool = False
    ports: list[PortMapping] = []
    volumes: list[VolumeMount] = []
    env: dict[str, str] = {}
    secrets: list[str] = []
    compose_extras: dict[str, ComposeExtra] = {}
    network: str | None = None
    backup_exclusions: list[str] = []

    @model_validator(mode="before")
    @classmethod
    def migrate_from_service(cls, data):
        """Backward compat: migrate old ServiceDefinition fields."""
        if not isinstance(data, dict):
            return data
        # host -> hosts
        if "host" in data and "hosts" not in data:
            host = data.pop("host")
            if host:
                data["hosts"] = [host]
        # ingress object -> ingress_mode + ingress_port
        if "ingress" in data and "ingress_mode" not in data:
            ingress = data.pop("ingress")
            if ingress and isinstance(ingress, dict):
                data["ingress_mode"] = "caddy"
                data["ingress_port"] = ingress.get("backend_port", 0)
                if not data.get("dns_name") and ingress.get("hostname"):
                    data["dns_name"] = ingress["hostname"]
        # dns object -> dns_name (IP is now derived)
        if "dns" in data and "dns_name" not in data:
            dns = data.pop("dns")
            if dns and isinstance(dns, dict) and dns.get("hostname"):
                data["dns_name"] = dns["hostname"]
        elif "dns" in data and "dns_name" in data:
            data.pop("dns")
        return data


class ContainerCreate(BaseModel):
    name: str
    enabled: bool = True
    image: str
    hosts: list[str] = []
    host_rule: str = ""
    dns_name: str = ""
    ingress_mode: str = "none"
    ingress_port: int = 0
    external: bool = False
    ports: list[PortMapping] = []
    volumes: list[VolumeMount] = []
    env: dict[str, str] = {}
    secrets: list[str] = []
    compose_extras: dict[str, ComposeExtra] = {}
    network: str | None = None
    backup_exclusions: list[str] = []


class ContainerUpdate(BaseModel):
    enabled: bool | None = None
    image: str | None = None
    hosts: list[str] | None = None
    host_rule: str | None = None
    dns_name: str | None = None
    ingress_mode: str | None = None
    ingress_port: int | None = None
    external: bool | None = None
    ports: list[PortMapping] | None = None
    volumes: list[VolumeMount] | None = None
    env: dict[str, str] | None = None
    secrets: list[str] | None = None
    compose_extras: dict[str, ComposeExtra] | None = None
    network: str | None = None
    backup_exclusions: list[str] | None = None
