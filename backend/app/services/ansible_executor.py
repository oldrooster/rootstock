"""Execute Ansible commands with streaming output."""

import asyncio
import logging
import os
from collections.abc import AsyncGenerator
from pathlib import Path

from app.models.container import ContainerDefinition
from app.models.node import NodeDefinition
from app.models.vm import VMDefinition
from app.services.caddy_service import generate_caddyfile
from app.services.cloudflare_service import generate_tunnel_config
from app.services.compose_service import generate_compose, generate_env_file
from app.services.dns_service import (
    build_host_ip_map,
    generate_pihole_custom_dns,
    generate_pihole_toml_hosts,
    get_all_records,
)
from app.services.ingress_service import get_manual_rules, get_settings as get_ingress_settings
from app.services.inventory_service import generate_inventory, safe_group_name
from app.services.secret_store import SecretStore
from app.models.template import TemplateDefinition

logger = logging.getLogger(__name__)


def _resolve_private_key(ref: str, secret_store: SecretStore) -> str | None:
    """Resolve an SSH private key from a secret reference.

    If ref points to a public key path, try swapping public->private.
    """
    if not ref or "/" not in ref:
        return None
    private_path = ref.replace("public", "private")
    if private_path != ref:
        try:
            return secret_store.get(private_path)
        except Exception:
            pass
    try:
        return secret_store.get(ref)
    except Exception:
        pass
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
        # Nodes use proxmox/{name}/ssh_private_key
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
    filter_containers: set[str] | None = None,
    filter_hosts: set[str] | None = None,
) -> None:
    """Prepare Ansible workspace files for the given scope."""
    workspace_dir.mkdir(parents=True, exist_ok=True)

    # Resolve SSH keys and write to workspace
    ssh_key_files: dict[str, str] = {}
    if secret_store:
        ssh_key_files = _write_ssh_keys(workspace_dir, vms, nodes, secret_store, templates)

    # Always write inventory
    inventory = generate_inventory(vms, nodes, ssh_key_files)
    (workspace_dir / "inventory.yml").write_text(inventory)

    # Symlink roles directory
    roles_src = Path(repo_path) / "roles"
    roles_dst = workspace_dir / "roles"
    if roles_src.exists() and not roles_dst.exists():
        roles_dst.symlink_to(roles_src)

    # Generate playbook based on scope
    if scope == "roles":
        from app.services.global_settings import get_global_settings
        gs = get_global_settings(repo_path)
        _write_roles_playbook(workspace_dir, vms, nodes, filter_roles, gs.role_order)
    elif scope == "containers":
        ctr_list = containers or []
        if filter_containers:
            ctr_list = [c for c in ctr_list if c.name in filter_containers]
        _write_containers_playbook(workspace_dir, repo_path, ctr_list, nodes, vms, secret_store)
    elif scope == "dns":
        _write_dns_playbook(workspace_dir, repo_path, containers or [], nodes, vms)
    elif scope == "ingress":
        _write_ingress_playbook(workspace_dir, repo_path, containers or [], nodes, vms, secret_store, filter_hosts)
    elif scope == "backups":
        _write_backups_playbook(workspace_dir, repo_path, containers or [], nodes, vms, secret_store, filter_hosts)


def _collect_hosts_with_roles(
    vms: list[VMDefinition],
    nodes: list[NodeDefinition],
) -> dict[str, list[str]]:
    """Build role -> [host_names] mapping."""
    from collections import defaultdict
    role_hosts: dict[str, list[str]] = defaultdict(list)
    for node in nodes:
        if not node.enabled:
            continue
        for role in node.roles:
            role_hosts[role].append(node.name)
    for vm in vms:
        if not vm.enabled:
            continue
        for role in vm.roles:
            role_hosts[role].append(vm.name)
    return dict(role_hosts)


def _write_roles_playbook(
    workspace_dir: Path,
    vms: list[VMDefinition],
    nodes: list[NodeDefinition],
    filter_roles: set[str] | None = None,
    role_order: list[str] | None = None,
) -> None:
    """Generate playbook that applies roles to their assigned hosts."""
    role_hosts = _collect_hosts_with_roles(vms, nodes)
    plays = []

    # Order roles: explicit order first, then remaining alphabetically
    if role_order:
        ordered = [r for r in role_order if r in role_hosts]
        remaining = sorted(set(role_hosts) - set(ordered))
        ordered_roles = ordered + remaining
    else:
        ordered_roles = sorted(role_hosts)

    for role in ordered_roles:
        hosts = role_hosts[role]
        if filter_roles is not None and role not in filter_roles:
            continue
        group = safe_group_name(role)
        plays.append(
            f"- name: Apply role '{role}'\n"
            f"  hosts: {group}\n"
            f"  become: true\n"
            f"  roles:\n"
            f"    - {role}\n"
        )

    if not plays:
        content = "# No roles assigned to any hosts\n- name: No-op\n  hosts: localhost\n  tasks:\n    - debug:\n        msg: 'No roles to apply'\n"
    else:
        content = "\n".join(plays)

    (workspace_dir / "playbook.yml").write_text(content)


