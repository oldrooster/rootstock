from fastapi import HTTPException

from app.models.move import MoveResult, MoveStep
from app.services.git_service import GitService
from app.services.service_store import ServiceStore


def execute_move(
    service_name: str,
    target_host: str,
    store: ServiceStore,
    git: GitService,
) -> MoveResult:
    """Execute a service move workflow, returning step-by-step results."""
    steps: list[MoveStep] = []

    # Step 1: Validate
    svc = store.get(service_name)  # raises 404 if missing
    from_host = svc.host

    if target_host == from_host:
        raise HTTPException(
            status_code=400,
            detail=f"Service '{service_name}' is already on host '{target_host}'",
        )

    if not svc.enabled:
        raise HTTPException(
            status_code=400,
            detail=f"Service '{service_name}' is disabled — enable it before moving",
        )

    steps.append(MoveStep(
        name="Validate",
        status="done",
        detail=f"Service '{service_name}' on '{from_host}' validated for move to '{target_host}'",
    ))

    # Step 2: Backup volumes
    backup_volumes = [v for v in svc.volumes if v.backup]
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

    # Step 3: Update service definition
    updated_data = svc.model_dump()
    updated_data["host"] = target_host
    from app.models.service import ServiceDefinition
    updated_svc = ServiceDefinition(**updated_data)
    store.write(updated_svc)
    steps.append(MoveStep(
        name="Update definition",
        status="done",
        detail=f"Host changed from '{from_host}' to '{target_host}'",
    ))

    # Step 4: Git commit
    git.commit_all(f"[service] move: {service_name} from {from_host} to {target_host}")
    steps.append(MoveStep(
        name="Commit",
        status="done",
        detail=f"Committed move of '{service_name}'",
    ))

    # Step 5: Deploy (simulated)
    steps.append(MoveStep(
        name="Deploy",
        status="done",
        detail="Ansible deployment not yet wired — service definition updated",
    ))

    return MoveResult(
        service=service_name,
        from_host=from_host,
        to_host=target_host,
        steps=steps,
    )
