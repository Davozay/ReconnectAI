"""AI configuration tests: key loading, status flag, and error mapping.

Regression coverage for the missing-key bug: backend/.env must load no
matter which directory the server starts from, since the frontend reports
the AI service as unavailable whenever /status reports configured=false.
No live network.
"""

import os
import subprocess
import sys
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

import main
from app.schemas.detective import PHOTO_JSON_SCHEMA
from app.services import meta_client
from app.services.meta_client import (
    AIAuthError,
    AIBadResponseError,
    AIConnectionError,
    AINotFoundError,
    AIRateLimitError,
    AIUnsupportedModelError,
)

client = TestClient(main.app)

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent


def _stub_error(name, status_code=None, message="stub"):
    cls = type(name, (Exception,), {})
    exc = cls(message)
    if status_code is not None:
        exc.status_code = status_code
    return exc


class StatusConfigTests(unittest.TestCase):
    def test_status_reports_configured_with_key(self):
        with patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}):
            response = client.get("/api/detective/status")
        body = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(body["configured"])
        self.assertEqual(body["mode"], "live")
        self.assertIn("muse-spark", body["vision_model"])
        self.assertNotIn("sk-test", response.text)

    def test_env_file_loads_from_repo_root_working_directory(self):
        """Starting the server from the repo root must still pick up
        backend/.env (bare load_dotenv() missed it -> reported unconfigured)."""
        env_path = BACKEND_DIR / ".env"
        sentinel = f"RECONNECT_CWD_TEST_{uuid.uuid4().hex[:8]}"
        original = env_path.read_text()
        try:
            with env_path.open("a") as handle:
                handle.write(f"\n{sentinel}=loaded-from-backend-env\n")
            child_env = {
                k: v for k, v in os.environ.items()
                if k != sentinel and k != "META_MODEL_API_KEY"
            }
            proc = subprocess.run(
                [
                    sys.executable, "-c",
                    "import os, sys; sys.path.insert(0, 'backend');"
                    "import app.config;"
                    f"print(os.environ.get('{sentinel}', 'MISSING'))",
                ],
                cwd=REPO_ROOT,
                env=child_env,
                capture_output=True,
                text=True,
                timeout=60,
            )
        finally:
            env_path.write_text(original)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(proc.stdout.strip(), "loaded-from-backend-env")


class EnvWhitespaceTests(unittest.TestCase):
    def test_base_url_whitespace_is_stripped(self):
        """Pasted env values with stray spaces must not corrupt the SDK URL
        (a trailing space produced '.../v1%20/' -> Meta 404 -> 502)."""
        with patch.dict(os.environ, {
            "META_MODEL_API_KEY": "sk-test",
            "META_MODEL_API_BASE": "  https://api.meta.ai/v1/ \n",
        }):
            built = meta_client._client()
        self.assertEqual(str(built.base_url).rstrip("/"), "https://api.meta.ai/v1")

    def test_model_names_are_stripped(self):
        with patch.dict(os.environ, {
            "META_MODEL_TEXT": " muse-spark-1.3 ",
            "META_MODEL_VISION": "muse-spark-1.3\n",
        }):
            self.assertEqual(meta_client._text_model(), "muse-spark-1.3")
            self.assertEqual(meta_client._vision_model(), "muse-spark-1.3")


class ErrorMappingTests(unittest.TestCase):
    def test_invalid_key_returns_credentials_error(self):
        with (
            patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-bad"}),
            patch(
                "app.routes.detective.complete_json",
                side_effect=AIAuthError(),
            ),
        ):
            response = client.post(
                "/api/detective/analyze", json={"memory": "Maplewood"}
            )
        self.assertEqual(response.status_code, 502)
        self.assertIn("credentials", response.json()["detail"].lower())

    def test_network_failure_returns_connection_error(self):
        with (
            patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}),
            patch(
                "app.routes.detective.complete_json",
                side_effect=AIConnectionError(),
            ),
        ):
            response = client.post(
                "/api/detective/analyze", json={"memory": "Maplewood"}
            )
        self.assertEqual(response.status_code, 502)
        self.assertIn("Could not reach", response.json()["detail"])

    def test_rate_limit_returns_retry_error(self):
        with (
            patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}),
            patch(
                "app.routes.detective.complete_json",
                side_effect=AIRateLimitError(),
            ),
        ):
            response = client.post(
                "/api/detective/analyze", json={"memory": "Maplewood"}
            )
        self.assertEqual(response.status_code, 502)
        self.assertIn("rate limiting", response.json()["detail"].lower())

    def test_unsupported_vision_model_guides_to_manual_entry(self):
        png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x04"
            b"\x00\x00\x00\x03\x08\x02\x00\x00\x00\x00\x00\x00\x00"
        )
        with (
            patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}),
            patch(
                "app.routes.detective.analyze_image_json",
                side_effect=AIUnsupportedModelError("text-only-model"),
            ),
        ):
            response = client.post(
                "/api/detective/analyze-photo",
                files={"photo": ("class.png", png, "image/png")},
            )
        self.assertEqual(response.status_code, 502)
        detail = response.json()["detail"]
        self.assertIn("text-only-model", detail)
        self.assertIn("manually", detail.lower())

    def test_sdk_auth_exception_maps_to_credentials_error(self):
        mapped = meta_client._raise_for_sdk(_stub_error("AuthenticationError", 401))
        self.assertIsInstance(mapped, AIAuthError)

    def test_sdk_connection_exception_maps_to_connection_error(self):
        mapped = meta_client._raise_for_sdk(_stub_error("APIConnectionError"))
        self.assertIsInstance(mapped, AIConnectionError)

    def test_sdk_timeout_maps_to_timeout_error(self):
        mapped = meta_client._raise_for_sdk(_stub_error("APITimeoutError"))
        self.assertIsInstance(mapped, meta_client.AITimeoutError)

    def test_sdk_not_found_maps_to_endpoint_error(self):
        mapped = meta_client._raise_for_sdk(_stub_error("NotFoundError", 404))
        self.assertIsInstance(mapped, AINotFoundError)
        self.assertIn("META_MODEL_API_BASE", mapped.message)

    def test_analyze_photo_not_found_names_server_config(self):
        png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x04"
            b"\x00\x00\x00\x03\x08\x02\x00\x00\x00\x00\x00\x00\x00"
        )
        with (
            patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}),
            patch(
                "app.routes.detective.analyze_image_json",
                side_effect=AINotFoundError(),
            ),
        ):
            response = client.post(
                "/api/detective/analyze-photo",
                files={"photo": ("class.png", png, "image/png")},
            )
        self.assertEqual(response.status_code, 502)
        detail = response.json()["detail"]
        self.assertIn("META_MODEL_API_BASE", detail)
        self.assertNotIn("Retry shortly", detail)

    def test_blind_model_400_maps_to_unsupported_model_error(self):
        exc = _stub_error(
            "BadRequestError", 400,
            "This model does not support image input",
        )
        mapped = meta_client._raise_unsupported_or_sdk(exc, "text-only-model")
        self.assertIsInstance(mapped, AIUnsupportedModelError)
        self.assertIn("text-only-model", mapped.message)

    def test_unrelated_400_stays_generic(self):
        exc = _stub_error("BadRequestError", 400, "max_tokens too large")
        mapped = meta_client._raise_unsupported_or_sdk(exc, "muse-spark-1.3")
        self.assertNotIsInstance(mapped, AIUnsupportedModelError)


