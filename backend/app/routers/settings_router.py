import base64
import logging
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.config import settings
from app.services.apply_state import _get_state as get_apply_state, _save_state as save_apply_state
from app.services.backup_service import get_manual_paths, save_manual_paths, ManualBackupPath
from app.services.container_store import ContainerStore
from app.services.dns_service import (
    DNSSettings,
    StaticRecord,
    get_settings as get_dns_settings,
    get_static_records,
    save_static_records,
)
from app.services.git_service import GitService
from app.services.global_settings import (
    GlobalSettings,
    get_global_settings,
    save_global_settings,
)
from app.services.image_store import ImageStore
from app.services.ingress_service import (
    IngressSettings,
    get_settings as get_ingress_settings,
    get_manual_rules,
    save_manual_rules,
)
from app.services.node_store import NodeStore
from app.services.role_store import RoleStore
from app.services.template_store import TemplateStore
from app.services.vm_store import VMStore

logger = logging.getLogger(__name__)


def _get_fernet() -> Fernet | None:
    """Return a Fernet instance if ROOTSTOCK_SECRET_KEY is configured, else None."""
    key = settings.rootstock_secret_key
    if not key:
        return None
    return Fernet(key.encode())

router = APIRouter()


class AppInfo(BaseModel):
    app_name: str
    homelab_repo_path: str
    homelab_remote_url: str
    log_level: str


class AllSettings(BaseModel):
    app: AppInfo
    global_settings: GlobalSettings
    dns: DNSSettings
    ingress: IngressSettings


@router.get("/")
async def get_all_settings() -> AllSettings:
    return AllSettings(
        app=AppInfo(
            app_name=settings.app_name,
            homelab_repo_path=settings.homelab_repo_path,
            homelab_remote_url=settings.homelab_remote_url,
            log_level=settings.log_level,
        ),
        global_settings=get_global_settings(settings.homelab_repo_path),
        dns=get_dns_settings(settings.homelab_repo_path),
        ingress=get_ingress_settings(settings.homelab_repo_path),
    )


@router.put("/global")
async def update_global_settings(body: GlobalSettings) -> GlobalSettings:
    # Preserve role_order if not provided (frontend Settings page doesn't manage it)
    if not body.role_order:
        existing = get_global_settings(settings.homelab_repo_path)
        body.role_order = existing.role_order
    save_global_settings(settings.homelab_repo_path, body)
    return body


@router.get("/export")
async def export_settings():
    """Export all Rootstock definitions as a single JSON file."""
    repo = settings.homelab_repo_path
    role_store = RoleStore(repo)
    roles_export = []
    for role in role_store.list_all():
        role_data = role.model_dump()
        # Include all role files (tasks, templates, etc.)
        files = {}
        for rel_path in role_store.list_files(role.name):
            files[rel_path] = role_store.read_file(role.name, rel_path)
        role_data["files"] = files
        roles_export.append(role_data)

    # Export secrets as the raw encrypted blob (requires same ROOTSTOCK_SECRET_KEY to use)
    secrets_enc_path = Path(repo) / "secrets.enc"
    secrets_blob = None
    if secrets_enc_path.exists():
        secrets_blob = base64.b64encode(secrets_enc_path.read_bytes()).decode()

    # Export tfstate encrypted with ROOTSTOCK_SECRET_KEY
    tfstate_enc = None
    tfstate_path = Path(repo) / "terraform" / "terraform.tfstate"
    if tfstate_path.exists():
        fernet = _get_fernet()
        if fernet:
            tfstate_enc = base64.b64encode(
                fernet.encrypt(tfstate_path.read_bytes())
            ).decode()
        else:
            logger.warning("Skipping tfstate export: ROOTSTOCK_SECRET_KEY not configured")

    # DNS static records
    dns_static_records = [r.model_dump() for r in get_static_records(repo)]

    # Backup manual paths
    backup_manual_paths = [p.model_dump() for p in get_manual_paths(repo)]

    # Apply state
    apply_state = get_apply_state(repo)

    data = {
        "global_settings": get_global_settings(repo).model_dump(),
        "dns": get_dns_settings(repo).model_dump(),
        "dns_static_records": dns_static_records,
        "ingress_settings": get_ingress_settings(repo).model_dump(),
        "ingress_manual_rules": [r.model_dump() for r in get_manual_rules(repo)],
        "nodes": [n.model_dump() for n in NodeStore(repo).list_all()],
        "templates": [t.model_dump() for t in TemplateStore(repo).list_all()],
        "images": [i.model_dump() for i in ImageStore(repo).list_all()],
        "vms": [v.model_dump() for v in VMStore(repo).list_all()],
        "containers": [c.model_dump() for c in ContainerStore(repo).list_all()],
        "roles": roles_export,
        "secrets_enc": secrets_blob,
        "tfstate_enc": tfstate_enc,
        "backup_manual_paths": backup_manual_paths,
        "apply_state": apply_state,
    }
    return JSONResponse(
        content=data,
        headers={"Content-Disposition": "attachment; filename=rootstock-export.json"},
    )


