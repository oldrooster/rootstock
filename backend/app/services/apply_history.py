"""Per-scope apply run history.

Stores the last N apply runs (timestamp, scope, exit code, truncated log)
in a JSON file inside the homelab repo.
"""

import json
import logging
import time
from pathlib import Path

logger = logging.getLogger(__name__)

_HISTORY_FILE = "apply/history.json"
_MAX_RUNS = 50  # per scope
_MAX_LOG_BYTES = 8192  # truncate log at 8 KB per run


def _history_path(repo_path: str) -> Path:
    p = Path(repo_path) / _HISTORY_FILE
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def load_history(repo_path: str) -> dict[str, list[dict]]:
    """Return {scope: [run, ...]} sorted newest-first."""
    p = _history_path(repo_path)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text())
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Could not read apply history: %s", e)
        return {}


def record_run(
    repo_path: str,
    scope: str,
    exit_code: int,
    log: str,
) -> None:
    """Append a run entry for *scope* and trim to _MAX_RUNS."""
    history = load_history(repo_path)
    runs = history.setdefault(scope, [])

    entry = {
        "timestamp": time.time(),
        "scope": scope,
        "exit_code": exit_code,
        "log": log[-_MAX_LOG_BYTES:],
    }
    runs.insert(0, entry)
    if len(runs) > _MAX_RUNS:
        runs[:] = runs[:_MAX_RUNS]

    history[scope] = runs
    try:
        _history_path(repo_path).write_text(json.dumps(history, indent=2))
    except OSError as e:
        logger.warning("Could not write apply history: %s", e)
