from pydantic import BaseModel, field_validator, model_validator


class VMDefinition(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name must not be blank")
        return v.strip()

    enabled: bool = True
    node: str
    ip: str = ""  # static IP for Ansible connectivity
    template: str = ""
    cpu: int = 2
    cpu_type: str = "host"
    memory: int = 4096
    disk: int = 32
    image: str = ""
    user: str = "deploy"
    ssh_key: str = ""
    gpu_passthrough: bool = False
    roles: list[str] = []
    managed: bool = True  # False = imported without SSH; power-only via Proxmox API
    provisioned: bool = False  # True once a successful terraform apply has created the VM

    @model_validator(mode="before")
    @classmethod
    def migrate_role_to_roles(cls, data):
        """Backward compat: convert old singular 'role' field to 'roles' list."""
        if isinstance(data, dict) and "role" in data and "roles" not in data:
            role = data.pop("role")
            if role:
                data["roles"] = [role]
        return data


class VMCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name must not be blank")
        return v.strip()

    enabled: bool = True
    node: str
    ip: str = ""
    template: str = ""
    cpu: int = 2
    cpu_type: str = "host"
    memory: int = 4096
    disk: int = 32
    image: str = ""
    user: str = "deploy"
    ssh_key: str = ""
    gpu_passthrough: bool = False
    roles: list[str] = []
    managed: bool = True
    provisioned: bool = False


class VMUpdate(BaseModel):
    enabled: bool | None = None
    node: str | None = None
    ip: str | None = None
    template: str | None = None
    cpu: int | None = None
    cpu_type: str | None = None
    memory: int | None = None
    disk: int | None = None
    image: str | None = None
    user: str | None = None
    ssh_key: str | None = None
    gpu_passthrough: bool | None = None
    roles: list[str] | None = None
    managed: bool | None = None
    provisioned: bool | None = None
