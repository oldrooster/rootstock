from pathlib import Path

from pydantic import BaseModel

from app.services import yaml_service


class ManualRule(BaseModel):
    name: str
    hostname: str
    backend: str  # full URL, e.g. "https://10.0.0.5:8006"
    caddy_host: str  # which node/VM's Caddy instance handles this
    external: bool = False


class IngressSettings(BaseModel):
    wildcard_domain: str = ""
    cloudflare_api_token_secret: str = ""  # ref to SecretStore key
    cloudflare_account_id: str = ""  # optional: skip API account lookup
    acme_email: str = ""
    docker_network: str = "backend"
    tunnel_token_secret: str = ""  # default tunnel token secret (used if host not in tunnel_tokens)
    tunnel_tokens: dict[str, str] = {}  # host -> SecretStore key for per-host tunnel tokens


def _rules_path(repo_path: str) -> Path:
    return Path(repo_path) / "ingress" / "rules.yml"


def _settings_path(repo_path: str) -> Path:
    return Path(repo_path) / "ingress" / "settings.yml"


def get_settings(repo_path: str) -> IngressSettings:
    data = yaml_service.read_yaml(_settings_path(repo_path))
    return IngressSettings(**data) if data else IngressSettings()


def save_settings(repo_path: str, settings: IngressSettings) -> None:
    yaml_service.write_yaml(_settings_path(repo_path), settings.model_dump())


def get_manual_rules(repo_path: str) -> list[ManualRule]:
    data = yaml_service.read_yaml(_rules_path(repo_path))
    return [ManualRule(**r) for r in data.get("manual_rules", [])]


def save_manual_rules(repo_path: str, rules: list[ManualRule]) -> None:
    yaml_service.write_yaml(
        _rules_path(repo_path),
        {"manual_rules": [r.model_dump() for r in rules]},
    )
