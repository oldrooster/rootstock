"""Execute Terraform commands with streaming output."""

import asyncio
import logging
from collections.abc import AsyncGenerator
from pathlib import Path

from app.models.node import NodeDefinition
from app.models.image import ImageDefinition
from app.models.template import TemplateDefinition
from app.models.vm import VMDefinition
from app.services.secret_store import SecretStore
from app.services.terraform_service import generate_main_tf

logger = logging.getLogger(__name__)


def _resolve_secret(store: SecretStore, key: str) -> str:
    """Try to resolve a secret value, return empty string on failure."""
    if not key:
        return ""
    try:
        return store.get(key)
    except Exception:
        logger.warning("Could not resolve secret: %s", key)
        return ""


def prepare_workspace(
    terraform_dir: Path,
    vms: list[VMDefinition],
    nodes: list[NodeDefinition],
    templates: list[TemplateDefinition],
    images: list[ImageDefinition],
    secret_store: SecretStore,
) -> None:
    """Write main.tf and terraform.tfvars to the workspace directory."""
    terraform_dir.mkdir(parents=True, exist_ok=True)

    # Generate and write main.tf
    main_tf = generate_main_tf(vms, nodes, templates)
    (terraform_dir / "main.tf").write_text(main_tf)

    # Build tfvars with resolved secrets
    tfvars_lines: list[str] = []
    template_map = {t.name: t for t in templates}
    image_map = {img.name: img for img in images}
    enabled_hvs = [hv for hv in nodes if hv.enabled]

    # Proxmox API tokens and SSH keys
    for hv in enabled_hvs:
        alias = hv.name.replace("-", "_")
        if hv.token_name:
            secret_key = f"proxmox/{hv.name}/token_secret"
            token_secret = _resolve_secret(secret_store, secret_key)
            if token_secret:
                # bpg/proxmox api_token format: username!token_name=secret
                api_token = f"{hv.username}!{hv.token_name}={token_secret}"
                tfvars_lines.append(
                    f'proxmox_api_token_{alias} = "{api_token}"'
                )

        # SSH private key for provider file operations
        ssh_key = _resolve_secret(secret_store, f"proxmox/{hv.name}/ssh_private_key")
        if ssh_key:
            tfvars_lines.append(
                f'proxmox_ssh_private_key_{alias} = <<-EOT\n{ssh_key}\nEOT'
            )

    # Per-VM variables
    image_vars_emitted: set[tuple[str, str]] = set()
    for vm in vms:
        if not vm.enabled:
            continue

        resource_name = vm.name.replace("-", "_")
        tpl = template_map.get(vm.template) if vm.template else None

        # Resolve SSH public key
        ssh_key_ref = vm.ssh_key or (tpl.ssh_key_secret if tpl else "")
        if ssh_key_ref:
            # If it looks like a secret path (contains /), resolve it
            if "/" in ssh_key_ref:
                pub_key = _resolve_secret(secret_store, ssh_key_ref)
            else:
                # It's a literal key value
                pub_key = ssh_key_ref
            if pub_key:
                # Escape any quotes in the key
                pub_key_escaped = pub_key.replace("\\", "\\\\").replace('"', '\\"')
                tfvars_lines.append(
                    f'ssh_public_key_{resource_name} = "{pub_key_escaped}"'
                )

        # Collect image URL (deduplicated below)
        cloud_image_name = vm.image or (tpl.cloud_image if tpl else "")
        if cloud_image_name and cloud_image_name in image_map:
            key = (vm.node, cloud_image_name)
            if key not in image_vars_emitted:
                img = image_map[cloud_image_name]
                if img.download_url:
                    safe_img = cloud_image_name.replace("-", "_").replace(".", "_")
                    safe_node = vm.node.replace("-", "_")
                    var_name = f"image_url_image_{safe_img}_on_{safe_node}"
                    tfvars_lines.append(
                        f'{var_name} = "{img.download_url}"'
                    )
                image_vars_emitted.add(key)

    tfvars_content = "\n".join(tfvars_lines) + "\n" if tfvars_lines else ""
    (terraform_dir / "terraform.tfvars").write_text(tfvars_content)


async def run_terraform(
    command: list[str],
    working_dir: Path,
) -> AsyncGenerator[str, None]:
    """Run a terraform command and yield output lines as they arrive."""
    cmd = ["terraform", *command]
    logger.info("Running: %s in %s", " ".join(cmd), working_dir)

    yield f"$ terraform {' '.join(command)}\n"

    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        cwd=str(working_dir),
        env=_terraform_env(),
    )

    assert process.stdout is not None
    while True:
        line = await process.stdout.readline()
        if not line:
            break
        yield line.decode("utf-8", errors="replace")

    exit_code = await process.wait()
    if exit_code == 0:
        yield f"\n✓ terraform {command[0]} completed successfully (exit code 0)\n"
    else:
        yield f"\n✗ terraform {command[0]} failed (exit code {exit_code})\n"


async def run_terraform_capture(
    command: list[str],
    working_dir: Path,
) -> tuple[int, str]:
    """Run a terraform command and return (exit_code, combined_output)."""
    cmd = ["terraform", *command]
    logger.info("Running (capture): %s in %s", " ".join(cmd), working_dir)

    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        cwd=str(working_dir),
        env=_terraform_env(),
    )
    assert process.stdout is not None
    stdout, _ = await process.communicate()
    exit_code = process.returncode or 0
    return exit_code, stdout.decode("utf-8", errors="replace")


def snapshot_state(terraform_dir: Path) -> bool:
    """Copy terraform.tfstate to terraform.tfstate.rollback before applying.

    Returns True if a snapshot was created, False if there was nothing to snapshot.
    """
    state_file = terraform_dir / "terraform.tfstate"
    if not state_file.exists():
        return False
    import shutil
    shutil.copy2(state_file, terraform_dir / "terraform.tfstate.rollback")
    return True


def rollback_state(terraform_dir: Path) -> bool:
    """Restore terraform.tfstate from terraform.tfstate.rollback.

    Returns True if the rollback was applied, False if no snapshot exists.
    """
    rollback_file = terraform_dir / "terraform.tfstate.rollback"
    if not rollback_file.exists():
        return False
    import shutil
    shutil.copy2(rollback_file, terraform_dir / "terraform.tfstate")
    return True


def rollback_snapshot_exists(terraform_dir: Path) -> bool:
    """Return True if a rollback snapshot exists."""
    return (terraform_dir / "terraform.tfstate.rollback").exists()


def _terraform_env() -> dict[str, str]:
    """Build environment for terraform subprocess."""
    import os

    env = os.environ.copy()
    # Disable interactive prompts
    env["TF_INPUT"] = "0"
    # Use compact output
    env["TF_IN_AUTOMATION"] = "1"
    return env
