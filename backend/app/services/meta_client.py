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
    base = os.environ.get("META_MODEL_API_BASE", config.META_MODEL_API_BASE).rstrip("/")
    try:
        timeout = float(os.environ.get("META_MODEL_TIMEOUT", config.META_MODEL_TIMEOUT))
    except (TypeError, ValueError):
        timeout = config.META_MODEL_TIMEOUT
    return openai.OpenAI(base_url=base, api_key=key, timeout=timeout)


def _text_model() -> str:
    return os.environ.get("META_MODEL_TEXT", config.META_MODEL_TEXT)


def _vision_model() -> str:
    return os.environ.get("META_MODEL_VISION", config.META_MODEL_VISION)


def _timeout_seconds() -> float:
    try:
        return float(os.environ.get("META_MODEL_TIMEOUT", config.META_MODEL_TIMEOUT))
    except (TypeError, ValueError):
        return config.META_MODEL_TIMEOUT


def _raise_for_sdk(exc: Exception) -> AIError:
    if isinstance(exc, AIError):
        return exc
    name = type(exc).__name__
    if name in ("AuthenticationError", "PermissionDeniedError"):
        return AIAuthError()
    if name == "RateLimitError":
        return AIRateLimitError()
    if name in ("APITimeoutError", "Timeout"):
        return AITimeoutError(_timeout_seconds())
    if name in ("APIConnectionError", "ConnectionError"):
        return AIConnectionError()
    # Log the failure class only: exception text can carry user content,
    # and image bytes / API keys must never reach the logs.
    log.warning(
        "Meta Model API failure: %s (status %s)",
        name,
        getattr(exc, "status_code", "?"),
    )
    return AIError(f"AI service error ({name}). Retry shortly.")


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
    try:
        response = client.chat.completions.create(
            model=model or _text_model(),
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            max_tokens=max_tokens,
        )
    except Exception as exc:  # noqa: BLE001 - mapped below
        raise _raise_for_sdk(exc) from exc
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
    name = schema.get("name", "extraction")
    payload = {
        "model": model or _text_model(),
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens,
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": name, "schema": schema, "strict": True},
        },
    }
    try:
        response = client.chat.completions.create(**payload)
    except Exception as exc:  # noqa: BLE001 - mapped below
        # Older deployments may reject json_schema; retry as plain JSON once.
        if "response_format" in str(exc).lower() or "response format" in str(exc).lower():
            log.info("json_schema rejected; retrying as plain JSON")
            plain = dict(payload)
            plain.pop("response_format")
            plain["messages"] = [
                {"role": "system", "content": system + " Reply with JSON only."},
                {"role": "user", "content": user},
            ]
            try:
                response = client.chat.completions.create(**plain)
            except Exception as retry_exc:  # noqa: BLE001
                raise _raise_for_sdk(retry_exc) from retry_exc
        else:
            raise _raise_for_sdk(exc) from exc
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
    """Vision analysis: photo (data URL) + prompt -> structured JSON."""
    client = _client()
    data_url = (
        f"data:{content_type};base64,"
        + base64.b64encode(image_bytes).decode("ascii")
    )
    try:
        response = client.chat.completions.create(
            model=model or _vision_model(),
            messages=[
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                },
            ],
            max_tokens=max_tokens,
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": schema.get("name", "photo_extraction"),
                    "schema": schema,
                    "strict": True,
                },
            },
        )
    except Exception as exc:  # noqa: BLE001 - mapped below
        raise _raise_unsupported_or_sdk(exc, model or _vision_model()) from exc
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
        return AIUnsupportedModelError(model)
    return _raise_for_sdk(exc)
