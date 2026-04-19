from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "Rootstock"
    homelab_repo_path: str = "/homelab"
    homelab_remote_url: str = ""
    log_level: str = "info"
    # Empty by default — in production, CORS is not needed (nginx serves frontend
    # from the same origin). Set CORS_ORIGINS=http://localhost:5173 for local dev.
    cors_origins: list[str] = []
    rootstock_secret_key: str = ""  # Fernet key for encrypting secrets


settings = Settings()
