from fastapi import HTTPException

from app.models.move import MoveResult, MoveStep
from app.services.container_store import ContainerStore
from app.services.git_service import GitService


def execute_move(
    container_name: str,
    target_host: str,
    store: ContainerStore,
    git: GitService,
) -> MoveResult:
    """Execute a container move workflow, returning step-by-step results."""
    steps: list[MoveStep] = []

    # Step 1: Validate
    ctr = store.get(container_name)  # raises 404 if missing
    from_hosts = ctr.hosts

    if not from_hosts:
        raise HTTPException(
            status_code=400,
            detail=f"Container '{container_name}' has no hosts assigned",
        )

    from_host = from_hosts[0] if len(from_hosts) == 1 else ", ".join(from_hosts)

    if len(from_hosts) == 1 and target_host == from_hosts[0]:
        raise HTTPException(
            status_code=400,
            detail=f"Container '{container_name}' is already on host '{target_host}'",
        )

    if not ctr.enabled:
        raise HTTPException(
            status_code=400,
            detail=f"Container '{container_name}' is disabled — enable it before moving",
        )

    steps.append(MoveStep(
        name="Validate",
        status="done",
        detail=f"Container '{container_name}' validated for move to '{target_host}'",
    ))

    # Step 2: Backup volumes
    backup_volumes = [v for v in ctr.volumes if v.backup]
    if backup_volumes:
        vol_paths = ", ".join(v.host_path for v in backup_volumes)
        steps.append(MoveStep(
            name="Backup volumes",
            status="done",
            detail=f"Simulated backup of {len(backup_volumes)} volume(s): {vol_paths}",
        ))
    else:
        steps.append(MoveStep(
            name="Backup volumes",
            status="skipped",
            detail="No volumes with backup enabled",
        ))

    # Step 3: Update container definition
    ctr.hosts = [target_host]
    store.write(ctr)
    steps.append(MoveStep(
        name="Update definition",
        status="done",
        detail=f"Host changed from '{from_host}' to '{target_host}'",
    ))

    # Step 4: Git commit
    git.commit_all(f"[container] move: {container_name} from {from_host} to {target_host}")
    steps.append(MoveStep(
        name="Commit",
        status="done",
        detail=f"Committed move of '{container_name}'",
    ))

    # Step 5: Deploy (simulated)
    steps.append(MoveStep(
        name="Deploy",
        status="done",
        detail="Ansible deployment not yet wired — container definition updated",
    ))

    return MoveResult(
        service=container_name,
        from_host=from_host,
        to_host=target_host,
        steps=steps,
    )
