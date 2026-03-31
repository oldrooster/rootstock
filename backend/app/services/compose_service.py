"""Generate docker-compose.yml and .env content per host from container definitions."""

import re
from io import StringIO

from ruamel.yaml import YAML

from app.models.container import ContainerDefinition


DEFAULT_DOCKER_VOLS = "/var/docker_vols"

SECRET_REF_RE = re.compile(r"\$\{secret:([^}]+)\}")


def _resolve_vol_path(path: str, docker_vols_base: str) -> str:
    return path.replace("${DOCKER_VOLS}", docker_vols_base)


def _process_env(
    env: dict[str, str],
) -> tuple[dict[str, str], dict[str, str]]:
    """Split env vars into compose env (with ${VAR} refs) and .env entries.

    Returns (compose_env, dotenv_entries) where:
    - compose_env: env dict for docker-compose (secret refs replaced with ${VAR_NAME})
    - dotenv_entries: VAR_NAME -> secret_path for .env resolution
    """
    compose_env: dict[str, str] = {}
    dotenv: dict[str, str] = {}

    for key, value in env.items():
        match = SECRET_REF_RE.fullmatch(value)
        if match:
            # Entire value is a secret ref -> use ${VAR_NAME} in compose
            dotenv[key] = match.group(1)
            compose_env[key] = f"${{{key}}}"
        elif SECRET_REF_RE.search(value):
            # Partial secret ref within string (unlikely but handle it)
            # Replace all ${secret:x} with ${VARNAME_n} placeholders
            idx = 0
            result = value
            for m in SECRET_REF_RE.finditer(value):
                env_key = f"{key}__SECRET{idx}" if idx > 0 else key
                dotenv[env_key] = m.group(1)
                result = result.replace(m.group(0), f"${{{env_key}}}")
                idx += 1
            compose_env[key] = result
        else:
            compose_env[key] = value

    return compose_env, dotenv


def generate_compose(
    host: str,
    containers: list[ContainerDefinition],
    docker_vols_base: str = DEFAULT_DOCKER_VOLS,
) -> str:
    """Generate a docker-compose.yml for all containers assigned to a host."""
    services = {}
    networks = set()

    for ctr in containers:
        if not ctr.enabled:
            continue

        compose_env, _ = _process_env(ctr.env)

        svc: dict = {
            "container_name": ctr.name,
            "image": ctr.image,
            "restart": "unless-stopped",
        }

        # Environment
        if compose_env:
            svc["environment"] = compose_env

        # Ports
        if ctr.ports:
            svc["ports"] = [f"{p.host}:{p.container}" for p in ctr.ports]

        # Volumes
        if ctr.volumes:
            svc["volumes"] = [
                f"{_resolve_vol_path(v.host_path, docker_vols_base)}:{v.container_path}"
                for v in ctr.volumes
            ]

        # Devices
        if ctr.devices:
            svc["devices"] = list(ctr.devices)

        # Depends on
        if ctr.depends_on:
            svc["depends_on"] = list(ctr.depends_on)

        # Healthcheck
        if ctr.healthcheck and ctr.healthcheck.test:
            svc["healthcheck"] = {
                "test": ["CMD-SHELL", ctr.healthcheck.test],
                "interval": ctr.healthcheck.interval,
                "timeout": ctr.healthcheck.timeout,
                "retries": ctr.healthcheck.retries,
            }

        # Network
        if ctr.network:
            if ctr.network in ("host", "none"):
                svc["network_mode"] = ctr.network
            else:
                svc["networks"] = [ctr.network]
                networks.add(ctr.network)

        services[ctr.name] = svc

        # Compose extras (sidecars)
        for extra_name, extra in ctr.compose_extras.items():
            extra_svc: dict = {
                "image": extra.image,
                "restart": "unless-stopped",
            }
            if extra.environment:
                extra_svc["environment"] = dict(extra.environment)
            if extra.volumes:
                extra_svc["volumes"] = [
                    _resolve_vol_path(v, docker_vols_base) for v in extra.volumes
                ]
            if extra.ports:
                extra_svc["ports"] = list(extra.ports)
            if extra.command:
                extra_svc["command"] = extra.command
            if ctr.network:
                if ctr.network in ("host", "none"):
                    extra_svc["network_mode"] = ctr.network
                else:
                    extra_svc["networks"] = [ctr.network]
            services[f"{ctr.name}-{extra_name}"] = extra_svc

    if not services:
        return "# No containers assigned to this host\n"

    compose: dict = {"services": services}
    if networks:
        compose["networks"] = {n: {"external": True} for n in sorted(networks)}

    yaml = YAML()
    yaml.default_flow_style = False
    buf = StringIO()
    yaml.dump(compose, buf)
    return buf.getvalue()


def generate_env_file(
    host: str,
    containers: list[ContainerDefinition],
    secret_store,
) -> str:
    """Generate a .env file with resolved secrets for all containers on a host.

    Returns the .env file content (empty string if no secrets needed).
    """
    lines: list[str] = []

    for ctr in containers:
        if not ctr.enabled:
            continue

        _, dotenv = _process_env(ctr.env)
        for var_name, secret_path in sorted(dotenv.items()):
            try:
                value = secret_store.get(secret_path)
                # Escape newlines and quotes for .env compatibility
                escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
                lines.append(f'{var_name}="{escaped}"')
            except Exception:
                lines.append(f"# WARNING: secret '{secret_path}' not found for {var_name}")

    return "\n".join(lines) + "\n" if lines else ""


def resolve_hosts(
    container: ContainerDefinition,
    all_nodes: list,
    all_vms: list,
) -> list[str]:
    """Resolve the effective host list for a container.

    Combines explicit hosts + role-based rule (union).
    """
    hosts = set(container.hosts)

    if container.host_rule.startswith("role:"):
        target_role = container.host_rule.split(":", 1)[1].strip()
        for node in all_nodes:
            if target_role in getattr(node, "roles", []):
                hosts.add(node.name)
        for vm in all_vms:
            if target_role in getattr(vm, "roles", []):
                hosts.add(vm.name)

    return sorted(hosts)
