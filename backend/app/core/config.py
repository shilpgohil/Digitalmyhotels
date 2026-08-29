from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "DigitalMyHotels"
    app_env: Literal["development", "staging", "production", "test"] = "development"
    debug: bool = False
    # SQL statement logging is expensive — opt in explicitly, never via DEBUG.
    sql_echo: bool = False
    api_v1_prefix: str = "/api/v1"

    database_url: str = Field(
        default="postgresql+asyncpg://dmh:dmh_dev_password@127.0.0.1:5434/digitalmyhotels"
    )

    secret_key: str = Field(default="dev-secret-change-me")
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 14
    refresh_cookie_name: str = "dmh_refresh"
    refresh_cookie_secure: bool = False
    refresh_cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    refresh_cookie_domain: str | None = None

    upi_encryption_key: str = Field(default="dev-fernet-key-replace-with-real-fernet-key==")

    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    storage_backend: Literal["local", "r2", "b2"] = "local"
    local_storage_path: str = ".local-storage"
    # Cloudflare R2
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_name: str = "digitalmyhotels"
    r2_public_base_url: str = ""
    # Backblaze B2 (S3-compatible)
    b2_endpoint: str = ""          # e.g. https://s3.sg-sin-001.backblazeb2.com
    b2_key_id: str = ""            # Application Key ID
    b2_application_key: str = ""   # Application Key
    b2_bucket_name: str = "digitalmyhotels"
    b2_public_base_url: str = ""   # e.g. https://s3.sg-sin-001.backblazeb2.com/digitalmyhotels
    b2_region: str = "sg-sin-001"  # B2 region string

    email_backend: Literal["stub", "console", "resend"] = "stub"
    email_from: str = "noreply@digitalmyhotels.local"
    resend_api_key: str = ""

    rate_limit_login_per_minute: int = 10

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors(cls, value: object) -> object:
        if isinstance(value, str):
            import json

            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return [part.strip() for part in value.split(",") if part.strip()]
        return value

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