def _write_containers_playbook(
    workspace_dir: Path,
    repo_path: str,
    containers: list[ContainerDefinition],
    nodes: list[NodeDefinition],
    vms: list[VMDefinition],
    secret_store: SecretStore | None = None,
) -> None:
    """Generate playbook + compose + .env files for deploying containers per host."""
    files_dir = workspace_dir / "files" / "compose"
    files_dir.mkdir(parents=True, exist_ok=True)

    # Collect all hosts and networks used by containers
    # Docker predefined networks cannot be created via `docker network create`
    PREDEFINED_NETWORKS = {"host", "bridge", "none"}
    all_hosts: set[str] = set()
    all_networks: set[str] = set()
    for ctr in containers:
        if ctr.enabled:
            all_hosts.update(ctr.hosts)
            if ctr.network and ctr.network not in PREDEFINED_NETWORKS:
                all_networks.add(ctr.network)

    has_env_file = False
    for host in sorted(all_hosts):
        host_containers = [c for c in containers if c.enabled and host in c.hosts]
        compose_content = generate_compose(host, host_containers)
        host_dir = files_dir / host
        host_dir.mkdir(parents=True, exist_ok=True)
        (host_dir / "docker-compose.yml").write_text(compose_content)

        # Generate .env file with resolved secrets
        if secret_store:
            env_content = generate_env_file(host, host_containers, secret_store)
            if env_content:
                (host_dir / ".env").write_text(env_content)
                has_env_file = True
            else:
                # Write empty .env to ensure clean state
                (host_dir / ".env").write_text("")
                has_env_file = True

    # Collect build-from-repo containers per host
    build_containers_by_host: dict[str, list[ContainerDefinition]] = {}
    for ctr in containers:
        if ctr.enabled and ctr.build_repo:
            for host in ctr.hosts:
                build_containers_by_host.setdefault(host, []).append(ctr)

    # Write playbook
    tasks = [
        "    - name: Ensure /opt/docker exists\n"
        "      file:\n"
        "        path: /opt/docker\n"
        "        state: directory\n"
        "        mode: '0755'\n",
    ]

    # Ensure all referenced Docker networks exist
    for net in sorted(all_networks):
        tasks.append(
            f"    - name: Ensure Docker network '{net}' exists\n"
            f"      command: docker network create {net}\n"
            "      register: net_create\n"
            "      failed_when: net_create.rc != 0 and 'already exists' not in net_create.stderr\n"
            "      changed_when: net_create.rc == 0\n"
        )

    # Clone/pull repos and build images for build-from-repo containers
    all_build_ctrs = {c.name: c for c in containers if c.enabled and c.build_repo}
    for ctr in all_build_ctrs.values():
        build_dir = f"/opt/docker/build/{ctr.name}"
        # Determine which hosts have this container
        ctr_hosts = [h for h in ctr.hosts if h in all_hosts]
        when_clause = ""
        if set(ctr_hosts) != all_hosts:
            host_list_str = "', '".join(sorted(ctr_hosts))
            when_clause = f"      when: inventory_hostname in ['{host_list_str}']\n"

        tasks.append(
            f"    - name: Clone/update repo for '{ctr.name}'\n"
            f"      git:\n"
            f"        repo: \"{ctr.build_repo}\"\n"
            f"        dest: {build_dir}\n"
            f"        version: \"{ctr.build_branch}\"\n"
            f"        force: true\n"
            + when_clause
        )
        target_flag = f" --target {ctr.build_target}" if ctr.build_target else ""
        # Resolve Dockerfile path relative to repo root (chdir), not build context
        dockerfile_path = ctr.build_dockerfile
        if ctr.build_context != "." and "/" not in ctr.build_dockerfile:
            dockerfile_path = f"{ctr.build_context}/{ctr.build_dockerfile}".replace("//", "/")
        tasks.append(
            f"    - name: Build image for '{ctr.name}'\n"
            f"      command: docker build -t {ctr.image} -f {dockerfile_path}{target_flag} {ctr.build_context}\n"
            f"      args:\n"
            f"        chdir: {build_dir}\n"
            + when_clause
        )

    tasks += [
        "    - name: Copy docker-compose.yml\n"
        "      copy:\n"
        "        src: \"files/compose/{{ inventory_hostname }}/docker-compose.yml\"\n"
        "        dest: /opt/docker/docker-compose.yml\n"
        "        mode: '0644'\n",
    ]

    if has_env_file:
        tasks.append(
            "    - name: Copy .env file (secrets)\n"
            "      copy:\n"
            "        src: \"files/compose/{{ inventory_hostname }}/.env\"\n"
            "        dest: /opt/docker/.env\n"
            "        mode: '0600'\n"
        )

    # Pull latest images for registry-based (non-build) containers per host,
    # then bring everything up. This ensures existing containers get updated.
    pull_services_by_host: dict[str, list[str]] = {}
    for host in sorted(all_hosts):
        host_containers = [c for c in containers if c.enabled and host in c.hosts]
        pull_names = [c.name for c in host_containers if not c.build_repo]
        if pull_names:
            pull_services_by_host[host] = pull_names

    if pull_services_by_host:
        # If all hosts have the same pull list, use a single unconditional task
        all_pull_lists = list(pull_services_by_host.values())
        if len(set(tuple(s) for s in all_pull_lists)) == 1 and set(pull_services_by_host) == all_hosts:
            svc_list = " ".join(all_pull_lists[0])
            tasks.append(
                f"    - name: Pull latest images\n"
                f"      command: docker compose -f /opt/docker/docker-compose.yml pull {svc_list}\n"
                f"      args:\n"
                f"        chdir: /opt/docker\n"
                f"      register: pull_result\n"
                f"      changed_when: \"'Pull complete' in pull_result.stderr or 'Downloaded newer' in pull_result.stderr\"\n"
            )
        else:
            for host, svc_names in sorted(pull_services_by_host.items()):
                svc_list = " ".join(svc_names)
                tasks.append(
                    f"    - name: Pull latest images on {host}\n"
                    f"      command: docker compose -f /opt/docker/docker-compose.yml pull {svc_list}\n"
                    f"      args:\n"
                    f"        chdir: /opt/docker\n"
                    f"      when: inventory_hostname == '{host}'\n"
                    f"      register: pull_result\n"
                    f"      changed_when: \"'Pull complete' in pull_result.stderr or 'Downloaded newer' in pull_result.stderr\"\n"
                )

    # Remove pre-existing containers not managed by compose to avoid name conflicts
    tasks.append(
        "    - name: Get compose-managed container IDs\n"
        "      command: docker compose -f /opt/docker/docker-compose.yml ps -q\n"
        "      args:\n"
        "        chdir: /opt/docker\n"
        "      register: compose_ids\n"
        "      failed_when: false\n"
        "      changed_when: false\n"
    )
    tasks.append(
        "    - name: Get compose service names\n"
        "      command: docker compose -f /opt/docker/docker-compose.yml config --services\n"
        "      args:\n"
        "        chdir: /opt/docker\n"
        "      register: compose_services\n"
        "      changed_when: false\n"
    )
    tasks.append(
        "    - name: Remove conflicting containers not managed by compose\n"
        "      shell: |\n"
        "        for name in {{ compose_services.stdout_lines | join(' ') }}; do\n"
        "          existing=$(docker ps -aq --filter \"name=^/${name}$\" 2>/dev/null)\n"
        "          if [ -n \"$existing\" ]; then\n"
        "            compose_ids=\"{{ compose_ids.stdout | default('') }}\"\n"
        "            if ! echo \"$compose_ids\" | grep -q \"$existing\"; then\n"
        "              docker rm -f \"$existing\" || true\n"
        "            fi\n"
        "          fi\n"
        "        done\n"
        "      args:\n"
        "        executable: /bin/bash\n"
        "      changed_when: false\n"
    )

    tasks.append(
        f"    - name: Start containers\n"
        f"      command: docker compose -f /opt/docker/docker-compose.yml up -d --remove-orphans\n"
        f"      args:\n"
        f"        chdir: /opt/docker\n"
    )

    host_list = ",".join(sorted(all_hosts)) if all_hosts else "localhost"
    content = (
        f"- name: Deploy containers\n"
        f"  hosts: {host_list}\n"
        f"  strategy: free\n"  # run each host independently — pulls happen in parallel
        f"  become: true\n"
        f"  tasks:\n" + "\n".join(tasks)
    )
    (workspace_dir / "playbook.yml").write_text(content)


