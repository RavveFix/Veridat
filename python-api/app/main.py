"""
Britta VAT API - FastAPI application entry point.
"""
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

# Create FastAPI app
app = FastAPI(
    title="Britta VAT API",
    description="Swedish VAT calculation service for Britta",
    version="1.0.0",
    debug=settings.DEBUG
)

# CORS middleware - critical for Supabase Edge Functions
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["authorization", "content-type", "x-user-id"],
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
