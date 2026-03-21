from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "Rootstock"
    homelab_repo_path: str = "/homelab"
    homelab_remote_url: str = ""
    log_level: str = "info"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]
    rootstock_secret_key: str = ""  # Fernet key for encrypting secrets


settings = Settings()
