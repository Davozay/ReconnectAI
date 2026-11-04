"""Reusable client for the Meta Model API (OpenAI-compatible).

Endpoint, auth, and models (per Meta's developer documentation):
- Base URL: https://api.meta.ai/v1 (override with META_MODEL_API_BASE)
- Auth: Bearer API key from the Model API dashboard (META_MODEL_API_KEY)
- Models: muse-spark-1.3 (default), muse-spark-1.2, muse-spark-1.1
- Text: OpenAI chat-completions shape with ``response_format: json_schema``
- Vision: OpenAI-style ``image_url`` content parts (data URLs)

Privacy boundary (non-negotiable): prompts instruct the model to read text,
scenes, and user-supplied stories only. The API is never asked to identify a
person from facial characteristics, and no face templates are created or
stored anywhere in this backend.
"""

import base64
import json
import logging
import os
import re
from typing import Any

import openai

from app import config

log = logging.getLogger("reconnect.meta_api")

NO_FACE_IDENTITY = (
    "Strict privacy rule: never identify, name, or describe a real person from "
    "facial characteristics, and never guess who someone in a photo is. Only use "
    "visible text, scenes, objects, and details the user typed themselves."
)


class AIError(Exception):
    """Base class for AI service failures surfaced to API clients."""

    status_code = 502

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class AINotConfigured(AIError):
    status_code = 503

    def __init__(self) -> None:
        super().__init__(
            "AI service is not configured. Set META_MODEL_API_KEY on the "
            "server to enable live analysis."
        )


class AIAuthError(AIError):
    def __init__(self) -> None:
        super().__init__(
            "AI service rejected the server credentials. Check META_MODEL_API_KEY."
        )


class AIRateLimitError(AIError):
    def __init__(self) -> None:
        super().__init__(
            "AI service is rate limiting requests. Please wait and retry."
        )


class AITimeoutError(AIError):
    def __init__(self, seconds: float) -> None:
        super().__init__(
            f"AI service did not respond within {seconds:g} seconds. Retry shortly."
        )


class AIConnectionError(AIError):
    def __init__(self) -> None:
        super().__init__(
            "Could not reach the AI service. Check network access and "
            "META_MODEL_API_BASE, then retry."
        )


class AINotFoundError(AIError):
    def __init__(self) -> None:
        super().__init__(
            "AI service could not find the configured model or endpoint. "
            "Check META_MODEL_API_BASE and the META_MODEL_TEXT / "
            "META_MODEL_VISION names on the server."
        )


class AIBadResponseError(AIError):
    def __init__(self) -> None:
        super().__init__(
            "AI service returned an unreadable response. Retry shortly."
        )


class AIUnsupportedModelError(AIError):
    def __init__(self, model: str) -> None:
        super().__init__(
            f"The configured vision model ({model}) does not accept image "
            "input. Set META_MODEL_VISION to a vision-capable model, or "
            "describe the photo manually in the memory field instead."
        )


def _client() -> openai.OpenAI:
    """Build a client from the current environment (reads env on each call so
    tests and key rotations never need a server restart to take effect)."""
    key = os.environ.get("META_MODEL_API_KEY", "").strip()
    if not key:
        raise AINotConfigured()
    base = os.environ.get("META_MODEL_API_BASE", config.META_MODEL_API_BASE).strip().rstrip("/")
    try:
        timeout = float(os.environ.get("META_MODEL_TIMEOUT", config.META_MODEL_TIMEOUT))
    except (TypeError, ValueError):
        timeout = config.META_MODEL_TIMEOUT
    return openai.OpenAI(base_url=base, api_key=key, timeout=timeout)


def _text_model() -> str:
    return os.environ.get("META_MODEL_TEXT", config.META_MODEL_TEXT).strip()


def _vision_model() -> str:
    return os.environ.get("META_MODEL_VISION", config.META_MODEL_VISION).strip()


def _timeout_seconds() -> float:
    try:
        return float(os.environ.get("META_MODEL_TIMEOUT", config.META_MODEL_TIMEOUT))
    except (TypeError, ValueError):
        return config.META_MODEL_TIMEOUT


#: Upstream route every call in this module uses (OpenAI-compatible
#: chat completions). Logged on failures so deploy issues can be told
#: apart from request issues.
UPSTREAM_ROUTE = "POST /chat/completions"


def _base_host() -> str:
    base = os.environ.get("META_MODEL_API_BASE", config.META_MODEL_API_BASE)
    base = (base or "").strip().rstrip("/")
    if "://" in base:
        base = base.split("://", 1)[1]
    return base.split("/", 1)[0] if base else "?"


def _upstream_request_id(exc: Exception) -> str:
    """Vendor request ID from response headers (best effort, for tracing
    a failure with the provider). Anything non-string is ignored."""
    response = getattr(exc, "response", None)
    getter = getattr(getattr(response, "headers", None), "get", None)
    if not callable(getter):
        return ""
    try:
        found = getter("x-request-id") or getter("request-id")
    except Exception:
        return ""
    return found if isinstance(found, str) else ""


