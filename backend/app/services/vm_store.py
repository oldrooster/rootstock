from pathlib import Path

from fastapi import HTTPException

from app.models.vm import VMDefinition
from app.services import yaml_service


class VMStore:
    def __init__(self, repo_path: str):
        self.vms_dir = Path(repo_path) / "vms"

    def _path(self, name: str) -> Path:
        return self.vms_dir / f"{name}.yml"

    def list_all(self) -> list[VMDefinition]:
        """Scan vms/*.yml and parse each into VMDefinition."""
        if not self.vms_dir.exists():
            return []
        results = []
        for path in sorted(self.vms_dir.glob("*.yml")):
            data = yaml_service.read_yaml(path)
            if data:
                results.append(VMDefinition(**data))
        return results

    def get(self, name: str) -> VMDefinition:
        path = self._path(name)
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"VM '{name}' not found")
        data = yaml_service.read_yaml(path)
        return VMDefinition(**data)

    def write(self, vm: VMDefinition) -> None:
        """Write a VMDefinition to its YAML file."""
        path = self._path(vm.name)
        yaml_service.write_yaml(path, vm.model_dump(exclude_none=True))

    def delete(self, name: str) -> None:
        path = self._path(name)
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"VM '{name}' not found")
        path.unlink()
