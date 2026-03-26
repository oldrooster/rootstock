from pathlib import Path

from fastapi import HTTPException

from app.models.node import NodeDefinition
from app.services import yaml_service


class NodeStore:
    def __init__(self, repo_path: str):
        self.nodes_dir = Path(repo_path) / "nodes"

    def _path(self, name: str) -> Path:
        return self.nodes_dir / f"{name}.yml"

    def list_all(self) -> list[NodeDefinition]:
        if not self.nodes_dir.exists():
            return []
        results = []
        for path in sorted(self.nodes_dir.glob("*.yml")):
            data = yaml_service.read_yaml(path)
            if data:
                results.append(NodeDefinition(**data))
        return results

    def get(self, name: str) -> NodeDefinition:
        path = self._path(name)
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"Node '{name}' not found")
        data = yaml_service.read_yaml(path)
        return NodeDefinition(**data)

    def write(self, node: NodeDefinition) -> None:
        path = self._path(node.name)
        yaml_service.write_yaml(path, node.model_dump(exclude_none=True))

    def delete(self, name: str) -> None:
        path = self._path(name)
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"Node '{name}' not found")
        path.unlink()