def _sanitized_upstream_detail(exc: Exception) -> str:
    """Short, safe upstream error snippet: status + vendor code/message.

    Only structured error metadata is kept. Data URLs, long base64 runs
    (image bytes), and the configured API key are redacted, and the
    snippet is truncated, so request/response bodies can never leak.
    """
    status = getattr(exc, "status_code", "?")
    code = ""
    message = ""
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        err = body.get("error", body)
        if isinstance(err, dict):
            code = str(err.get("code", err.get("type", "")) or "")
            message = str(err.get("message", "") or "")
        elif isinstance(err, str):
            message = err
    if not message:
        message = str(exc)
    message = re.sub(r"data:[^;\s]+;base64,[A-Za-z0-9+/=\s]+", "[image-data]", message)
    message = re.sub(r"[A-Za-z0-9+/]{120,}={0,2}", "[blob]", message)
    key = os.environ.get("META_MODEL_API_KEY", "").strip()
    if key and len(key) >= 4 and key in message:
        message = message.replace(key, "[redacted-key]")
    snippet = " ".join(message.split())[:300]
    request_id = _upstream_request_id(exc)
    parts = [f"status {status}"]
    if code:
        parts.append(f"code {' '.join(code.split())[:64]}")
    if request_id:
        parts.append(f"request {' '.join(request_id.split())[:64]}")
    if snippet:
        parts.append(f"detail: {snippet}")
    return " ".join(parts)


def _log_upstream_error(exc: Exception, *, model: str | None) -> None:
    """One sanitized log line per upstream failure: exception class, request
    route, model identifier, API host, and the vendor error snippet. Never
    includes API keys, prompts, or image data."""
    log.warning(
        "Meta Model API failure: %s | route %s | model %s | host %s | %s",
        type(exc).__name__,
        UPSTREAM_ROUTE,
        model or "?",
        _base_host(),
        _sanitized_upstream_detail(exc),
    )


def _raise_for_sdk(exc: Exception, *, model: str | None = None) -> AIError:
    if isinstance(exc, AIError):
        return exc
    name = type(exc).__name__
    _log_upstream_error(exc, model=model)
    if name in ("AuthenticationError", "PermissionDeniedError"):
        return AIAuthError()
    if name == "RateLimitError":
        return AIRateLimitError()
    if name == "NotFoundError":
        return AINotFoundError()
    if name in ("APITimeoutError", "Timeout"):
        return AITimeoutError(_timeout_seconds())
    if name in ("APIConnectionError", "ConnectionError"):
        return AIConnectionError()
    return AIError(f"AI service error ({name}). Retry shortly.")


#: Error vocabulary that means the vendor rejected the structured-output
#: wrapper (not the prompt or image). Triggers one plain-JSON retry.
_SCHEMA_REJECTION_HINTS = (
    "response_format",
    "response format",
    "json_schema",
    "json schema",
    "strict",
    "additionalproperties",
    "additional properties",
    "union type",
    "anyof",
    "oneof",
)


def _looks_like_schema_rejection(exc: Exception) -> bool:
    """True when the vendor rejected response_format rather than the content.

    Image/vision/modality errors are excluded: a model that cannot see must
    map to AIUnsupportedModelError immediately, not burn a retry.
    """
    message = str(exc).lower()
    if "image" in message or "vision" in message or "modality" in message:
        return False
    if not any(hint in message for hint in _SCHEMA_REJECTION_HINTS):
        return False
    status = getattr(exc, "status_code", None)
    if status is None:
        return "response_format" in message or "response format" in message
    return status in (400, 422)


def _json_schema_format(schema: dict[str, Any], default_name: str) -> dict[str, Any]:
    """Build response_format, keeping the registry 'name' out of the inner
    JSON Schema (unknown top-level keys can fail strict validation)."""
    inner = {key: value for key, value in schema.items() if key != "name"}
    return {
        "type": "json_schema",
        "json_schema": {
            "name": schema.get("name", default_name),
            "schema": inner,
            "strict": True,
        },
    }


def _plain_json_instruction(schema: dict[str, Any]) -> str:
    """Plain-JSON fallback instruction naming the expected schema shape.

    Appended to (never replacing) the system prompt, so privacy rules and
    task instructions stay intact while the model sees which object shape
    will validate downstream.
    """
    shape = {key: value for key, value in schema.items() if key != "name"}
    compact = json.dumps(shape, separators=(",", ":"))
    return (
        " Reply with JSON only: a single valid JSON object matching "
        f"this schema: {compact}."
    )


