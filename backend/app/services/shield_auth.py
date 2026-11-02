"""Shield identity: Supabase JWT verification (JWKS) or explicit demo mode.

Token verification supports both Supabase signing systems:

- Current asymmetric signing keys (ES256/RS256): verified against the
  project's JWKS document (``SUPABASE_JWKS_URL``, defaulting to
  ``<SUPABASE_URL>/auth/v1/.well-known/jwks.json``). Issuer, audience,
  expiration, and ``sub`` are always validated.
- Legacy HS256 shared secret (``SUPABASE_JWT_SECRET``): kept as a fallback
  for projects still on the legacy secret. Signature and expiration are
  always checked; issuer/audience are enforced whenever the expected
  values are known (``SUPABASE_URL`` / overrides configured).

When neither is configured, requests are rejected with 503 unless
``SHIELD_DEMO_MODE=true``, in which case a validated ``X-Demo-User``
header identifies the caller. Demo mode is loudly labeled and never the
default.

Frontend-supplied user IDs are never trusted outside explicit demo mode.
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import ssl
import time
import urllib.request
from typing import Annotated, Any

from fastapi import Depends, Header, HTTPException

from app import config

logger = logging.getLogger(__name__)

_DEMO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{3,64}$")

_JWKS_CACHE_TTL = 600.0
_jwks_cache: dict[str, tuple[float, dict[str, Any]]] = {}

# Asymmetric algorithms accepted on the JWKS path. HS256 is handled only by
# the legacy shared-secret path, never with a JWKS-derived key.
_JWKS_ALGS = frozenset(
    {"ES256", "ES384", "ES512", "RS256", "RS384", "RS512", "EdDSA"}
)


def _b64url_decode(segment: str) -> bytes:
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding)


def _b64url_json(segment: str) -> dict[str, Any]:
    decoded = json.loads(_b64url_decode(segment))
    if not isinstance(decoded, dict):
        raise ValueError("invalid JWT segment")
    return decoded


def _expected_issuer() -> str | None:
    override = os.environ.get("SUPABASE_JWT_ISSUER", "").strip()
    if override:
        return override
    base = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    if base:
        return f"{base}/auth/v1"
    return None


def _expected_audience() -> str | None:
    override = os.environ.get("SUPABASE_JWT_AUDIENCE", "").strip()
    if override:
        return override
    # Supabase access tokens use "authenticated" unless the project changed it.
    # Only enforce when we know the project (URL/issuer configured) so legacy
    # local setups without a project URL keep working.
    if _expected_issuer() is not None:
        return "authenticated"
    return None


def _check_claims(payload: dict[str, Any], *, strict_issuer: bool) -> str:
    """Validate exp/iss/aud/sub. Returns the subject (user id)."""
    exp = payload.get("exp")
    if not isinstance(exp, (int, float)) or exp < time.time():
        raise HTTPException(status_code=401, detail="Access token expired.")
    expected_iss = _expected_issuer()
    if strict_issuer or expected_iss is not None:
        if not expected_iss or payload.get("iss") != expected_iss:
            raise HTTPException(
                status_code=401, detail="Invalid token issuer."
            )
    expected_aud = _expected_audience()
    if expected_aud is not None:
        aud = payload.get("aud")
        auds = aud if isinstance(aud, list) else [aud]
        if expected_aud not in auds:
            raise HTTPException(
                status_code=401, detail="Invalid token audience."
            )
    subject = payload.get("sub")
    if not subject or not isinstance(subject, str):
        raise HTTPException(status_code=401, detail="Invalid access token.")
    return subject


def verify_supabase_jwt_legacy(token: str, secret: str) -> str:
    """Verify a legacy HS256 Supabase access token. Returns the subject."""
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
        header = _b64url_json(header_b64)
        if header.get("alg") != "HS256":
            raise ValueError("unexpected alg")
        expected = hmac.new(
            secret.encode(), f"{header_b64}.{payload_b64}".encode(), hashlib.sha256
        ).digest()
        if not hmac.compare_digest(expected, _b64url_decode(sig_b64)):
            raise ValueError("bad signature")
        payload = _b64url_json(payload_b64)
    except (ValueError, json.JSONDecodeError, KeyError) as exc:
        raise HTTPException(status_code=401, detail="Invalid access token.") from exc
    return _check_claims(payload, strict_issuer=False)


def verify_supabase_jwt(token: str, secret: str) -> str:
    """Verify an HS256 Supabase access token. Returns the subject (user id)."""
    return verify_supabase_jwt_legacy(token, secret)


def _jwks_url() -> str | None:
    override = os.environ.get("SUPABASE_JWKS_URL", "").strip()
    if override:
        return override
    base = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    if base:
        return f"{base}/auth/v1/.well-known/jwks.json"
    return None


def _fetch_jwks(url: str) -> dict[str, Any]:
    """Fetch and parse a JWKS document (patched out in unit tests)."""
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        # Bundled CA certificates: some Python installs (notably macOS
        # framework builds and their venvs) ship without a usable system
        # certificate store, which would fail closed with CERTIFICATE_VERIFY_FAILED.
        import certifi

        context: ssl.SSLContext | None = ssl.create_default_context(
            cafile=certifi.where()
        )
    except ImportError:
        context = None
    with urllib.request.urlopen(request, timeout=10, context=context) as response:  # nosec B310
        return json.load(response)


def _jwks_keys(url: str) -> dict[str, Any]:
    now = time.time()
    cached = _jwks_cache.get(url)
    if cached is not None and now - cached[0] < _JWKS_CACHE_TTL:
        return cached[1]
    try:
        document = _fetch_jwks(url)
        keys = document.get("keys", [])
        by_kid = {
            key["kid"]: key
            for key in keys
            if isinstance(key, dict) and key.get("kid")
        }
    except Exception as exc:
        logger.warning(
            "ReConnect Shield: JWKS fetch failed for %s: %s: %s",
            url,
            type(exc).__name__,
            exc,
        )
        raise HTTPException(
            status_code=503, detail="Could not load authentication keys."
        ) from exc
    if not by_kid:
        logger.warning(
            "ReConnect Shield: JWKS document at %s contained no usable keys.",
            url,
        )
        raise HTTPException(
            status_code=503, detail="Could not load authentication keys."
        )
    _jwks_cache[url] = (now, by_kid)
    return by_kid


def clear_jwks_cache() -> None:
    """Drop cached JWKS documents (tests and key rotation recovery)."""
    _jwks_cache.clear()


def verify_supabase_jwt_jwks(token: str) -> str:
    """Verify a token against the Supabase JWKS document. Returns subject."""
    try:
        import jwt
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail="Authentication service is missing its JWT library.",
        ) from exc
    url = _jwks_url()
    if not url:
        raise HTTPException(
            status_code=503,
            detail="Authentication service is not configured. Set SUPABASE_URL.",
        )
    try:
        header = _b64url_json(token.split(".")[0])
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=401, detail="Invalid access token.") from exc
    alg = header.get("alg")
    kid = header.get("kid")
    if (
        alg in ("none", None)
        or alg not in _JWKS_ALGS
        or not isinstance(kid, str)
        or not kid
    ):
        raise HTTPException(status_code=401, detail="Invalid access token.")
    keys = _jwks_keys(url)
    jwk = keys.get(kid)
    if jwk is None:
        # Possible key rotation: refresh once before giving up.
        _jwks_cache.pop(url, None)
        jwk = _jwks_keys(url).get(kid)
    if jwk is None:
        raise HTTPException(status_code=401, detail="Unknown signing key.")
    expected_iss = _expected_issuer()
    expected_aud = _expected_audience()
    if not expected_iss or not expected_aud:
        raise HTTPException(
            status_code=503,
            detail="Authentication service is not configured. Set SUPABASE_URL.",
        )
    from jwt.algorithms import ECAlgorithm, OKPAlgorithm, RSAAlgorithm

    kty = jwk.get("kty")
    try:
        if kty == "EC":
            key = ECAlgorithm.from_jwk(json.dumps(jwk))
        elif kty == "RSA":
            key = RSAAlgorithm.from_jwk(json.dumps(jwk))
        elif kty == "OKP":
            key = OKPAlgorithm.from_jwk(json.dumps(jwk))
        else:
            raise HTTPException(status_code=401, detail="Unknown signing key.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=401, detail="Unknown signing key."
        ) from exc
    try:
        payload = jwt.decode(
            token,
            key,
            algorithms=[alg],
            issuer=expected_iss,
            audience=expected_aud,
            options={"require": ["exp", "sub", "iss", "aud"]},
        )
    except Exception as exc:
        message = str(exc).lower()
        if "expired" in message:
            raise HTTPException(
                status_code=401, detail="Access token expired."
            ) from exc
        if "issuer" in message:
            raise HTTPException(
                status_code=401, detail="Invalid token issuer."
            ) from exc
        if "audience" in message:
            raise HTTPException(
                status_code=401, detail="Invalid token audience."
            ) from exc
        raise HTTPException(status_code=401, detail="Invalid access token.") from exc
    subject = payload.get("sub")
    if not subject or not isinstance(subject, str):
        raise HTTPException(status_code=401, detail="Invalid access token.")
    return subject


def verify_bearer_token(token: str) -> str:
    """Verify a Supabase access token via JWKS, with legacy HS256 fallback."""
    token = token.strip()
    alg: str | None = None
    try:
        alg = _b64url_json(token.split(".")[0]).get("alg")
    except (ValueError, json.JSONDecodeError):
        raise HTTPException(status_code=401, detail="Invalid access token.")
    legacy_secret = os.environ.get("SUPABASE_JWT_SECRET", "")
    if alg == "HS256" and legacy_secret:
        return verify_supabase_jwt_legacy(token, legacy_secret)
    if _jwks_url() is not None:
        return verify_supabase_jwt_jwks(token)
    if legacy_secret:
        # HS256-only project without a URL: let the legacy verifier explain.
        return verify_supabase_jwt_legacy(token, legacy_secret)
    raise HTTPException(
        status_code=503,
        detail=(
            "Authentication service is not configured. Set SUPABASE_URL "
            "(signing keys) or SUPABASE_JWT_SECRET (legacy secret)."
        ),
    )


async def current_user_id(
    authorization: str | None = Header(default=None),
    x_demo_user: str | None = Header(default=None),
) -> str:
    """FastAPI dependency: authenticated caller identity for Shield routes."""
    mode = config.shield_auth_mode()
    if mode == "supabase":
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(
                status_code=401, detail="Missing Bearer [REDACTED] token."
            )
        return verify_bearer_token(authorization[7:])
    if mode == "demo":
        if not x_demo_user or not _DEMO_ID_RE.match(x_demo_user):
            raise HTTPException(
                status_code=401,
                detail="Demo mode: send a valid X-Demo-User identity header.",
            )
        return f"demo:{x_demo_user}"
    raise HTTPException(
        status_code=503,
        detail=(
            "Authentication service is not configured. Set SUPABASE_URL or "
            "SUPABASE_JWT_SECRET, or enable SHIELD_DEMO_MODE on the server."
        ),
    )


async def admin_user_id(
    user_id: Annotated[str, Depends(current_user_id)],
) -> str:
    """Dependency guard for moderation endpoints (runs after identity)."""
    if user_id not in config.shield_admin_ids():
        raise HTTPException(status_code=403, detail="Administrator access required.")
    return user_id
