from pathlib import Path

from fastapi import HTTPException

from app.models.service import ServiceDefinition
from app.services import yaml_service


class ServiceStore:
    def __init__(self, repo_path: str):
        self.services_dir = Path(repo_path) / "services"

    def _path(self, name: str) -> Path:
        return self.services_dir / f"{name}.yml"

    def list_all(self) -> list[ServiceDefinition]:
        """Scan services/*.yml and parse each into ServiceDefinition."""
        if not self.services_dir.exists():
            return []
        results = []
        for path in sorted(self.services_dir.glob("*.yml")):
            data = yaml_service.read_yaml(path)
            if data:
                results.append(ServiceDefinition(**data))
        return results

    def get(self, name: str) -> ServiceDefinition:
        path = self._path(name)
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"Service '{name}' not found")
        data = yaml_service.read_yaml(path)
        return ServiceDefinition(**data)

    def write(self, svc: ServiceDefinition) -> None:
        """Write a ServiceDefinition to its YAML file."""
        path = self._path(svc.name)
        yaml_service.write_yaml(path, svc.model_dump(exclude_none=True))

    def delete(self, name: str) -> None:
        path = self._path(name)
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"Service '{name}' not found")
        path.unlink()
