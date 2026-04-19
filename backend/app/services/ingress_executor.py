"""Ansible workspace generation for the 'ingress' scope."""

import logging
from pathlib import Path

from app.models.container import ContainerDefinition
from app.models.node import NodeDefinition
from app.models.vm import VMDefinition
from app.services.caddy_service import generate_caddyfile
from app.services.cloudflare_service import generate_tunnel_config
from app.services.ingress_service import get_manual_rules, get_settings as get_ingress_settings
from app.services.playbook_util import dump_playbook, literal, task
from app.services.secret_store import SecretStore

logger = logging.getLogger(__name__)

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


def write_ingress_playbook(
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

    cf_token = ""
    if ingress_settings.cloudflare_api_token_secret and secret_store:
        try:
            cf_token = secret_store.get(ingress_settings.cloudflare_api_token_secret)
        except Exception:
            logger.warning("Could not resolve CF API token secret: %s",
                           ingress_settings.cloudflare_api_token_secret)

    caddy_hosts: set[str] = set()
    for ctr in containers:
        if ctr.enabled and ctr.ingress_mode == "caddy":
            caddy_hosts.update(ctr.hosts)
    for rule in manual_rules:
        caddy_hosts.add(rule.caddy_host)

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
        if cf_token:
            (host_caddy / ".env").write_text(f"CF_API_TOKEN={cf_token}\n")
        tunnel_config = generate_tunnel_config(host, containers, manual_rules)
        if tunnel_config:
            host_tunnel = tunnel_dir / host
            host_tunnel.mkdir(parents=True, exist_ok=True)
            (host_tunnel / "config.yml").write_text(tunnel_config)
            tunnel_hosts.add(host)

    host_list = ",".join(sorted(caddy_hosts)) if caddy_hosts else "localhost"
    docker_network = ingress_settings.docker_network or "backend"

    needs_recreate = "dockerfile_result.changed"
    if cf_token:
        needs_recreate += " or envfile_result.changed"

    caddy_tasks: list[dict] = [
        task("Ensure /opt/caddy exists",
             file={"path": "/opt/caddy", "state": "directory", "mode": "0755"}),
        task("Copy Caddyfile",
             copy={
                 "src": "files/caddy/{{ inventory_hostname }}/Caddyfile",
                 "dest": "/opt/caddy/Caddyfile",
                 "mode": "0644",
             },
             register="caddyfile_result"),
        task("Copy Caddy Dockerfile",
             copy={
                 "src": "files/caddy/{{ inventory_hostname }}/Dockerfile",
                 "dest": "/opt/caddy/Dockerfile",
                 "mode": "0644",
             },
             register="dockerfile_result"),
    ]

    if cf_token:
        caddy_tasks.append(task(
            "Copy Caddy env file",
            copy={
                "src": "files/caddy/{{ inventory_hostname }}/.env",
                "dest": "/opt/caddy/.env",
                "mode": "0600",
            },
            register="envfile_result",
        ))

    caddy_tasks += [
        task("Build caddy-cloudflare image",
             command="docker build -t caddy-cloudflare /opt/caddy",
             when="dockerfile_result.changed"),
        task(f"Ensure Docker network '{docker_network}' exists",
             command=f"docker network create {docker_network}",
             register="net_create",
             failed_when="net_create.rc != 0 and 'already exists' not in net_create.stderr",
             changed_when="net_create.rc == 0"),
        task("Check if caddy container is running",
             command="docker inspect -f '{%raw%}{{.State.Running}}{%endraw%}' caddy",
             register="caddy_running",
             failed_when=False,
             changed_when=False),
        task("Remove existing Caddy container (not running or recreate needed)",
             command="docker rm -f caddy",
             failed_when=False,
             when=f"caddy_running.rc == 0 and (caddy_running.stdout != 'true' or {needs_recreate})"),
        task("Create Caddy container",
             command=(
                 "docker run -d --name caddy"
                 " --restart unless-stopped"
                 f" --network {docker_network}"
                 " -p 80:80 -p 443:443 -p 443:443/udp"
                 " -v /opt/caddy/data:/data"
                 " -v /opt/caddy/config:/config"
                 " -v /opt/caddy/Caddyfile:/etc/caddy/Caddyfile"
                 + (" --env-file /opt/caddy/.env" if cf_token else "")
                 + " caddy-cloudflare"
             ),
             when=f"caddy_running.rc != 0 or caddy_running.stdout != 'true' or {needs_recreate}"),
        task("Restart Caddy to apply config",
             command="docker restart caddy",
             when=(
                 f"caddyfile_result.changed and caddy_running.stdout == 'true'"
                 f" and not ({needs_recreate})"
             )),
    ]

    plays: list[dict] = [{
        "name": "Deploy ingress (Caddy)",
        "hosts": host_list,
        "become": True,
        "tasks": caddy_tasks,
    }]

    # Resolve per-host tunnel tokens
    host_tunnel_tokens: dict[str, str] = {}
    if secret_store:
        for host in sorted(tunnel_hosts):
            secret_key = ingress_settings.tunnel_tokens.get(host) or ingress_settings.tunnel_token_secret
            if secret_key:
                try:
                    host_tunnel_tokens[host] = secret_store.get(secret_key)
                except Exception:
                    logger.warning("Could not resolve tunnel token secret '%s' for host %s",
                                   secret_key, host)

    # Auto-provision tunnels via CF API
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
            zone_id = None
            if ingress_settings.wildcard_domain:
                base_domain = ingress_settings.wildcard_domain.lstrip("*.")
                try:
                    zone_id = get_zone_id(cf_token, base_domain)
                    ensure_ssl_full(cf_token, zone_id)
                except Exception as e:
                    logger.warning("Could not get zone ID for %s: %s", base_domain, e)

            missing_token_hosts = {h for h in tunnel_hosts if h not in host_tunnel_tokens}
            for host in sorted(missing_token_hosts):
                try:
                    routes = collect_external_routes(host, containers, manual_rules)
                    token = ensure_tunnel_for_host(cf_token, account_id, host, routes, zone_id)
                    secret_key = f"cloudflare/tunnel_token_{host}"
                    secret_store.set(secret_key, token)
                    host_tunnel_tokens[host] = token
                    logger.info("Auto-provisioned tunnel for %s", host)
                except Exception as e:
                    logger.warning("Failed to auto-provision tunnel for %s: %s", host, e)

            existing_token_hosts = (
                {h for h in tunnel_hosts if h in host_tunnel_tokens} - missing_token_hosts
            )
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
                                            ensure_tunnel_dns(
                                                cf_token, account_id, zone_id, tunnel["id"], hostname
                                            )
                                        except Exception as e:
                                            logger.warning("Failed to update DNS for %s: %s", hostname, e)
                except Exception as e:
                    logger.warning("Failed to sync existing tunnel configs: %s", e)
        except Exception as e:
            logger.warning("Failed to auto-provision tunnels: %s", e)

    deployable_tunnel_hosts = {h for h in tunnel_hosts if h in host_tunnel_tokens}
    missing_token_hosts = tunnel_hosts - deployable_tunnel_hosts

    if deployable_tunnel_hosts:
        tunnel_list = ",".join(sorted(deployable_tunnel_hosts))
        for host in sorted(deployable_tunnel_hosts):
            host_tunnel = tunnel_dir / host
            host_tunnel.mkdir(parents=True, exist_ok=True)
            (host_tunnel / "tunnel_token").write_text(host_tunnel_tokens[host])

        tunnel_tasks: list[dict] = [
            task(f"Ensure Docker network '{docker_network}' exists",
                 command=f"docker network create {docker_network}",
                 register="tunnel_net_create",
                 failed_when=(
                     "tunnel_net_create.rc != 0 and "
                     "'already exists' not in tunnel_net_create.stderr"
                 ),
                 changed_when="tunnel_net_create.rc == 0"),
            task("Read tunnel token",
                 set_fact={
                     "tunnel_token": (
                         "{{ lookup('file', 'files/cloudflared/' "
                         "+ inventory_hostname + '/tunnel_token') }}"
                     ),
                 }),
            task("Check if cloudflared container is running",
                 command="docker inspect -f '{%raw%}{{.State.Running}}{%endraw%}' cloudflared",
                 register="cfd_running",
                 failed_when=False,
                 changed_when=False),
            task("Check cloudflared container token matches",
                 shell=(
                     "docker inspect -f '{%raw%}{{.Config.Cmd}}{%endraw%}' "
                     "cloudflared 2>/dev/null"
                 ),
                 register="cfd_cmd",
                 failed_when=False,
                 changed_when=False),
            task("Remove cloudflared container (not running or token changed)",
                 command="docker rm -f cloudflared",
                 failed_when=False,
                 when=(
                     "cfd_running.rc == 0 and "
                     "(cfd_running.stdout != 'true' or "
                     "tunnel_token not in (cfd_cmd.stdout | default('')))"
                 )),
            task("Create cloudflared container",
                 command=(
                     "docker run -d --name cloudflared"
                     " --restart unless-stopped"
                     f" --network {docker_network}"
                     " cloudflare/cloudflared:latest"
                     " tunnel --no-autoupdate run --token {{ tunnel_token }}"
                 ),
                 when=(
                     "cfd_running.rc != 0 or cfd_running.stdout != 'true' "
                     "or tunnel_token not in (cfd_cmd.stdout | default(''))"
                 )),
            task("Restart cloudflared to pick up updated tunnel ingress rules",
                 command="docker restart cloudflared",
                 failed_when=False,
                 changed_when=True),
        ]

        plays.append({
            "name": "Deploy cloudflared tunnels",
            "hosts": tunnel_list,
            "become": True,
            "tasks": tunnel_tasks,
        })

    if missing_token_hosts:
        logger.warning(
            "Hosts %s have external services but no tunnel token configured",
            sorted(missing_token_hosts),
        )

    (workspace_dir / "playbook.yml").write_text(dump_playbook(plays))
