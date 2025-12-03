from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # Environment
    ENV: str = "development"
    DEBUG: bool = False

    # API
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8080

    # CORS - allow Supabase Edge Functions
    ALLOWED_ORIGINS: str = "http://localhost:5173"

    # Rate Limiting (optional, Edge Function already rate limits)
    RATE_LIMIT_ENABLED: bool = False

    # File Upload
    MAX_FILE_SIZE_MB: int = 10

    @property
    def allowed_origins_list(self) -> List[str]:
        """Parse comma-separated ALLOWED_ORIGINS string into list."""
        # Handle empty or whitespace-only strings
        if not self.ALLOWED_ORIGINS or not self.ALLOWED_ORIGINS.strip():
            return ["http://localhost:5173"]  # Fallback to default

        if self.ALLOWED_ORIGINS == "*":
            return ["*"]

        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]

    def validate_production_config(self) -> None:
        """Validate configuration is safe for production environment."""
        if self.ENV != "production":
            return  # Only validate in production

        # Check DEBUG mode
        if self.DEBUG:
            raise ValueError(
                "SECURITY ERROR: DEBUG=true is not allowed in production! "
                "Set DEBUG=false in environment variables."
            )

        # Check CORS configuration
        if self.ALLOWED_ORIGINS == "*":
            raise ValueError(
                "SECURITY ERROR: CORS allows all origins (*) in production! "
                "Set ALLOWED_ORIGINS to specific domains (comma-separated)."
            )

        # Check for localhost in production
        if any("localhost" in origin or "127.0.0.1" in origin
               for origin in self.allowed_origins_list):
            raise ValueError(
                "SECURITY ERROR: localhost origins not allowed in production! "
                "Set ALLOWED_ORIGINS to production domains only."
            )

    class Config:
        env_file = ".env"
        extra = "ignore"  # Ignore extra environment variables


settings = Settings()
