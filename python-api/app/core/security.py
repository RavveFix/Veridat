"""
Security utilities for API authentication.
"""
import os
import secrets
from fastapi import Security, HTTPException, status
from fastapi.security import APIKeyHeader

# API key header scheme
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def verify_api_key(api_key: str = Security(api_key_header)) -> str:
    """
    Verify API key from X-API-Key header.

    Fail-open design: If PYTHON_API_KEY is not set in environment,
    authentication is bypassed (for backward compatibility).

    Returns:
        The validated API key

    Raises:
        HTTPException: If API key is invalid or missing when required
    """
    expected_key = os.getenv("PYTHON_API_KEY")

    # If no API key configured, allow request (fail-open)
    if not expected_key:
        return "bypass"

    # API key configured but not provided in request
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing API key",
            headers={"WWW-Authenticate": "ApiKey"},
        )

    # Validate API key (constant-time comparison to prevent timing attacks)
    if not secrets.compare_digest(api_key, expected_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
            headers={"WWW-Authenticate": "ApiKey"},
        )

    return api_key
