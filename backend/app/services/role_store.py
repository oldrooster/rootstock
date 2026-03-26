from pathlib import Path

from fastapi import HTTPException

from app.models.role import RoleDefinition
from app.services import yaml_service


# Files scaffolded when creating a new role
_SCAFFOLD_FILES = {
    "tasks/main.yml": "---\n# Tasks for this role\n",
}


class RoleStore:
    def __init__(self, repo_path: str):
        self.roles_dir = Path(repo_path) / "roles"

    def _role_dir(self, name: str) -> Path:
        return self.roles_dir / name

    def _meta_path(self, name: str) -> Path:
        return self._role_dir(name) / "role.yml"

    def _safe_path(self, name: str, rel_path: str) -> Path:
        """Resolve a relative path within a role dir, preventing traversal."""
        role_dir = self._role_dir(name).resolve()
        full = (role_dir / rel_path).resolve()
        if not str(full).startswith(str(role_dir)):
            raise HTTPException(status_code=400, detail="Invalid file path")
        return full

    # ── Role CRUD ────────────────────────────────────────────────────────

    def list_all(self) -> list[RoleDefinition]:
        if not self.roles_dir.exists():
            return []
        results = []
        for d in sorted(self.roles_dir.iterdir()):
            meta = d / "role.yml"
            if d.is_dir() and meta.exists():
                data = yaml_service.read_yaml(meta)
                if data:
                    results.append(RoleDefinition(**data))
        return results

    def get(self, name: str) -> RoleDefinition:
        meta = self._meta_path(name)
        if not meta.exists():
            raise HTTPException(status_code=404, detail=f"Role '{name}' not found")
        data = yaml_service.read_yaml(meta)
        return RoleDefinition(**data)

    def create(self, role: RoleDefinition) -> None:
        role_dir = self._role_dir(role.name)
        if role_dir.exists():
            raise HTTPException(status_code=409, detail=f"Role '{role.name}' already exists")
        role_dir.mkdir(parents=True)
        yaml_service.write_yaml(self._meta_path(role.name), role.model_dump())
        # Scaffold default files
        for rel_path, content in _SCAFFOLD_FILES.items():
            fpath = role_dir / rel_path
            fpath.parent.mkdir(parents=True, exist_ok=True)
            fpath.write_text(content)

    def update(self, name: str, role: RoleDefinition) -> None:
        if not self._meta_path(name).exists():
            raise HTTPException(status_code=404, detail=f"Role '{name}' not found")
        yaml_service.write_yaml(self._meta_path(name), role.model_dump())

    def delete(self, name: str) -> None:
        role_dir = self._role_dir(name)
        if not role_dir.exists():
            raise HTTPException(status_code=404, detail=f"Role '{name}' not found")
        import shutil
        shutil.rmtree(role_dir)

    # ── File operations ──────────────────────────────────────────────────

    def list_files(self, name: str) -> list[str]:
        role_dir = self._role_dir(name)
        if not role_dir.exists():
            raise HTTPException(status_code=404, detail=f"Role '{name}' not found")
        files = []
        for p in sorted(role_dir.rglob("*")):
            if p.is_file() and p.name != "role.yml":
                files.append(str(p.relative_to(role_dir)))
        return files

    def read_file(self, name: str, rel_path: str) -> str:
        fpath = self._safe_path(name, rel_path)
        if not fpath.exists():
            raise HTTPException(status_code=404, detail=f"File '{rel_path}' not found")
        return fpath.read_text()

    def write_file(self, name: str, rel_path: str, content: str) -> None:
        fpath = self._safe_path(name, rel_path)
        fpath.parent.mkdir(parents=True, exist_ok=True)
        fpath.write_text(content)

    def delete_file(self, name: str, rel_path: str) -> None:
        fpath = self._safe_path(name, rel_path)
        if not fpath.exists():
            raise HTTPException(status_code=404, detail=f"File '{rel_path}' not found")
        fpath.unlink()