class VisionOutputValidationTests(unittest.TestCase):
    def _canned_vision_response(self, content):
        response = MagicMock()
        response.choices = [MagicMock(message=MagicMock(content=content))]
        return response

    def _analyze_with_content(self, content):
        """Run analyze_image_json against canned SDK content.

        Returns (result_or_None, create_mock); None means
        AIBadResponseError was raised (any other error propagates).
        """
        with patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}):
            with patch(
                "app.services.meta_client.openai.OpenAI"
            ) as mock_openai:
                create = mock_openai.return_value.chat.completions.create
                create.return_value = self._canned_vision_response(content)
                try:
                    result = meta_client.analyze_image_json(
                        b"img", "image/jpeg", "sys", "notes",
                        PHOTO_JSON_SCHEMA,
                    )
                except AIBadResponseError:
                    result = None
                return result, create

    def test_malformed_vision_output_is_rejected(self):
        for content in (
            "", "   ", "definitely not json", "[1, 2, 3]", '"str"',
        ):
            with self.subTest(content=content):
                result, create = self._analyze_with_content(content)
                self.assertIsNone(result)
                create.assert_called_once()

    def test_vision_schema_mismatch_rejected_at_route(self):
        """Model JSON that fails MemoryExtraction validation is a 502,
        never silently accepted as clues."""
        png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x04"
            b"\x00\x00\x00\x03\x08\x02\x00\x00\x00\x00\x00\x00\x00"
        )
        with (
            patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}),
            patch(
                "app.routes.detective.analyze_image_json",
                return_value={
                    "schools": [{
                        "value": "Maplewood", "kind": "bogus-kind",
                        "origin": "stated", "confidence": "high",
                    }],
                },
            ),
        ):
            response = client.post(
                "/api/detective/analyze-photo",
                files={"photo": ("pic.png", png, "image/png")},
            )
        self.assertEqual(response.status_code, 502)
        self.assertIn("unreadable", response.json()["Detail"].lower())

    def test_fallback_instruction_carries_schema_shape(self):
        with patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}):
            with patch(
                "app.services.meta_client.openai.OpenAI"
            ) as mock_openai:
                create = mock_openai.return_value.chat.completions.create
                create.side_effect = [
                    _stub_error(
                        "BadRequestError", 400,
                        "Invalid response_format for this model",
                    ),
                    self._canned_vision_response('{"summary": "ok"}'),
                ]
                out = meta_client.analyze_image_json(
                    b"img", "image/jpeg", "sys", "notes", PHOTO_JSON_SCHEMA
                )
        self.assertEqual(out, {"summary": "ok"})
        retry_system = create.call_args_list[1].kwargs["messages"][0]["content"]
        self.assertTrue(retry_system.startswith("sys"))
        self.assertIn("JSON only", retry_system)
        self.assertIn("visible_description", retry_system)

    def test_failure_log_includes_request_id(self):
        exc = _stub_error("BadRequestError", 400, "bad request")
        exc.response = SimpleNamespace(headers={"x-request-id": "req-abc-123"})
        with patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}):
            with self.assertLogs("reconnect.meta_api", level="WARNING") as logs:
                meta_client._raise_for_sdk(exc, model="muse-spark-1.3")
        self.assertIn("req-abc-123", "\n".join(logs.output))


if __name__ == "__main__":
    unittest.main()
