from pathlib import Path

from ruamel.yaml import YAML

yaml = YAML()
yaml.preserve_quotes = True


def read_yaml(path: Path) -> dict:
    """Read a YAML file and return its contents as a dict."""
    if not path.exists():
        return {}
    with open(path) as f:
        return yaml.load(f) or {}


def write_yaml(path: Path, data: dict) -> None:
    """Write a dict to a YAML file, preserving formatting."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        yaml.dump(data, f)
