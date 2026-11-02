"""Central configuration for the ReConnect AI backend.

All secrets come from environment variables (optionally via backend/.env).
Nothing here is ever sent to the frontend.
"""

import os
from pathlib import Path

try:
    from dotenv import load_dotenv

    # Absolute path: backend/.env loads no matter which directory the
    # server is started from (repo root vs backend/). A bare load_dotenv()
    # only searches the current working directory upward, so starting from
    # the repo root silently skipped the key and forced demo mode.
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:  # pragma: no cover - dotenv is optional
    pass


def _get_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _get_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


# Meta Model API (OpenAI-compatible). Docs: Meta Developer Console.
META_MODEL_API_BASE = os.environ.get(
    "META_MODEL_API_BASE", "https://api.meta.ai/v1"
).rstrip("/")
META_MODEL_API_KEY = os.environ.get("META_MODEL_API_KEY", "").strip()
META_MODEL_TEXT = os.environ.get("META_MODEL_TEXT", "muse-spark-1.3")
META_MODEL_VISION = os.environ.get("META_MODEL_VISION", "muse-spark-1.3")
META_MODEL_TIMEOUT = _get_float("META_MODEL_TIMEOUT", 30.0)

# Photo upload guardrails.
DETECTIVE_MAX_PHOTO_BYTES = _get_int("DETECTIVE_MAX_PHOTO_BYTES", 8 * 1024 * 1024)
DETECTIVE_ALLOWED_PHOTO_TYPES = frozenset(
    {"image/jpeg", "image/png", "image/webp", "image/gif"}
)

# ReConnect Shield: Supabase Auth (JWT) when configured, else explicit demo.
# Current asymmetric signing keys are verified via JWKS derived from
# SUPABASE_URL; SUPABASE_JWT_SECRET is the legacy HS256 fallback.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_JWKS_URL = os.environ.get("SUPABASE_JWKS_URL", "").strip()
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")
SUPABASE_JWT_ISSUER = os.environ.get("SUPABASE_JWT_ISSUER", "").strip()
SUPABASE_JWT_AUDIENCE = os.environ.get("SUPABASE_JWT_AUDIENCE", "").strip()
SHIELD_DEMO_MODE = os.environ.get("SHIELD_DEMO_MODE", "false").lower() == "true"
SHIELD_ADMIN_IDS = frozenset(
    part.strip()
    for part in os.environ.get("SHIELD_ADMIN_IDS", "").split(",")
    if part.strip()
)

# Shield rate limits (sliding windows).
SHIELD_REQUESTS_PER_DAY = _get_int("SHIELD_REQUESTS_PER_DAY", 10)
SHIELD_MESSAGES_PER_HOUR = _get_int("SHIELD_MESSAGES_PER_HOUR", 30)
SHIELD_REPORTS_PER_DAY = _get_int("SHIELD_REPORTS_PER_DAY", 5)
SHIELD_PHOTOS_PER_DAY = _get_int("SHIELD_PHOTOS_PER_DAY", 20)
SHIELD_DISCOVER_PER_HOUR = _get_int("SHIELD_DISCOVER_PER_HOUR", 60)
SHIELD_SCAMCHECK_PER_HOUR = _get_int("SHIELD_SCAMCHECK_PER_HOUR", 60)

# CORS origins (comma-separated).
CORS_ORIGINS = [
    part.strip()
    for part in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")
    if part.strip()
]


def shield_auth_mode() -> str:
    """'supabase' when JWT verification is possible, else 'demo'/'off'."""
    if (
        os.environ.get("SUPABASE_URL", "").strip()
        or os.environ.get("SUPABASE_JWKS_URL", "").strip()
        or os.environ.get("SUPABASE_JWT_SECRET", "")
    ):
        return "supabase"
    if os.environ.get("SHIELD_DEMO_MODE", "false").lower() == "true":
        return "demo"
    return "off"


def shield_admin_ids() -> frozenset:
    live = os.environ.get("SHIELD_ADMIN_IDS")
    if live is not None:
        return frozenset(p.strip() for p in live.split(",") if p.strip())
    return SHIELD_ADMIN_IDS


def ai_configured() -> bool:
    """True only when a real API key is present. No key => demo/unconfigured.

    Reads the live environment so key changes never need a restart.
    """
    return bool(os.environ.get("META_MODEL_API_KEY", "").strip())
