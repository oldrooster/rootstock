from pathlib import Path

from fastapi import HTTPException

from app.models.container import ContainerDefinition
from app.services import yaml_service


class ContainerStore:
    def __init__(self, repo_path: str):
        self.containers_dir = Path(repo_path) / "containers"
        # Fallback: read from old services/ dir if containers/ doesn't exist yet
        self._legacy_dir = Path(repo_path) / "services"

    def _active_dir(self) -> Path:
        """Return containers/ if it exists, otherwise services/ for migration."""
        if self.containers_dir.exists():
            return self.containers_dir
        if self._legacy_dir.exists():
            return self._legacy_dir
        return self.containers_dir

    def _path(self, name: str) -> Path:
        # Check containers/ first, then services/
        p = self.containers_dir / f"{name}.yml"
        if p.exists():
            return p
        legacy = self._legacy_dir / f"{name}.yml"
        if legacy.exists():
            return legacy
        return p  # default to containers/ for new files

    def _write_path(self, name: str) -> Path:
        """New/updated files always go into containers/."""
        self.containers_dir.mkdir(parents=True, exist_ok=True)
        return self.containers_dir / f"{name}.yml"

    def list_all(self) -> list[ContainerDefinition]:
        results = []
        seen = set()
        for d in [self.containers_dir, self._legacy_dir]:
            if not d.exists():
                continue
            for path in sorted(d.glob("*.yml")):
                if path.stem in seen:
                    continue
                seen.add(path.stem)
                data = yaml_service.read_yaml(path)
                if data:
                    results.append(ContainerDefinition(**data))
        return results

    def get(self, name: str) -> ContainerDefinition:
        path = self._path(name)
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"Container '{name}' not found")
        data = yaml_service.read_yaml(path)
        return ContainerDefinition(**data)

    def write(self, container: ContainerDefinition) -> None:
        path = self._write_path(container.name)
        yaml_service.write_yaml(path, container.model_dump(exclude_none=True))
        # If migrating, remove old file from services/
        legacy = self._legacy_dir / f"{container.name}.yml"
        if legacy.exists() and legacy != path:
            legacy.unlink()

    def delete(self, name: str) -> None:
        path = self._path(name)
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"Container '{name}' not found")
        path.unlink()