def _write_dns_playbook(
    workspace_dir: Path,
    repo_path: str,
    containers: list[ContainerDefinition],
    nodes: list[NodeDefinition],
    vms: list[VMDefinition],
) -> None:
    """Generate playbook to deploy Pi-hole DNS config."""
    from app.services.dns_service import get_settings as get_dns_settings

    dns_settings = get_dns_settings(repo_path)
    ip_map = build_host_ip_map(nodes, vms)
    records = get_all_records(containers, repo_path, ip_map)

    config_path = dns_settings.pihole_config_path or "/etc/pihole/custom.list"
    is_toml = config_path.endswith(".toml")
    target_host = dns_settings.pihole_host or "localhost"

    files_dir = workspace_dir / "files" / "dns"
    files_dir.mkdir(parents=True, exist_ok=True)

    if is_toml:
        _write_dns_toml_playbook(workspace_dir, files_dir, config_path, target_host, records)
    else:
        _write_dns_list_playbook(workspace_dir, files_dir, config_path, target_host, records)


def _write_dns_list_playbook(
    workspace_dir: Path,
    files_dir: Path,
    config_path: str,
    target_host: str,
    records: list,
) -> None:
    """Generate playbook for custom.list format (full file replace)."""
    dns_content = generate_pihole_custom_dns(records)
    (files_dir / "custom.list").write_text(dns_content + "\n")

    config_dir = str(Path(config_path).parent)
    content = (
        f"- name: Deploy Pi-hole DNS\n"
        f"  hosts: {target_host}\n"
        f"  become: true\n"
        f"  tasks:\n"
        f"    - name: Ensure {config_dir} exists\n"
        f"      file:\n"
        f"        path: {config_dir}\n"
        f"        state: directory\n"
        f"        mode: '0755'\n"
        f"    - name: Copy custom DNS records\n"
        f"      copy:\n"
        f"        src: files/dns/custom.list\n"
        f"        dest: {config_path}\n"
        f"        mode: '0644'\n"
        f"    - name: Restart Pi-hole container\n"
        f"      command: docker restart pihole\n"
    )
    (workspace_dir / "playbook.yml").write_text(content)


