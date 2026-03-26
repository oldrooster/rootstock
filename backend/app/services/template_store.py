from pathlib import Path

from fastapi import HTTPException

from app.models.template import TemplateDefinition
from app.services import yaml_service


class TemplateStore:
    def __init__(self, repo_path: str):
        self.templates_dir = Path(repo_path) / "templates"

    def _path(self, name: str) -> Path:
        return self.templates_dir / f"{name}.yml"

    def list_all(self) -> list[TemplateDefinition]:
        if not self.templates_dir.exists():
            return []
        results = []
        for path in sorted(self.templates_dir.glob("*.yml")):
            data = yaml_service.read_yaml(path)
            if data and data.get("name", "").strip():
                results.append(TemplateDefinition(**data))
        return results

    def get(self, name: str) -> TemplateDefinition:
        path = self._path(name)
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"Template '{name}' not found")
        data = yaml_service.read_yaml(path)
        return TemplateDefinition(**data)

    def write(self, template: TemplateDefinition) -> None:
        path = self._path(template.name)
        yaml_service.write_yaml(path, template.model_dump(mode="json"))

    def delete(self, name: str) -> None:
        path = self._path(name)
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"Template '{name}' not found")
        path.unlink()
