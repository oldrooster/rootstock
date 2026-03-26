from pydantic import BaseModel


class NetworkConfig(BaseModel):
    type: str = "dhcp"  # "dhcp" or "static"
    subnet_mask: str = "/24"  # CIDR suffix for static IPs
    gateway: str = ""
    dns: str = ""

    # Migration: drop old 'ip' field if present
    @classmethod
    def model_validate(cls, obj, **kwargs):
        if isinstance(obj, dict) and "ip" in obj:
            obj.pop("ip")
        return super().model_validate(obj, **kwargs)


class TemplateDefinition(BaseModel):
    name: str
    cloud_image: str
    cpu: int = 2
    memory: int = 4096
    disk: int = 32
    user: str = "deploy"
    ssh_key_secret: str = ""
    network: NetworkConfig = NetworkConfig()
    timezone: str = "Pacific/Auckland"
    locale: str = "en_NZ.UTF-8"


class TemplateCreate(BaseModel):
    name: str
    cloud_image: str
    cpu: int = 2
    memory: int = 4096
    disk: int = 32
    user: str = "deploy"
    ssh_key_secret: str = ""
    network: NetworkConfig = NetworkConfig()
    timezone: str = "Pacific/Auckland"
    locale: str = "en_NZ.UTF-8"


class TemplateUpdate(BaseModel):
    cloud_image: str | None = None
    cpu: int | None = None
    memory: int | None = None
    disk: int | None = None
    user: str | None = None
    ssh_key_secret: str | None = None
    network: NetworkConfig | None = None
    timezone: str | None = None
    locale: str | None = None
