from pathlib import Path

from fastapi import HTTPException

from app.models.hypervisor import HypervisorDefinition
from app.services import yaml_service


class HypervisorStore:
    def __init__(self, repo_path: str):
        self.hypervisors_dir = Path(repo_path) / "hypervisors"

    def _path(self, name: str) -> Path:
        return self.hypervisors_dir / f"{name}.yml"

    def list_all(self) -> list[HypervisorDefinition]:
        if not self.hypervisors_dir.exists():
            return []
        results = []
        for path in sorted(self.hypervisors_dir.glob("*.yml")):
            data = yaml_service.read_yaml(path)
            if data:
                results.append(HypervisorDefinition(**data))
        return results

    def get(self, name: str) -> HypervisorDefinition:
        path = self._path(name)
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"Hypervisor '{name}' not found")
        data = yaml_service.read_yaml(path)
        return HypervisorDefinition(**data)

    def write(self, hv: HypervisorDefinition) -> None:
        path = self._path(hv.name)
        yaml_service.write_yaml(path, hv.model_dump(exclude_none=True))

    def delete(self, name: str) -> None:
        path = self._path(name)
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"Hypervisor '{name}' not found")
        path.unlink()