def _write_dns_toml_playbook(
    workspace_dir: Path,
    files_dir: Path,
    config_path: str,
    target_host: str,
    records: list,
) -> None:
    """Generate playbook that updates only dns.hosts in pihole.toml."""
    import json

    hosts_entries = generate_pihole_toml_hosts(records)

    # Write a Python helper script that patches only dns.hosts in the TOML file
    script = _TOML_UPDATER_SCRIPT
    (files_dir / "update_dns_hosts.py").write_text(script)

    # Write the desired hosts as JSON for the script to consume
    (files_dir / "dns_hosts.json").write_text(json.dumps(hosts_entries, indent=2) + "\n")

    content = (
        f"- name: Deploy Pi-hole DNS (toml)\n"
        f"  hosts: {target_host}\n"
        f"  become: true\n"
        f"  tasks:\n"
        f"    - name: Copy DNS update script\n"
        f"      copy:\n"
        f"        src: files/dns/update_dns_hosts.py\n"
        f"        dest: /tmp/update_dns_hosts.py\n"
        f"        mode: '0755'\n"
        f"    - name: Copy desired DNS hosts\n"
        f"      copy:\n"
        f"        src: files/dns/dns_hosts.json\n"
        f"        dest: /tmp/dns_hosts.json\n"
        f"        mode: '0644'\n"
        f"    - name: Update dns.hosts in {config_path}\n"
        f"      command: python3 /tmp/update_dns_hosts.py {config_path} /tmp/dns_hosts.json\n"
        f"    - name: Clean up temp files\n"
        f"      file:\n"
        f"        path: \"{{{{ item }}}}\"\n"
        f"        state: absent\n"
        f"      loop:\n"
        f"        - /tmp/update_dns_hosts.py\n"
        f"        - /tmp/dns_hosts.json\n"
        f"    - name: Restart Pi-hole container\n"
        f"      command: docker restart pihole\n"
    )
    (workspace_dir / "playbook.yml").write_text(content)


_TOML_UPDATER_SCRIPT = (
    '#!/usr/bin/env python3\n'
    '"""Update dns.hosts array in pihole.toml without touching other settings."""\n'
    'import json, re, sys\n'
    '\n'
    'def update_dns_hosts(toml_path, hosts_json_path):\n'
    '    with open(hosts_json_path) as f:\n'
    '        new_hosts = json.load(f)\n'
    '    with open(toml_path) as f:\n'
    '        content = f.read()\n'
    '    if new_hosts:\n'
    '        items = ",\\n    ".join(\'"\' + h + \'"\' for h in new_hosts)\n'
    '        new_array = "hosts = [\\n    " + items + ",\\n  ]"\n'
    '    else:\n'
    '        new_array = "hosts = []"\n'
    '    lines = content.split("\\n")\n'
    '    in_dns = False\n'
    '    skip = False\n'
    '    out = []\n'
    '    for line in lines:\n'
    '        s = line.strip()\n'
    '        if s.startswith("[") and not s.startswith("[["):\n'
    '            in_dns = (s == "[dns]")\n'
    '        if in_dns and not skip:\n'
    '            if re.match(r"\\s*hosts\\s*=\\s*\\[.*\\]", line):\n'
    '                out.append("  " + new_array)\n'
    '                continue\n'
    '            if re.match(r"\\s*hosts\\s*=\\s*\\[", line):\n'
    '                skip = True\n'
    '                continue\n'
    '        if skip:\n'
    '            if "]" in line:\n'
    '                skip = False\n'
    '                out.append("  " + new_array)\n'
    '            continue\n'
    '        out.append(line)\n'
    '    with open(toml_path, "w") as f:\n'
    '        f.write("\\n".join(out))\n'
    '    print("Updated dns.hosts with %d entries in %s" % (len(new_hosts), toml_path))\n'
    '\n'
    'if __name__ == "__main__":\n'
    '    update_dns_hosts(sys.argv[1], sys.argv[2])\n'
)


_CADDY_DOCKERFILE = (
    "FROM caddy:2-builder AS builder\n"
    "\n"
    "RUN xcaddy build \\\n"
    "    --with github.com/caddy-dns/cloudflare\n"
    "\n"
    "FROM caddy:2\n"
    "\n"
    "COPY --from=builder /usr/bin/caddy /usr/bin/caddy\n"
)


