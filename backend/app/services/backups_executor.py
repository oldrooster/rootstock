"""Ansible workspace generation for the 'backups' scope."""

import logging
from pathlib import Path

from app.models.container import ContainerDefinition
from app.models.node import NodeDefinition
from app.models.vm import VMDefinition
from app.services.playbook_util import dump_playbook, literal, task
from app.services.secret_store import SecretStore

logger = logging.getLogger(__name__)

_NOOP_PLAYS = [{
    "name": "Backups (skipped)",
    "hosts": "localhost",
    "gather_facts": False,
    "tasks": [task("Skip", debug={"msg": "{reason}"})],
}]


def write_backups_playbook(
    workspace_dir: Path,
    repo_path: str,
    containers: list[ContainerDefinition],
    nodes: list[NodeDefinition],
    vms: list[VMDefinition],
    secret_store: SecretStore | None = None,
    filter_hosts: set[str] | None = None,
) -> None:
    """Generate a playbook that deploys backup cron jobs on each host."""
    from app.services.backup_service import get_all_backup_paths, path_slug
    from app.services.global_settings import get_global_settings

    gs = get_global_settings(repo_path)
    backup_target = gs.backup_target
    schedule = gs.backup_schedule

    if not backup_target or not schedule:
        noop = [{**_NOOP_PLAYS[0], "tasks": [task("Skip", debug={
            "msg": "Configure backup_target and backup_schedule in Settings first"
        })]}]
        (workspace_dir / "playbook.yml").write_text(dump_playbook(noop))
        return

    all_paths = get_all_backup_paths(containers, repo_path, gs.docker_vols_base)
    by_host: dict[str, list] = {}
    for p in all_paths:
        by_host.setdefault(p.host, []).append(p)

    if filter_hosts:
        by_host = {h: ps for h, ps in by_host.items() if h in filter_hosts}

    if not by_host:
        noop = [{**_NOOP_PLAYS[0], "tasks": [task("Skip", debug={"msg": "No volumes marked for backup"})]}]
        (workspace_dir / "playbook.yml").write_text(dump_playbook(noop))
        return

    cron_parts = schedule.strip().split()
    if len(cron_parts) != 5:
        cron_minute, cron_hour, cron_dom, cron_month, cron_dow = "*", "*", "*", "*", "*"
    else:
        cron_minute, cron_hour, cron_dom, cron_month, cron_dow = cron_parts

    plays: list[dict] = []

    for host, host_paths in sorted(by_host.items()):
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

        host_files = workspace_dir / "files" / host
        host_files.mkdir(parents=True, exist_ok=True)
        (host_files / "rootstock-backup.sh").write_text(script_content)

        plays.append({
            "name": f"Deploy backups on {host}",
            "hosts": host,
            "become": True,
            "gather_facts": False,
            "tasks": [
                task("Ensure cron is installed", package={"name": "cron", "state": "present"}),
                task("Deploy backup script",
                     copy={"src": f"files/{host}/rootstock-backup.sh",
                           "dest": "/usr/local/bin/rootstock-backup.sh",
                           "mode": "0755"}),
                task("Configure backup cron job",
                     cron={
                         "name": "rootstock-backup",
                         "minute": cron_minute,
                         "hour": cron_hour,
                         "day": cron_dom,
                         "month": cron_month,
                         "weekday": cron_dow,
                         "job": "/usr/local/bin/rootstock-backup.sh",
                         "user": "root",
                     }),
            ],
        })

    # S3 sync play
    s3 = gs.s3_sync
    if s3.enabled and s3.bucket and s3.sync_host and secret_store:
        try:
            access_key = secret_store.get(s3.access_key_secret) if s3.access_key_secret else ""
            secret_key_val = secret_store.get(s3.secret_key_secret) if s3.secret_key_secret else ""
        except Exception:
            access_key = ""
            secret_key_val = ""

        if access_key and secret_key_val:
            s3_prefix = s3.prefix.strip("/") + "/" if s3.prefix.strip("/") else ""
            s3_script = "\n".join([
                "#!/bin/bash",
                "set -euo pipefail",
                f'export AWS_ACCESS_KEY_ID="{access_key}"',
                f'export AWS_SECRET_ACCESS_KEY="{secret_key_val}"',
                f'export AWS_DEFAULT_REGION="{s3.region}"',
                'LOG="/var/log/rootstock-s3sync.log"',
                'echo "=== S3 sync started at $(date) ===" >> "$LOG"',
                f'aws s3 sync "{backup_target}/" "s3://{s3.bucket}/{s3_prefix}" --delete >> "$LOG" 2>&1',
                'echo "=== S3 sync finished at $(date) ===" >> "$LOG"',
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

            plays.append({
                "name": f"Deploy S3 sync on {s3.sync_host}",
                "hosts": s3.sync_host,
                "become": True,
                "gather_facts": False,
                "tasks": [
                    task("Ensure awscli is installed",
                         apt={"name": "awscli", "state": "present"},
                         ignore_errors=True),
                    task("Deploy S3 sync script",
                         copy={"src": f"files/{s3.sync_host}/rootstock-s3sync.sh",
                               "dest": "/usr/local/bin/rootstock-s3sync.sh",
                               "mode": "0700"}),
                    task("Configure S3 sync cron job",
                         cron={
                             "name": "rootstock-s3sync",
                             "minute": s3_min,
                             "hour": s3_hour,
                             "day": s3_dom,
                             "month": s3_month,
                             "weekday": s3_dow,
                             "job": "/usr/local/bin/rootstock-s3sync.sh",
                             "user": "root",
                         }),
                ],
            })

    (workspace_dir / "playbook.yml").write_text(dump_playbook(plays))