def _extract_json(content: str) -> dict[str, Any]:
    """Parse model output, tolerating fenced ```json blocks."""
    text = content.strip()
    if text.startswith("```"):
        lines = text.splitlines()[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise AIBadResponseError() from exc
    if not isinstance(parsed, dict):
        raise AIBadResponseError()
    return parsed


def complete_text(
    system: str,
    user: str,
    *,
    model: str | None = None,
    # Muse Spark is a reasoning model: ~140 completion tokens can go to
    # hidden reasoning before the first visible token, so small budgets
    # return empty output with finish_reason=length. Verified live.
    max_tokens: int = 1000,
) -> str:
    """Minimal text completion (used by the connectivity probe)."""
    client = _client()
    resolved_model = model or _text_model()
    try:
        response = client.chat.completions.create(
            model=resolved_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            max_tokens=max_tokens,
        )
    except Exception as exc:  # noqa: BLE001 - mapped below
        raise _raise_for_sdk(exc, model=resolved_model) from exc
    content = (response.choices[0].message.content or "").strip()
    if not content:
        raise AIBadResponseError()
    return content


def complete_json(
    system: str,
    user: str,
    schema: dict[str, Any],
    *,
    model: str | None = None,
    max_tokens: int = 4000,
) -> dict[str, Any]:
    """Structured JSON completion, preferring strict json_schema output."""
    client = _client()
    resolved_model = model or _text_model()
    payload = {
        "model": resolved_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens,
        "response_format": _json_schema_format(schema, "extraction"),
    }
    try:
        response = client.chat.completions.create(**payload)
    except Exception as exc:  # noqa: BLE001 - mapped below
        # Older deployments may reject json_schema; retry as plain JSON once.
        if _looks_like_schema_rejection(exc):
            log.info(
                "json_schema rejected; retrying as plain JSON (model %s)",
                resolved_model,
            )
            plain = dict(payload)
            plain.pop("response_format")
            plain["messages"] = [
                {
                    "role": "system",
                    "content": system + _plain_json_instruction(schema),
                },
                {"role": "user", "content": user},
            ]
            try:
                response = client.chat.completions.create(**plain)
            except Exception as retry_exc:  # noqa: BLE001
                raise _raise_for_sdk(retry_exc, model=resolved_model) from retry_exc
        else:
            raise _raise_for_sdk(exc, model=resolved_model) from exc
    content = (response.choices[0].message.content or "").strip()
    if not content:
        raise AIBadResponseError()
    return _extract_json(content)


def analyze_image_json(
    image_bytes: bytes,
    content_type: str,
    system: str,
    user: str,
    schema: dict[str, Any],
    *,
    model: str | None = None,
    max_tokens: int = 6000,
) -> dict[str, Any]:
    """Vision analysis: photo (data URL) + prompt -> structured JSON.

    First attempts strict ``json_schema`` output; when the vendor rejects
    the structured-output wrapper itself (not the image), retries once as
    plain JSON with the identical image part. The image is always sent as
    an OpenAI-compatible ``image_url`` base64 data URL to
    ``POST /chat/completions`` — no tools, no other modalities.
    """
    client = _client()
    resolved_model = model or _vision_model()
    data_url = (
        f"data:{content_type};base64,"
        + base64.b64encode(image_bytes).decode("ascii")
    )
    image_part = {"type": "image_url", "image_url": {"url": data_url}}
    payload: dict[str, Any] = {
        "model": resolved_model,
        "messages": [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user},
                    image_part,
                ],
            },
        ],
        "max_tokens": max_tokens,
        "response_format": _json_schema_format(schema, "photo_extraction"),
    }
    try:
        response = client.chat.completions.create(**payload)
    except Exception as exc:  # noqa: BLE001 - mapped below
        if _looks_like_schema_rejection(exc):
            log.info(
                "vision json_schema rejected; retrying as plain JSON (model %s)",
                resolved_model,
            )
            plain = dict(payload)
            plain.pop("response_format")
            plain["messages"] = [
                {
                    "role": "system",
                    "content": system + _plain_json_instruction(schema),
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user},
                        image_part,
                    ],
                },
            ]
            try:
                response = client.chat.completions.create(**plain)
            except Exception as retry_exc:  # noqa: BLE001
                raise _raise_unsupported_or_sdk(
                    retry_exc, resolved_model
                ) from retry_exc
        else:
            raise _raise_unsupported_or_sdk(exc, resolved_model) from exc
    content = (response.choices[0].message.content or "").strip()
    if not content:
        raise AIBadResponseError()
    return _extract_json(content)


def _raise_unsupported_or_sdk(exc: Exception, model: str) -> AIError:
    """Detect vision-incapable models so callers can guide the user to
    manual entry instead of asking a blind model to describe a photo."""
    message = str(exc).lower()
    status = getattr(exc, "status_code", None)
    mentions_images = "image" in message or "vision" in message or "modality" in message
    mentions_unsupported = (
        "not support" in message
        or "unsupported" in message
        or "incapable" in message
        or "invalid type" in message
    )
    if status == 400 and mentions_images and mentions_unsupported:
        _log_upstream_error(exc, model=model)
        return AIUnsupportedModelError(model)
    return _raise_for_sdk(exc, model=model)
