from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # Environment
    ENV: str = "development"
    DEBUG: bool = True

    # API
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8080

    # CORS - allow Supabase Edge Functions
    ALLOWED_ORIGINS: List[str] = ["*"]  # Restrict in production

    # Rate Limiting (optional, Edge Function already rate limits)
    RATE_LIMIT_ENABLED: bool = False

    # File Upload
    MAX_FILE_SIZE_MB: int = 10

    class Config:
        env_file = ".env"


settings = Settings()