@router.post("/import")
async def import_settings(request: Request):
    """Import Rootstock definitions from a JSON export."""
    data = await request.json()

    repo = settings.homelab_repo_path

    if "global_settings" in data:
        save_global_settings(repo, GlobalSettings(**data["global_settings"]))

    if "ingress_settings" in data:
        from app.services.ingress_service import save_settings as save_ingress_settings
        save_ingress_settings(repo, IngressSettings(**data["ingress_settings"]))

    if "ingress_manual_rules" in data:
        from app.services.ingress_service import ManualRule
        rules = [ManualRule(**r) for r in data["ingress_manual_rules"]]
        save_manual_rules(repo, rules)

    if "dns" in data:
        from app.services.dns_service import save_settings as save_dns_settings
        save_dns_settings(repo, DNSSettings(**data["dns"]))

    if "nodes" in data:
        from app.models.node import NodeDefinition
        store = NodeStore(repo)
        for n in data["nodes"]:
            store.write(NodeDefinition(**n))

    if "templates" in data:
        from app.models.template import TemplateDefinition
        store = TemplateStore(repo)
        for t in data["templates"]:
            store.write(TemplateDefinition(**t))

    if "images" in data:
        from app.models.image import ImageDefinition
        store = ImageStore(repo)
        for i in data["images"]:
            store.write(ImageDefinition(**i))

    if "vms" in data:
        from app.models.vm import VMDefinition
        store = VMStore(repo)
        for v in data["vms"]:
            store.write(VMDefinition(**v))

    if "containers" in data:
        from app.models.container import ContainerDefinition
        store = ContainerStore(repo)
        for c in data["containers"]:
            store.write(ContainerDefinition(**c))

    if "roles" in data:
        from app.models.role import RoleDefinition
        store = RoleStore(repo)
        for r in data["roles"]:
            files = r.pop("files", {})
            role_def = RoleDefinition(**r)
            # Create role if it doesn't exist, otherwise update
            try:
                store.create(role_def)
            except Exception:
                store.update(role_def.name, role_def)
            # Write role files
            for rel_path, content in files.items():
                store.write_file(role_def.name, rel_path, content)

    if "secrets_enc" in data and data["secrets_enc"]:
        secrets_enc_path = Path(repo) / "secrets.enc"
        secrets_enc_path.write_bytes(base64.b64decode(data["secrets_enc"]))

    if "tfstate_enc" in data and data["tfstate_enc"]:
        fernet = _get_fernet()
        if fernet:
            try:
                tfstate_bytes = fernet.decrypt(base64.b64decode(data["tfstate_enc"]))
                tf_dir = Path(repo) / "terraform"
                tf_dir.mkdir(parents=True, exist_ok=True)
                (tf_dir / "terraform.tfstate").write_bytes(tfstate_bytes)
            except InvalidToken:
                logger.warning("Skipping tfstate import: decryption failed (wrong ROOTSTOCK_SECRET_KEY?)")
        else:
            logger.warning("Skipping tfstate import: ROOTSTOCK_SECRET_KEY not configured")

    if "dns_static_records" in data:
        records = [StaticRecord(**r) for r in data["dns_static_records"]]
        save_static_records(repo, records)

    if "backup_manual_paths" in data:
        paths = [ManualBackupPath(**p) for p in data["backup_manual_paths"]]
        save_manual_paths(repo, paths)

    if "apply_state" in data and data["apply_state"]:
        save_apply_state(repo, data["apply_state"])

    git = GitService(repo)
    git.commit_all("[rootstock] import settings")
    return {"status": "ok"}
