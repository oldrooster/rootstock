"""Ansible workspace generation for the 'dns' scope."""

from pathlib import Path

from app.models.container import ContainerDefinition
from app.models.node import NodeDefinition
from app.models.vm import VMDefinition
from app.services.dns_service import (
    build_host_ip_map,
    generate_pihole_custom_dns,
    generate_pihole_toml_hosts,
    get_all_records,
)
from app.services.playbook_util import dump_playbook, literal, task


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


def write_dns_playbook(
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
    dns_content = generate_pihole_custom_dns(records)
    (files_dir / "custom.list").write_text(dns_content + "\n")

    config_dir = str(Path(config_path).parent)
    plays = [{
        "name": "Deploy Pi-hole DNS",
        "hosts": target_host,
        "become": True,
        "tasks": [
            task(f"Ensure {config_dir} exists",
                 file={"path": config_dir, "state": "directory", "mode": "0755"}),
            task("Copy custom DNS records",
                 copy={"src": "files/dns/custom.list", "dest": config_path, "mode": "0644"}),
            task("Restart Pi-hole container", command="docker restart pihole"),
        ],
    }]
    (workspace_dir / "playbook.yml").write_text(dump_playbook(plays))


def _write_dns_toml_playbook(
    workspace_dir: Path,
    files_dir: Path,
    config_path: str,
    target_host: str,
    records: list,
) -> None:
    import json

    hosts_entries = generate_pihole_toml_hosts(records)
    (files_dir / "update_dns_hosts.py").write_text(_TOML_UPDATER_SCRIPT)
    (files_dir / "dns_hosts.json").write_text(json.dumps(hosts_entries, indent=2) + "\n")

    plays = [{
        "name": "Deploy Pi-hole DNS (toml)",
        "hosts": target_host,
        "become": True,
        "tasks": [
            task("Copy DNS update script",
                 copy={"src": "files/dns/update_dns_hosts.py",
                       "dest": "/tmp/update_dns_hosts.py", "mode": "0755"}),
            task("Copy desired DNS hosts",
                 copy={"src": "files/dns/dns_hosts.json",
                       "dest": "/tmp/dns_hosts.json", "mode": "0644"}),
            task(f"Update dns.hosts in {config_path}",
                 command=f"python3 /tmp/update_dns_hosts.py {config_path} /tmp/dns_hosts.json"),
            task("Clean up temp files",
                 file={"path": "{{ item }}", "state": "absent"},
                 loop=["/tmp/update_dns_hosts.py", "/tmp/dns_hosts.json"]),
            task("Restart Pi-hole container", command="docker restart pihole"),
        ],
    }]
    (workspace_dir / "playbook.yml").write_text(dump_playbook(plays))