def _write_ingress_playbook(
    workspace_dir: Path,
    repo_path: str,
    containers: list[ContainerDefinition],
    nodes: list[NodeDefinition],
    vms: list[VMDefinition],
    secret_store: SecretStore | None = None,
    filter_hosts: set[str] | None = None,
) -> None:
    """Generate playbook to deploy Caddy container + cloudflared configs per host."""
    ingress_settings = get_ingress_settings(repo_path)
    manual_rules = get_manual_rules(repo_path)

    # Resolve Cloudflare API token from secret store
    cf_token = ""
    if ingress_settings.cloudflare_api_token_secret and secret_store:
        try:
            cf_token = secret_store.get(ingress_settings.cloudflare_api_token_secret)
        except Exception:
            logger.warning("Could not resolve CF API token secret: %s",
                           ingress_settings.cloudflare_api_token_secret)

    # Collect hosts that need Caddy
    caddy_hosts: set[str] = set()
    for ctr in containers:
        if ctr.enabled and ctr.ingress_mode == "caddy":
            caddy_hosts.update(ctr.hosts)
    for rule in manual_rules:
        caddy_hosts.add(rule.caddy_host)

    # Filter to selected hosts if specified
    if filter_hosts:
        caddy_hosts = caddy_hosts & filter_hosts

    files_dir = workspace_dir / "files"
    caddy_dir = files_dir / "caddy"
    caddy_dir.mkdir(parents=True, exist_ok=True)

    tunnel_dir = files_dir / "cloudflared"
    tunnel_dir.mkdir(parents=True, exist_ok=True)

    tunnel_hosts: set[str] = set()

    for host in sorted(caddy_hosts):
        caddyfile = generate_caddyfile(containers, host, manual_rules, ingress_settings)
        host_caddy = caddy_dir / host
        host_caddy.mkdir(parents=True, exist_ok=True)
        (host_caddy / "Caddyfile").write_text(caddyfile)
        (host_caddy / "Dockerfile").write_text(_CADDY_DOCKERFILE)

        # Write .env file with CF_API_TOKEN for the Caddy container
        if cf_token:
            (host_caddy / ".env").write_text(f"CF_API_TOKEN={cf_token}\n")

        tunnel_config = generate_tunnel_config(host, containers, manual_rules)
        if tunnel_config:
            host_tunnel = tunnel_dir / host
            host_tunnel.mkdir(parents=True, exist_ok=True)
            (host_tunnel / "config.yml").write_text(tunnel_config)
            tunnel_hosts.add(host)

    host_list = ",".join(sorted(caddy_hosts)) if caddy_hosts else "localhost"
    tasks = [
        "    - name: Ensure /opt/caddy exists\n"
        "      file:\n"
        "        path: /opt/caddy\n"
        "        state: directory\n"
        "        mode: '0755'\n",
        "    - name: Copy Caddyfile\n"
        "      copy:\n"
        '        src: "files/caddy/{{ inventory_hostname }}/Caddyfile"\n'
        "        dest: /opt/caddy/Caddyfile\n"
        "        mode: '0644'\n"
        "      register: caddyfile_result\n",
        "    - name: Copy Caddy Dockerfile\n"
        "      copy:\n"
        '        src: "files/caddy/{{ inventory_hostname }}/Dockerfile"\n'
        "        dest: /opt/caddy/Dockerfile\n"
        "        mode: '0644'\n"
        "      register: dockerfile_result\n",
    ]

    # Copy .env file with the resolved CF API token
    if cf_token:
        tasks.append(
            "    - name: Copy Caddy env file\n"
            "      copy:\n"
            '        src: "files/caddy/{{ inventory_hostname }}/.env"\n'
            "        dest: /opt/caddy/.env\n"
            "        mode: '0600'\n"
            "      register: envfile_result\n"
        )

    tasks.append(
        "    - name: Build caddy-cloudflare image\n"
        "      command: docker build -t caddy-cloudflare /opt/caddy\n"
        "      when: dockerfile_result.changed\n"
    )

    # Determine if the container needs to be recreated
    # Env vars and image changes require a full recreate (can't be reloaded)
    needs_recreate = "dockerfile_result.changed"
    if cf_token:
        needs_recreate += " or envfile_result.changed"

    docker_network = ingress_settings.docker_network or "backend"
    tasks += [
        f"    - name: Ensure Docker network '{docker_network}' exists\n"
        f"      command: docker network create {docker_network}\n"
        "      register: net_create\n"
        "      failed_when: net_create.rc != 0 and 'already exists' not in net_create.stderr\n"
        "      changed_when: net_create.rc == 0\n",
        "    - name: Check if caddy container is running\n"
        "      command: docker inspect -f '{%raw%}{{.State.Running}}{%endraw%}' caddy\n"
        "      register: caddy_running\n"
        "      failed_when: false\n"
        "      changed_when: false\n",
        "    - name: Remove existing Caddy container (not running or recreate needed)\n"
        "      command: docker rm -f caddy\n"
        "      failed_when: false\n"
        f"      when: caddy_running.rc == 0 and (caddy_running.stdout != 'true' or {needs_recreate})\n",
        "    - name: Create Caddy container\n"
        "      command: >-\n"
        "        docker run -d --name caddy\n"
        "        --restart unless-stopped\n"
        f"        --network {docker_network}\n"
        "        -p 80:80 -p 443:443 -p 443:443/udp\n"
        "        -v /opt/caddy/data:/data\n"
        "        -v /opt/caddy/config:/config\n"
        "        -v /opt/caddy/Caddyfile:/etc/caddy/Caddyfile\n"
        + ("        --env-file /opt/caddy/.env\n" if cf_token else "")
        + "        caddy-cloudflare\n"
        "      when: caddy_running.rc != 0 or caddy_running.stdout != 'true'"
        f" or {needs_recreate}\n",
        "    - name: Restart Caddy to apply config\n"
        "      command: docker restart caddy\n"
        "      when: caddyfile_result.changed and caddy_running.stdout == 'true'"
        f" and not ({needs_recreate})\n",
    ]

    content = (
        f"- name: Deploy ingress (Caddy)\n"
        f"  hosts: {host_list}\n"
        f"  become: true\n"
        f"  tasks:\n" + "\n".join(tasks)
    )

    # Resolve per-host tunnel tokens from secret store
    # Each host can have its own tunnel, or fall back to the default token
    host_tunnel_tokens: dict[str, str] = {}  # host -> resolved token
    if secret_store:
        for host in sorted(tunnel_hosts):
            secret_key = ingress_settings.tunnel_tokens.get(host) or ingress_settings.tunnel_token_secret
            if secret_key:
                try:
                    host_tunnel_tokens[host] = secret_store.get(secret_key)
                except Exception:
                    logger.warning("Could not resolve tunnel token secret '%s' for host %s",
                                   secret_key, host)

    # Auto-provision tunnels and sync ingress rules via CF API
    if cf_token and secret_store and tunnel_hosts:
        try:
            from app.services.cloudflare_service import (
                collect_external_routes,
                ensure_ssl_full,
                ensure_tunnel_dns,
                ensure_tunnel_for_host,
                get_account_id,
                get_zone_id,
                update_tunnel_ingress,
                list_tunnels,
            )
            account_id = ingress_settings.cloudflare_account_id or get_account_id(cf_token)

            # Try to get zone_id for DNS record creation
            zone_id = None
            if ingress_settings.wildcard_domain:
                # Extract base domain from wildcard (e.g. "*.cbf.nz" -> "cbf.nz")
                base_domain = ingress_settings.wildcard_domain.lstrip("*.")
                try:
                    zone_id = get_zone_id(cf_token, base_domain)
                    # Ensure SSL mode is Full to avoid redirect loops with tunnels
                    ensure_ssl_full(cf_token, zone_id)
                except Exception as e:
                    logger.warning("Could not get zone ID for %s: %s", base_domain, e)

            # For hosts without tokens: full provision (create tunnel + ingress + DNS + token)
            missing_token_hosts = {h for h in tunnel_hosts if h not in host_tunnel_tokens}
            for host in sorted(missing_token_hosts):
                try:
                    routes = collect_external_routes(host, containers, manual_rules)
                    token = ensure_tunnel_for_host(
                        cf_token, account_id, host, routes, zone_id,
                    )
                    secret_key = f"cloudflare/tunnel_token_{host}"
                    secret_store.set(secret_key, token)
                    host_tunnel_tokens[host] = token
                    logger.info("Auto-provisioned tunnel for %s, stored as secret '%s'", host, secret_key)
                except Exception as e:
                    logger.warning("Failed to auto-provision tunnel for %s: %s", host, e)

            # For hosts that already have tokens: still sync ingress rules and DNS
            # (handles newly added containers/manual rules)
            existing_token_hosts = {h for h in tunnel_hosts if h in host_tunnel_tokens} - missing_token_hosts
            if existing_token_hosts:
                try:
                    tunnels = list_tunnels(cf_token, account_id)
                    for host in sorted(existing_token_hosts):
                        tunnel_name = f"rootstock-{host}"
                        tunnel = next((t for t in tunnels if t["name"] == tunnel_name), None)
                        if tunnel:
                            routes = collect_external_routes(host, containers, manual_rules)
                            if routes:
                                try:
                                    update_tunnel_ingress(cf_token, account_id, tunnel["id"], routes)
                                except Exception as e:
                                    logger.warning("Failed to update ingress for %s: %s", host, e)
                                if zone_id:
                                    for hostname, _ in routes:
                                        try:
                                            ensure_tunnel_dns(cf_token, account_id, zone_id, tunnel["id"], hostname)
                                        except Exception as e:
                                            logger.warning("Failed to update DNS for %s: %s", hostname, e)
                except Exception as e:
                    logger.warning("Failed to sync existing tunnel configs: %s", e)
        except Exception as e:
            logger.warning("Failed to auto-provision tunnels: %s", e)

    # Only deploy to hosts that have a resolved token
    deployable_tunnel_hosts = {h for h in tunnel_hosts if h in host_tunnel_tokens}
    missing_token_hosts = tunnel_hosts - deployable_tunnel_hosts

    if deployable_tunnel_hosts:
        tunnel_list = ",".join(sorted(deployable_tunnel_hosts))

        # Write token to a file per host so Ansible can read it without shell escaping issues
        for host in sorted(deployable_tunnel_hosts):
            host_tunnel = tunnel_dir / host
            host_tunnel.mkdir(parents=True, exist_ok=True)
            (host_tunnel / "tunnel_token").write_text(host_tunnel_tokens[host])

        tunnel_tasks = [
            f"    - name: Ensure Docker network '{docker_network}' exists\n"
            f"      command: docker network create {docker_network}\n"
            "      register: tunnel_net_create\n"
            "      failed_when: tunnel_net_create.rc != 0 and 'already exists' not in tunnel_net_create.stderr\n"
            "      changed_when: tunnel_net_create.rc == 0\n",
            "    - name: Read tunnel token\n"
            "      set_fact:\n"
            '        tunnel_token: "{{ lookup(\'file\', \'files/cloudflared/\' + inventory_hostname + \'/tunnel_token\') }}"\n',
            "    - name: Check if cloudflared container is running\n"
            "      command: docker inspect -f '{%raw%}{{.State.Running}}{%endraw%}' cloudflared\n"
            "      register: cfd_running\n"
            "      failed_when: false\n"
            "      changed_when: false\n",
            "    - name: Check cloudflared container token matches\n"
            "      shell: docker inspect -f '{%raw%}{{.Config.Cmd}}{%endraw%}' cloudflared 2>/dev/null\n"
            "      register: cfd_cmd\n"
            "      failed_when: false\n"
            "      changed_when: false\n",
            "    - name: Remove cloudflared container (not running or token changed)\n"
            "      command: docker rm -f cloudflared\n"
            "      failed_when: false\n"
            "      when: >\n"
            "        cfd_running.rc == 0 and\n"
            "        (cfd_running.stdout != 'true' or tunnel_token not in (cfd_cmd.stdout | default('')))\n",
            "    - name: Create cloudflared container\n"
            "      command: >-\n"
            "        docker run -d --name cloudflared\n"
            "        --restart unless-stopped\n"
            f"        --network {docker_network}\n"
            "        cloudflare/cloudflared:latest\n"
            "        tunnel --no-autoupdate run --token {{ tunnel_token }}\n"
            "      when: >\n"
            "        cfd_running.rc != 0 or cfd_running.stdout != 'true'\n"
            "        or tunnel_token not in (cfd_cmd.stdout | default(''))\n",
            "    - name: Restart cloudflared to pick up updated tunnel ingress rules\n"
            "      command: docker restart cloudflared\n"
            "      failed_when: false\n"
            "      changed_when: true\n",
        ]

        content += (
            f"\n- name: Deploy cloudflared tunnels\n"
            f"  hosts: {tunnel_list}\n"
            f"  become: true\n"
            f"  tasks:\n" + "\n".join(tunnel_tasks)
        )

    if missing_token_hosts:
        logger.warning(
            "Hosts %s have external services but no tunnel token configured (set per-host or default in ingress settings)",
            sorted(missing_token_hosts),
        )

    (workspace_dir / "playbook.yml").write_text(content)


