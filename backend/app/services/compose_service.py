"""Generate docker-compose.yml content per host from container definitions."""

from io import StringIO

from ruamel.yaml import YAML

from app.models.container import ContainerDefinition


DEFAULT_DOCKER_VOLS = "/var/docker_vols"


def _resolve_vol_path(path: str, docker_vols_base: str) -> str:
    return path.replace("${DOCKER_VOLS}", docker_vols_base)


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

        svc: dict = {
            "container_name": ctr.name,
            "image": ctr.image,
            "restart": "unless-stopped",
        }

        # Environment
        if ctr.env:
            svc["environment"] = dict(ctr.env)

        # Ports
        if ctr.ports:
            svc["ports"] = [f"{p.host}:{p.container}" for p in ctr.ports]

        # Volumes
        if ctr.volumes:
            svc["volumes"] = [
                f"{_resolve_vol_path(v.host_path, docker_vols_base)}:{v.container_path}"
                for v in ctr.volumes
            ]

        # Network
        if ctr.network:
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
