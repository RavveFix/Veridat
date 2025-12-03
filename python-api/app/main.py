"""
Britta VAT API - FastAPI application entry point.
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

from app.config import settings
from app.api.routes import vat, health

# Configure logging
logging.basicConfig(
    level=logging.INFO if not settings.DEBUG else logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - handles startup and shutdown events."""
    # Startup
    try:
        settings.validate_production_config()
        logger.info(f"✅ Environment validated: ENV={settings.ENV}, DEBUG={settings.DEBUG}")
        logger.info(f"✅ Allowed origins: {settings.allowed_origins_list}")
    except ValueError as e:
        logger.error(f"❌ Configuration validation failed: {e}")
        raise

    yield

    # Shutdown (cleanup if needed)
    logger.info("🛑 Shutting down Britta VAT API")


# Create FastAPI app
app = FastAPI(
    title="Britta VAT API",
    description="Swedish VAT calculation service for Britta",
    version="1.0.0",
    debug=settings.DEBUG,
    lifespan=lifespan
)

# CORS middleware - critical for Supabase Edge Functions
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["authorization", "content-type", "x-user-id", "x-api-key"],
)

# Register routes
app.include_router(health.router, prefix="/health", tags=["health"])
app.include_router(vat.router, prefix="/api/v1/vat", tags=["vat"])


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "service": "Britta VAT API",
        "version": "1.0.0",
        "status": "operational",
        "endpoints": {
            "health": "/health",
            "vat_analyze": "/api/v1/vat/analyze"
        }
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=settings.API_HOST,
        port=settings.API_PORT,
        log_level="info"
    )
