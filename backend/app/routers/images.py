import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.config import settings
from app.models.image import ImageCreate, ImageDefinition, ImageType, ImageUpdate
from app.services.git_service import GitService
from app.services.node_store import NodeStore
from app.services.image_store import ImageStore
from app.services.secret_store import SecretStore

router = APIRouter()

CLOUD_IMAGE_EXTENSIONS = (".img", ".qcow2", ".raw")


def get_store() -> ImageStore:
    return ImageStore(settings.homelab_repo_path)


def get_node_store() -> NodeStore:
    return NodeStore(settings.homelab_repo_path)


def get_git() -> GitService:
    return GitService(settings.homelab_repo_path)


def get_secret_store() -> SecretStore:
    return SecretStore(settings.homelab_repo_path)


def _proxmox_headers(hv, secret_store: SecretStore) -> dict | None:
    """Build auth headers for a node. Returns None if credentials are missing."""
    if not hv.token_name:
        return None
    secret_key = f"proxmox/{hv.name}/token_secret"
    try:
        token_secret = secret_store.get(secret_key)
    except HTTPException:
        return None
    api_token = f"{hv.username}!{hv.token_name}={token_secret}"
    return {"Authorization": f"PVEAPIToken={api_token}"}


async def _list_remote_content(hv, headers: dict) -> dict[str, ImageType]:
    """List image filenames on a Proxmox host, returning name->type mapping."""
    url = f"{hv.endpoint.rstrip('/')}/api2/json/nodes/{hv.node_name}/storage/local/content"
    result: dict[str, ImageType] = {}
    try:
        async with httpx.AsyncClient(verify=False, timeout=15.0) as client:
            for content_type in ("iso", "vztmpl"):
                r = await client.get(url, headers=headers, params={"content": content_type})
                r.raise_for_status()
                items = r.json().get("data", [])
                for item in items:
                    volid = item.get("volid", "")
                    fname = volid.split("/")[-1] if "/" in volid else volid.split(":")[-1]
                    if not fname:
                        continue
                    if any(fname.endswith(ext) for ext in CLOUD_IMAGE_EXTENSIONS):
                        result[fname] = ImageType.cloud_image
                    elif content_type == "iso":
                        result[fname] = ImageType.iso
    except Exception:
        pass
    return result


@router.get("/")
async def list_images(store: ImageStore = Depends(get_store)) -> list[ImageDefinition]:
    return store.list_all()


@router.post("/", status_code=201)
async def create_image(
    body: ImageCreate,
    store: ImageStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> ImageDefinition:
    existing = store.list_all()
    if any(img.name == body.name for img in existing):
        raise HTTPException(status_code=409, detail=f"Image '{body.name}' already exists")
    image = ImageDefinition(**body.model_dump())
    store.write(image)
    git.commit_all(f"[image] add: {body.name}")
    return image


@router.patch("/{name}")
async def update_image(
    name: str,
    body: ImageUpdate,
    store: ImageStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> ImageDefinition:
    existing = store.get(name)
    updated_data = existing.model_dump()
    patch_data = body.model_dump(exclude_none=True)
    updated_data.update(patch_data)
    updated = ImageDefinition(**updated_data)
    store.write(updated)
    git.commit_all(f"[image] update: {name}")
    return updated


@router.delete("/{name}", status_code=204)
async def delete_image(
    name: str,
    store: ImageStore = Depends(get_store),
    git: GitService = Depends(get_git),
) -> None:
    store.delete(name)
    git.commit_all(f"[image] remove: {name}")


@router.post("/sync")
async def sync_images(
    store: ImageStore = Depends(get_store),
    node_store: NodeStore = Depends(get_node_store),
    secret_store: SecretStore = Depends(get_secret_store),
    git: GitService = Depends(get_git),
) -> dict:
    """Discover images from all enabled nodes and merge into the list."""
    nodes = [n for n in node_store.list_all() if n.enabled]
    current_images = {img.name: img for img in store.list_all()}
    added = []
    errors = []

    for hv in nodes:
        headers = _proxmox_headers(hv, secret_store)
        if not headers:
            errors.append(f"{hv.name}: missing credentials")
            continue
        remote = await _list_remote_content(hv, headers)
        for img_name, img_type in remote.items():
            if img_name not in current_images:
                new_img = ImageDefinition(
                    name=img_name, type=img_type, download_url="", nodes=["ALL"],
                )
                store.write(new_img)
                current_images[img_name] = new_img
                added.append(img_name)

    if added:
        git.commit_all(f"[image] sync: discovered {len(added)} new image(s)")

    return {"added": added, "errors": errors, "total": len(current_images)}


@router.post("/reconcile")
async def reconcile_images(
    store: ImageStore = Depends(get_store),
    node_store: NodeStore = Depends(get_node_store),
    secret_store: SecretStore = Depends(get_secret_store),
) -> dict:
    """Push/remove images on each node to match the desired state."""
    nodes_map = {n.name: n for n in node_store.list_all() if n.enabled}
    images = store.list_all()
    node_names = list(nodes_map.keys())
    results = {"downloaded": [], "removed": [], "errors": []}

    # Build desired state: which images should be on which node
    desired: dict[str, set[str]] = {name: set() for name in node_names}
    for img in images:
        targets = node_names if "ALL" in img.nodes else [h for h in img.nodes if h in nodes_map]
        for t in targets:
            desired[t].add(img.name)

    for hv_name, hv in nodes_map.items():
        headers = _proxmox_headers(hv, secret_store)
        if not headers:
            results["errors"].append(f"{hv_name}: missing credentials")
            continue

        remote = set((await _list_remote_content(hv, headers)).keys())
        should_have = desired.get(hv_name, set())

        # Download missing images
        to_download = should_have - remote
        for img_name in to_download:
            img_def = next((i for i in images if i.name == img_name), None)
            if not img_def or not img_def.download_url:
                results["errors"].append(f"{hv_name}/{img_name}: no download URL")
                continue
            # Proxmox requires a valid extension on the filename
            filename = img_name
            if img_def.type == ImageType.iso and not img_name.endswith(".iso"):
                filename = img_name + ".iso"
            elif img_def.type == ImageType.cloud_image and not any(
                img_name.endswith(ext) for ext in CLOUD_IMAGE_EXTENSIONS
            ):
                filename = img_name + ".img"
            url = f"{hv.endpoint.rstrip('/')}/api2/json/nodes/{hv.node_name}/storage/local/download-url"
            try:
                async with httpx.AsyncClient(verify=False, timeout=30.0) as client:
                    r = await client.post(url, headers=headers, data={
                        "url": img_def.download_url,
                        "content": "iso",
                        "filename": filename,
                    })
                    r.raise_for_status()
                    results["downloaded"].append(f"{hv_name}/{img_name}")
            except Exception as e:
                results["errors"].append(f"{hv_name}/{img_name}: download failed — {e}")

        # Remove images that shouldn't be there
        to_remove = remote - should_have
        for img_name in to_remove:
            volid = f"local:iso/{img_name}"
            url = f"{hv.endpoint.rstrip('/')}/api2/json/nodes/{hv.node_name}/storage/local/content/{volid}"
            try:
                async with httpx.AsyncClient(verify=False, timeout=15.0) as client:
                    r = await client.delete(url, headers=headers)
                    r.raise_for_status()
                    results["removed"].append(f"{hv_name}/{img_name}")
            except Exception as e:
                results["errors"].append(f"{hv_name}/{img_name}: remove failed — {e}")

    return results
