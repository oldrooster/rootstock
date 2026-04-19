"""Ansible workspace generation for the 'containers' scope."""

from pathlib import Path

from app.models.container import ContainerDefinition
from app.models.node import NodeDefinition
from app.models.vm import VMDefinition
from app.services.compose_service import generate_compose, generate_env_file
from app.services.playbook_util import dump_playbook, literal, task
from app.services.secret_store import SecretStore


def write_containers_playbook(
    workspace_dir: Path,
    repo_path: str,
    containers: list[ContainerDefinition],
    nodes: list[NodeDefinition],
    vms: list[VMDefinition],
    secret_store: SecretStore | None = None,
    filter_hosts: set[str] | None = None,
    free_strategy: bool = False,
) -> None:
    """Generate playbook + compose + .env files for deploying containers per host."""
    files_dir = workspace_dir / "files" / "compose"
    files_dir.mkdir(parents=True, exist_ok=True)

    PREDEFINED_NETWORKS = {"host", "bridge", "none"}
    all_hosts: set[str] = set()
    all_networks: set[str] = set()
    for ctr in containers:
        if ctr.enabled:
            all_hosts.update(ctr.hosts)
            if ctr.network and ctr.network not in PREDEFINED_NETWORKS:
                all_networks.add(ctr.network)

    if filter_hosts:
        all_hosts = all_hosts & filter_hosts

    has_env_file = False
    for host in sorted(all_hosts):
        host_containers = [c for c in containers if c.enabled and host in c.hosts]
        compose_content = generate_compose(host, host_containers)
        host_dir = files_dir / host
        host_dir.mkdir(parents=True, exist_ok=True)
        (host_dir / "docker-compose.yml").write_text(compose_content)

        if secret_store:
            env_content = generate_env_file(host, host_containers, secret_store)
            (host_dir / ".env").write_text(env_content or "")
            has_env_file = True

    build_containers_by_host: dict[str, list[ContainerDefinition]] = {}
    for ctr in containers:
        if ctr.enabled and ctr.build_repo:
            for host in ctr.hosts:
                build_containers_by_host.setdefault(host, []).append(ctr)

    tasks: list[dict] = [
        task("Ensure /opt/docker exists",
             file={"path": "/opt/docker", "state": "directory", "mode": "0755"}),
    ]

    for net in sorted(all_networks):
        tasks.append(task(
            f"Ensure Docker network '{net}' exists",
            command=f"docker network create {net}",
            register="net_create",
            failed_when="net_create.rc != 0 and 'already exists' not in net_create.stderr",
            changed_when="net_create.rc == 0",
        ))

    all_build_ctrs = {c.name: c for c in containers if c.enabled and c.build_repo}
    for ctr in all_build_ctrs.values():
        build_dir = f"/opt/docker/build/{ctr.name}"
        ctr_hosts = [h for h in ctr.hosts if h in all_hosts]
        when_parts = None
        if set(ctr_hosts) != all_hosts:
            host_list_str = ", ".join(f"'{h}'" for h in sorted(ctr_hosts))
            when_parts = f"inventory_hostname in [{host_list_str}]"

        clone_task = task(
            f"Clone/update repo for '{ctr.name}'",
            git={"repo": ctr.build_repo, "dest": build_dir,
                 "version": ctr.build_branch, "force": True},
        )
        if when_parts:
            clone_task["when"] = when_parts

        target_flag = f" --target {ctr.build_target}" if ctr.build_target else ""
        dockerfile_path = ctr.build_dockerfile
        if ctr.build_context != "." and "/" not in ctr.build_dockerfile:
            dockerfile_path = f"{ctr.build_context}/{ctr.build_dockerfile}".replace("//", "/")
        build_task = task(
            f"Build image for '{ctr.name}'",
            command=f"docker build -t {ctr.image} -f {dockerfile_path}{target_flag} {ctr.build_context}",
            args={"chdir": build_dir},
        )
        if when_parts:
            build_task["when"] = when_parts

        tasks += [clone_task, build_task]

    tasks.append(task("Copy docker-compose.yml",
                      copy={
                          "src": "files/compose/{{ inventory_hostname }}/docker-compose.yml",
                          "dest": "/opt/docker/docker-compose.yml",
                          "mode": "0644",
                      }))

    if has_env_file:
        tasks.append(task("Copy .env file (secrets)",
                          copy={
                              "src": "files/compose/{{ inventory_hostname }}/.env",
                              "dest": "/opt/docker/.env",
                              "mode": "0600",
                          }))

    # Pull tasks — optimise: one task if all hosts need the same services
    pull_services_by_host: dict[str, list[str]] = {}
    for host in sorted(all_hosts):
        host_containers = [c for c in containers if c.enabled and host in c.hosts]
        pull_names = [c.name for c in host_containers if not c.build_repo]
        if pull_names:
            pull_services_by_host[host] = pull_names

    if pull_services_by_host:
        all_pull_lists = list(pull_services_by_host.values())
        if len(set(tuple(s) for s in all_pull_lists)) == 1 and set(pull_services_by_host) == all_hosts:
            svc_list = " ".join(all_pull_lists[0])
            tasks.append(task(
                "Pull latest images",
                command=f"docker compose -f /opt/docker/docker-compose.yml pull {svc_list}",
                args={"chdir": "/opt/docker"},
                register="pull_result",
                changed_when=(
                    "'Pull complete' in pull_result.stderr or "
                    "'Downloaded newer' in pull_result.stderr"
                ),
            ))
        else:
            for host, svc_names in sorted(pull_services_by_host.items()):
                svc_list = " ".join(svc_names)
                tasks.append(task(
                    f"Pull latest images on {host}",
                    command=f"docker compose -f /opt/docker/docker-compose.yml pull {svc_list}",
                    args={"chdir": "/opt/docker"},
                    when=f"inventory_hostname == '{host}'",
                    register="pull_result",
                    changed_when=(
                        "'Pull complete' in pull_result.stderr or "
                        "'Downloaded newer' in pull_result.stderr"
                    ),
                ))

    tasks += [
        task("Get compose-managed container IDs",
             command="docker compose -f /opt/docker/docker-compose.yml ps -q",
             args={"chdir": "/opt/docker"},
             register="compose_ids",
             failed_when=False,
             changed_when=False),
        task("Get compose service names",
             command="docker compose -f /opt/docker/docker-compose.yml config --services",
             args={"chdir": "/opt/docker"},
             register="compose_services",
             changed_when=False),
        task("Remove conflicting containers not managed by compose",
             shell=literal(
                 "for name in {{ compose_services.stdout_lines | join(' ') }}; do\n"
                 "  existing=$(docker ps -aq --filter \"name=^/${name}$\" 2>/dev/null)\n"
                 "  if [ -n \"$existing\" ]; then\n"
                 "    compose_ids=\"{{ compose_ids.stdout | default('') }}\"\n"
                 "    if ! echo \"$compose_ids\" | grep -q \"$existing\"; then\n"
                 "      docker rm -f \"$existing\" || true\n"
                 "    fi\n"
                 "  fi\n"
                 "done\n"
             ),
             args={"executable": "/bin/bash"},
             changed_when=False),
        task("Start containers",
             command="docker compose -f /opt/docker/docker-compose.yml up -d --remove-orphans",
             args={"chdir": "/opt/docker"}),
    ]

    host_list = ",".join(sorted(all_hosts)) if all_hosts else "localhost"
    play: dict = {
        "name": "Deploy containers",
        "hosts": host_list,
        "become": True,
        "tasks": tasks,
    }
    if free_strategy:
        play["strategy"] = "free"

    (workspace_dir / "playbook.yml").write_text(dump_playbook([play]))
