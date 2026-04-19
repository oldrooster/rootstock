"""Execute Ansible commands with streaming output.

This module is a thin coordinator. Per-scope playbook generation has been
extracted to dedicated modules:
  - roles_executor.py
  - containers_executor.py
  - dns_executor.py
  - ingress_executor.py
  - backups_executor.py
"""

import asyncio
import logging
import os
from collections.abc import AsyncGenerator
from pathlib import Path

from app.models.container import ContainerDefinition
from app.models.node import NodeDefinition
from app.models.vm import VMDefinition
from app.services.inventory_service import generate_inventory
from app.services.secret_store import SecretStore
from app.models.template import TemplateDefinition

logger = logging.getLogger(__name__)


def _resolve_private_key(
    ref: str,
    secret_store: SecretStore,
    tpl_ssh_secret: str = "",
) -> str | None:
    """Resolve an SSH private key from a secret reference.

    If ref points to a public key path, try swapping public->private.
    Falls back to tpl_ssh_secret if ref is empty.
    """
    refs_to_try = [r for r in [ref, tpl_ssh_secret] if r and "/" in r]

    for candidate in refs_to_try:
        private_path = candidate.replace("public", "private")
        if private_path != candidate:
            try:
                return secret_store.get(private_path)
            except KeyError:
                pass
            except Exception as e:
                logger.debug("Could not resolve private key '%s': %s", private_path, e)
        try:
            return secret_store.get(candidate)
        except KeyError:
            pass
        except Exception as e:
            logger.debug("Could not resolve key '%s': %s", candidate, e)

    return None


def _write_ssh_keys(
    workspace_dir: Path,
    vms: list[VMDefinition],
    nodes: list[NodeDefinition],
    secret_store: SecretStore,
    templates: list[TemplateDefinition] | None = None,
) -> dict[str, str]:
    """Resolve SSH keys and write them to workspace. Returns host_name -> key file path."""
    keys_dir = workspace_dir / "ssh_keys"
    keys_dir.mkdir(parents=True, exist_ok=True)
    ssh_key_files: dict[str, str] = {}
    template_map = {t.name: t for t in (templates or [])}

    for vm in vms:
        if not vm.enabled:
            continue
        tpl = template_map.get(vm.template) if vm.template else None
        ref = vm.ssh_key or (tpl.ssh_key_secret if tpl else "")
        if not ref:
            continue
        pem = _resolve_private_key(ref, secret_store)
        if pem:
            key_path = keys_dir / f"{vm.name}.key"
            key_path.write_text(pem.strip() + "\n")
            key_path.chmod(0o600)
            ssh_key_files[vm.name] = str(key_path)

    for node in nodes:
        if not node.enabled:
            continue
        ref = f"proxmox/{node.name}/ssh_private_key"
        pem = _resolve_private_key(ref, secret_store)
        if pem:
            key_path = keys_dir / f"{node.name}.key"
            key_path.write_text(pem.strip() + "\n")
            key_path.chmod(0o600)
            ssh_key_files[node.name] = str(key_path)

    return ssh_key_files


def prepare_ansible_workspace(
    workspace_dir: Path,
    scope: str,
    repo_path: str,
    vms: list[VMDefinition],
    nodes: list[NodeDefinition],
    containers: list[ContainerDefinition] | None = None,
    secret_store: SecretStore | None = None,
    templates: list[TemplateDefinition] | None = None,
    filter_roles: set[str] | None = None,
    filter_hosts: set[str] | None = None,
    free_strategy: bool = False,
) -> None:
    """Prepare Ansible workspace files for the given scope."""
    workspace_dir.mkdir(parents=True, exist_ok=True)

    ssh_key_files: dict[str, str] = {}
    if secret_store:
        ssh_key_files = _write_ssh_keys(workspace_dir, vms, nodes, secret_store, templates)

    inventory = generate_inventory(vms, nodes, ssh_key_files)
    (workspace_dir / "inventory.yml").write_text(inventory)

    roles_src = Path(repo_path) / "roles"
    roles_dst = workspace_dir / "roles"
    if roles_src.exists() and not roles_dst.exists():
        roles_dst.symlink_to(roles_src)

    if scope == "roles":
        from app.services.roles_executor import write_roles_playbook
        from app.services.global_settings import get_global_settings
        gs = get_global_settings(repo_path)
        write_roles_playbook(workspace_dir, vms, nodes, filter_roles, gs.role_order)

    elif scope == "containers":
        from app.services.containers_executor import write_containers_playbook
        write_containers_playbook(
            workspace_dir, repo_path, containers or [], nodes, vms,
            secret_store, filter_hosts=filter_hosts, free_strategy=free_strategy,
        )

    elif scope == "dns":
        from app.services.dns_executor import write_dns_playbook
        write_dns_playbook(workspace_dir, repo_path, containers or [], nodes, vms)

    elif scope == "ingress":
        from app.services.ingress_executor import write_ingress_playbook
        write_ingress_playbook(
            workspace_dir, repo_path, containers or [], nodes, vms,
            secret_store, filter_hosts,
        )

    elif scope == "backups":
        from app.services.backups_executor import write_backups_playbook
        write_backups_playbook(
            workspace_dir, repo_path, containers or [], nodes, vms,
            secret_store, filter_hosts,
        )


async def run_ansible(
    playbook: str,
    inventory: str,
    working_dir: Path,
    diff: bool = True,
    verbosity: int = 0,
) -> AsyncGenerator[str, None]:
    """Run ansible-playbook and yield output lines as they arrive."""
    cmd = ["ansible-playbook", playbook, "-i", inventory]
    if diff:
        cmd.append("--diff")
    if verbosity > 0:
        cmd.append(f"-{'v' * min(verbosity, 4)}")
    logger.info("Running: %s in %s", " ".join(cmd), working_dir)

    yield f"$ {' '.join(cmd)}\n"

    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        cwd=str(working_dir),
        env=_ansible_env(),
    )

    assert process.stdout is not None
    while True:
        line = await process.stdout.readline()
        if not line:
            break
        yield line.decode("utf-8", errors="replace")

    exit_code = await process.wait()
    if exit_code == 0:
        yield f"\n✓ ansible-playbook completed successfully (exit code 0)\n"
    else:
        yield f"\n✗ ansible-playbook failed (exit code {exit_code})\n"


def _ansible_env() -> dict[str, str]:
    """Build environment for ansible subprocess."""
    env = os.environ.copy()
    env["ANSIBLE_HOST_KEY_CHECKING"] = "False"
    env["ANSIBLE_FORCE_COLOR"] = "1"
    return env
