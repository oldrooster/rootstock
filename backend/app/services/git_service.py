import logging
from pathlib import Path

from git import InvalidGitRepositoryError, Repo

from app.models.git import GitStatusResponse

log = logging.getLogger(__name__)


class GitService:
    def __init__(self, repo_path: str):
        self.repo_path = Path(repo_path)

    def ensure_initialized(self) -> None:
        """Called at startup. Inits the repo if it doesn't exist yet."""
        if not self.repo_path.exists():
            self.repo_path.mkdir(parents=True, exist_ok=True)
            log.info("Initializing new homelab repo at %s", self.repo_path)
            Repo.init(self.repo_path)
            return
        try:
            Repo(self.repo_path)
            log.info("Homelab repo found at %s", self.repo_path)
        except InvalidGitRepositoryError:
            log.warning("%s exists but is not a git repo — initializing", self.repo_path)
            Repo.init(self.repo_path)

    def _repo(self) -> Repo:
        return Repo(self.repo_path)

    def status(self) -> GitStatusResponse:
        repo = self._repo()

        # Handle fresh repo with no commits
        if not repo.head.is_valid():
            return GitStatusResponse(
                branch="main",
                is_dirty=len(repo.untracked_files) > 0,
                staged_files=[],
                unstaged_files=[],
                untracked_files=list(repo.untracked_files),
            )

        branch = repo.active_branch.name
        staged = [item.a_path for item in repo.index.diff(repo.head.commit)]
        unstaged = [item.a_path for item in repo.index.diff(None)]
        untracked = list(repo.untracked_files)
        is_dirty = repo.is_dirty(untracked_files=True)

        ahead = 0
        behind = 0
        try:
            tracking = repo.active_branch.tracking_branch()
            if tracking:
                counts = repo.git.rev_list(
                    "--left-right", "--count", f"{tracking}...HEAD"
                )
                behind, ahead = (int(x) for x in counts.split())
        except Exception:
            pass  # no remote configured yet

        return GitStatusResponse(
            branch=branch,
            is_dirty=is_dirty,
            staged_files=staged,
            unstaged_files=unstaged,
            untracked_files=untracked,
            ahead=ahead,
            behind=behind,
        )

    def commit_all(self, message: str) -> str:
        """Stage all changes and commit. Returns the commit SHA."""
        repo = self._repo()
        repo.git.add(A=True)
        commit = repo.index.commit(message)
        return commit.hexsha

    def recent_commits(self, limit: int = 10) -> list[dict]:
        """Return the most recent commits as dicts with hash, message, date."""
        repo = self._repo()
        if not repo.head.is_valid():
            return []
        result = []
        for commit in repo.iter_commits(max_count=limit):
            result.append({
                "hash": commit.hexsha[:8],
                "message": commit.message.strip(),
                "date": commit.committed_datetime.isoformat(),
            })
        return result

    def push(self) -> None:
        repo = self._repo()
        origin = repo.remote("origin")
        origin.push()