async def run_ansible(
    playbook: str,
    inventory: str,
    working_dir: Path,
    diff: bool = True,
    verbosity: int = 0,
) -> AsyncGenerator[str, None]:
    """Run ansible-playbook and yield output lines as they arrive."""
    cmd = [
        "ansible-playbook",
        playbook,
        "-i", inventory,
    ]
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


# --- Backups scope ---


def _write_backups_playbook(
    workspace_dir: Path,
    repo_path: str,
    containers: list[ContainerDefinition],
    nodes: list[NodeDefinition],
    vms: list[VMDefinition],
    secret_store: SecretStore | None = None,
    filter_hosts: set[str] | None = None,
) -> None:
    """Generate a playbook that deploys backup cron jobs on each host.

    For each host with backup-enabled volumes, creates a cron job that runs
    rsync from each volume to the backup target using hardlink-based snapshots.
    """
    from app.services.backup_service import get_all_backup_paths, path_slug
    from app.services.global_settings import get_global_settings

    gs = get_global_settings(repo_path)
    backup_target = gs.backup_target
    schedule = gs.backup_schedule

    if not backup_target or not schedule:
        # Write a no-op playbook with debug message
        playbook = (
            "---\n"
            "- name: Backups (skipped)\n"
            "  hosts: localhost\n"
            "  gather_facts: false\n"
            "  tasks:\n"
            "    - name: Skip - no backup target or schedule configured\n"
            "      debug:\n"
            "        msg: \"Configure backup_target and backup_schedule in Settings first\"\n"
        )
        (workspace_dir / "playbook.yml").write_text(playbook)
        return

    all_paths = get_all_backup_paths(containers, repo_path, gs.docker_vols_base)

    # Group by host
    by_host: dict[str, list] = {}
    for p in all_paths:
        by_host.setdefault(p.host, []).append(p)

    if filter_hosts:
        by_host = {h: ps for h, ps in by_host.items() if h in filter_hosts}

    if not by_host:
        playbook = (
            "---\n"
            "- name: Backups (skipped)\n"
            "  hosts: localhost\n"
            "  gather_facts: false\n"
            "  tasks:\n"
            "    - name: Skip - no backup paths found\n"
            "      debug:\n"
            "        msg: \"No volumes marked for backup\"\n"
        )
        (workspace_dir / "playbook.yml").write_text(playbook)
        return

    # Parse cron schedule
    cron_parts = schedule.strip().split()
    if len(cron_parts) != 5:
        cron_minute, cron_hour, cron_dom, cron_month, cron_dow = "*", "*", "*", "*", "*"
    else:
        cron_minute, cron_hour, cron_dom, cron_month, cron_dow = cron_parts

    plays: list[str] = []

    for host, host_paths in sorted(by_host.items()):
        # Build the backup script for this host
        script_lines = [
            "#!/bin/bash",
            "set -euo pipefail",
            f'BACKUP_TARGET="{backup_target}"',
            f'HOST="{host}"',
            'TODAY=$(date +%Y-%m-%d)',
            'LOG="/var/log/rootstock-backup.log"',
            'echo "=== Backup started at $(date) ===" >> "$LOG"',
        ]

        for bp in host_paths:
            slug = path_slug(bp.path)
            dest_latest = f"$BACKUP_TARGET/$HOST/{slug}/latest"
            dest_snapshot = f"$BACKUP_TARGET/$HOST/{slug}/$TODAY"
            exclude_flags = " ".join(f"--exclude '{e}'" for e in bp.exclusions) if bp.exclusions else ""
            script_lines += [
                f'echo "Backing up {bp.path} ..." >> "$LOG"',
                f'mkdir -p "{dest_latest}"',
                f'rsync -a --delete {exclude_flags} "{bp.path}/" "{dest_latest}/" >> "$LOG" 2>&1',
                f'rm -rf "{dest_snapshot}"',
                f'cp -al "{dest_latest}" "{dest_snapshot}"',
                f'echo "  -> {slug}/$TODAY done" >> "$LOG"',
            ]

        script_lines.append('echo "=== Backup finished at $(date) ===" >> "$LOG"')
        script_content = "\n".join(script_lines)

        # Write script to workspace
        host_files = workspace_dir / "files" / host
        host_files.mkdir(parents=True, exist_ok=True)
        (host_files / "rootstock-backup.sh").write_text(script_content)

        tasks = [
            "    - name: Ensure cron is installed\n"
            "      package:\n"
            "        name: cron\n"
            "        state: present\n",
            "    - name: Deploy backup script\n"
            "      copy:\n"
            f"        src: files/{host}/rootstock-backup.sh\n"
            "        dest: /usr/local/bin/rootstock-backup.sh\n"
            "        mode: '0755'\n",
            f"    - name: Configure backup cron job\n"
            "      cron:\n"
            "        name: rootstock-backup\n"
            f"        minute: \"{cron_minute}\"\n"
            f"        hour: \"{cron_hour}\"\n"
            f"        day: \"{cron_dom}\"\n"
            f"        month: \"{cron_month}\"\n"
            f"        weekday: \"{cron_dow}\"\n"
            "        job: /usr/local/bin/rootstock-backup.sh\n"
            "        user: root\n",
        ]

        play = (
            f"- name: Deploy backups on {host}\n"
            f"  hosts: {host}\n"
            "  become: true\n"
            "  gather_facts: false\n"
            "  tasks:\n" +
            "\n".join(tasks)
        )
        plays.append(play)

    # S3 sync play (if configured)
    s3 = gs.s3_sync
    if s3.enabled and s3.bucket and s3.sync_host and secret_store:
        try:
            from app.services.secret_store import SecretStore
            access_key = secret_store.get(s3.access_key_secret) if s3.access_key_secret else ""
            secret_key = secret_store.get(s3.secret_key_secret) if s3.secret_key_secret else ""
        except Exception:
            access_key = ""
            secret_key = ""

        if access_key and secret_key:
            s3_prefix = s3.prefix.strip("/") + "/" if s3.prefix.strip("/") else ""
            s3_script = "\n".join([
                "#!/bin/bash",
                "set -euo pipefail",
                f'export AWS_ACCESS_KEY_ID="{access_key}"',
                f'export AWS_SECRET_ACCESS_KEY="{secret_key}"',
                f'export AWS_DEFAULT_REGION="{s3.region}"',
                f'LOG="/var/log/rootstock-s3sync.log"',
                f'echo "=== S3 sync started at $(date) ===" >> "$LOG"',
                f'aws s3 sync "{backup_target}/" "s3://{s3.bucket}/{s3_prefix}" --delete >> "$LOG" 2>&1',
                f'echo "=== S3 sync finished at $(date) ===" >> "$LOG"',
            ])

            s3_files = workspace_dir / "files" / s3.sync_host
            s3_files.mkdir(parents=True, exist_ok=True)
            (s3_files / "rootstock-s3sync.sh").write_text(s3_script)

            s3_schedule = s3.schedule.strip() if s3.schedule.strip() else schedule
            s3_parts = s3_schedule.split()
            if len(s3_parts) == 5:
                s3_min, s3_hour, s3_dom, s3_month, s3_dow = s3_parts
            else:
                s3_min, s3_hour, s3_dom, s3_month, s3_dow = cron_minute, cron_hour, cron_dom, cron_month, cron_dow

            s3_play = (
                f"- name: Deploy S3 sync on {s3.sync_host}\n"
                f"  hosts: {s3.sync_host}\n"
                "  become: true\n"
                "  gather_facts: false\n"
                "  tasks:\n"
                "    - name: Ensure awscli is installed\n"
                "      apt:\n"
                "        name: awscli\n"
                "        state: present\n"
                "      ignore_errors: true\n"
                "\n"
                "    - name: Deploy S3 sync script\n"
                "      copy:\n"
                f"        src: files/{s3.sync_host}/rootstock-s3sync.sh\n"
                "        dest: /usr/local/bin/rootstock-s3sync.sh\n"
                "        mode: '0700'\n"
                "\n"
                "    - name: Configure S3 sync cron job\n"
                "      cron:\n"
                "        name: rootstock-s3sync\n"
                f"        minute: \"{s3_min}\"\n"
                f"        hour: \"{s3_hour}\"\n"
                f"        day: \"{s3_dom}\"\n"
                f"        month: \"{s3_month}\"\n"
                f"        weekday: \"{s3_dow}\"\n"
                "        job: /usr/local/bin/rootstock-s3sync.sh\n"
                "        user: root\n"
            )
            plays.append(s3_play)

    playbook = "---\n" + "\n".join(plays)
    (workspace_dir / "playbook.yml").write_text(playbook)
