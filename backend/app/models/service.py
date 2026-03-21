from pydantic import BaseModel


class PortMapping(BaseModel):
    host: int
    container: int


class VolumeMount(BaseModel):
    host_path: str
    container_path: str
    backup: bool = False


class IngressConfig(BaseModel):
    hostname: str
    backend_port: int


class DNSConfig(BaseModel):
    hostname: str
    ip: str


class ServiceDefinition(BaseModel):
    name: str
    enabled: bool = True
    host: str
    image: str
    network: str | None = None
    ports: list[PortMapping] = []
    volumes: list[VolumeMount] = []
    ingress: IngressConfig | None = None
    dns: DNSConfig | None = None
    secrets: list[str] = []
    env: dict[str, str] = {}


class ServiceCreate(BaseModel):
    name: str
    enabled: bool = True
    host: str
    image: str
    network: str | None = None
    ports: list[PortMapping] = []
    volumes: list[VolumeMount] = []
    ingress: IngressConfig | None = None
    dns: DNSConfig | None = None
    secrets: list[str] = []
    env: dict[str, str] = {}


class ServiceUpdate(BaseModel):
    enabled: bool | None = None
    host: str | None = None
    image: str | None = None
    network: str | None = None
    ports: list[PortMapping] | None = None
    volumes: list[VolumeMount] | None = None
    ingress: IngressConfig | None = None
    dns: DNSConfig | None = None
    secrets: list[str] | None = None
    env: dict[str, str] | None = None
