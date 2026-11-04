"""Regression tests for the Memory Detective photo-analysis request.

Pins the exact upstream request the working Meta Muse Spark 1.3 image
reference uses — POST /chat/completions, model muse-spark-1.3,
OpenAI-compatible image_url base64 data URL — plus the hardened error
handling around it: strict json_schema first with a plain-JSON retry,
blind-model detection without retries, and sanitized failure logging.
No live network.
"""

import base64
import json
import os
import struct
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

import main
from app.schemas.detective import (
    ANSWER_JSON_SCHEMA,
    EXTRACTION_JSON_SCHEMA,
    PHOTO_JSON_SCHEMA,
)
from app.services import meta_client
from app.services.meta_client import (
    AINotFoundError,
    AIUnsupportedModelError,
    analyze_image_json,
)

client = TestClient(main.app)


def _stub_error(name, status_code=None, message="stub", body=None):
    cls = type(name, (Exception,), {})
    exc = cls(message)
    if status_code is not None:
        exc.status_code = status_code
    if body is not None:
        exc.body = body
    return exc


def _canned_response(payload):
    response = MagicMock()
    response.choices = [
        MagicMock(message=MagicMock(content=json.dumps(payload)))
    ]
    return response


def _full_photo_payload():
    return {
        "visible_text": "MAPLEWOOD 1998",
        "visible_description": "Outdoor field, banner, trophy table.",
        "extracted_text": "MAPLEWOOD 1998",
        "possible_context": "school sports event",
        "uncertain_observations": ["Year confirmed by banner text."],
        "schools": [
            {
                "value": "Maplewood Elementary",
                "kind": "school",
                "origin": "stated",
                "confidence": "high",
            }
        ],
        "nicknames": [],
        "locations": [],
        "years": [
            {"value": "1998", "kind": "year", "origin": "stated",
             "confidence": "high"}
        ],
        "names_mentioned": [],
        "events": [],
        "summary": "Banner reads Maplewood 1998.",
    }


def _minimal_png(width=4, height=3):
    return (
        b"\x89PNG\r\n\x1a\n"
        + struct.pack(">I", 13)
        + b"IHDR"
        + struct.pack(">II", width, height)
        + bytes([8, 2, 0, 0, 0])
        + b"\x00\x00\x00\x00"
    )


class VisionRequestShapeTests(unittest.TestCase):
    def _create_kwargs(self, image=b"fake-image-bytes",
                       content_type="image/jpeg"):
        with patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}):
            with patch(
                "app.services.meta_client.openai.OpenAI"
            ) as mock_openai:
                mock_openai.return_value.chat.completions.create.return_value = (
                    _canned_response(_full_photo_payload())
                )
                analyze_image_json(
                    image, content_type, "sys", "user notes",
                    PHOTO_JSON_SCHEMA,
                )
        create = mock_openai.return_value.chat.completions.create
        create.assert_called_once()
        return create.call_args.kwargs

    def test_uses_configured_vision_model(self):
        kwargs = self._create_kwargs()
        self.assertEqual(kwargs["model"], "muse-spark-1.3")
        with patch.dict(os.environ, {
            "META_MODEL_API_KEY": "sk-test",
            "META_MODEL_VISION": " muse-spark-1.3 ",
        }):
            with patch(
                "app.services.meta_client.openai.OpenAI"
            ) as mock_openai:
                mock_openai.return_value.chat.completions.create.return_value = (
                    _canned_response(_full_photo_payload())
                )
                analyze_image_json(
                    b"x", "image/png", "s", "u", PHOTO_JSON_SCHEMA
                )
        kwargs = mock_openai.return_value.chat.completions.create.call_args.kwargs
        self.assertEqual(kwargs["model"], "muse-spark-1.3")

    def test_image_sent_as_base64_data_url_with_exact_bytes(self):
        for content_type in (
            "image/jpeg", "image/png", "image/webp", "image/gif"
        ):
            with self.subTest(content_type=content_type):
                image = bytes(f"bytes-for-{content_type}", "utf-8")
                kwargs = self._create_kwargs(image, content_type)
                parts = kwargs["messages"][1]["content"]
                images = [p for p in parts if p.get("type") == "image_url"]
                self.assertEqual(len(images), 1)
                url = images[0]["image_url"]["url"]
                prefix, encoded = url.split(",", 1)
                self.assertEqual(prefix, f"data:{content_type};base64")
                self.assertEqual(base64.b64decode(encoded), image)
                url.encode("ascii")  # data URLs must stay ASCII-safe

    def test_no_tools_or_extra_modalities(self):
        kwargs = self._create_kwargs()
        for forbidden in ("tools", "tool_choice", "functions",
                          "function_call", "stream", "modalities"):
            self.assertNotIn(forbidden, kwargs)
        self.assertIn("max_tokens", kwargs)
        self.assertEqual(
            [m["role"] for m in kwargs["messages"]], ["system", "user"]
        )

    def test_strict_json_schema_without_leaked_name(self):
        kwargs = self._create_kwargs()
        response_format = kwargs["response_format"]
        self.assertEqual(response_format["type"], "json_schema")
        inner = response_format["json_schema"]
        self.assertEqual(inner["name"], "photo_extraction")
        self.assertTrue(inner["strict"])
        self.assertNotIn("name", inner["schema"])
        self.assertIn("visible_description", inner["schema"]["properties"])


class SchemaHygieneTests(unittest.TestCase):
    def _walk(self, node, path="root"):
        if isinstance(node, dict):
            node_type = node.get("type")
            self.assertNotIsInstance(
                node_type, list,
                f"union type at {path}: strict json_schema has no unions",
            )
            for key, value in node.items():
                self._walk(value, f"{path}.{key}")
        elif isinstance(node, list):
            for index, value in enumerate(node):
                self._walk(value, f"{path}[{index}]")

    def test_no_union_types_in_structured_schemas(self):
        for schema in (
            PHOTO_JSON_SCHEMA, EXTRACTION_JSON_SCHEMA, ANSWER_JSON_SCHEMA
        ):
            with self.subTest(schema=schema["name"]):
                self._walk(schema)

    def test_photo_schema_is_strict_compatible(self):
        props = set(PHOTO_JSON_SCHEMA["properties"])
        self.assertEqual(set(PHOTO_JSON_SCHEMA["required"]), props)
        self.assertFalse(PHOTO_JSON_SCHEMA["additionalProperties"])
        item = PHOTO_JSON_SCHEMA["$defs"]["item"]
        self.assertEqual(
            set(item["required"]), set(item["properties"])
        )

    def test_empty_context_string_maps_to_none(self):
        """The union-type removal stays API-compatible: '' -> None."""
        payload = _full_photo_payload()
        payload["possible_context"] = ""
        with (
            patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}),
            patch(
                "app.routes.detective.analyze_image_json",
                return_value=dict(payload),
            ),
        ):
            response = client.post(
                "/api/detective/analyze-photo",
                files={"photo": ("pic.png", _minimal_png(), "image/png")},
            )
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["analysis"]["possible_context"])


class VisionFallbackTests(unittest.TestCase):
    def test_schema_rejection_retries_as_plain_json(self):
        with patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}):
            with patch(
                "app.services.meta_client.openai.OpenAI"
            ) as mock_openai:
                create = mock_openai.return_value.chat.completions.create
                create.side_effect = [
                    _stub_error(
                        "BadRequestError", 400,
                        "Invalid response_format: json_schema with strict "
                        "mode is not supported for this model",
                    ),
                    _canned_response(_full_photo_payload()),
                ]
                out = analyze_image_json(
                    b"img", "image/jpeg", "sys", "notes", PHOTO_JSON_SCHEMA
                )
        self.assertEqual(create.call_count, 2)
        retry_kwargs = create.call_args_list[1].kwargs
        self.assertNotIn("response_format", retry_kwargs)
        self.assertEqual(retry_kwargs["model"], "muse-spark-1.3")
        parts = retry_kwargs["messages"][1]["content"]
        images = [p for p in parts if p.get("type") == "image_url"]
        self.assertEqual(len(images), 1)
        prefix, encoded = images[0]["image_url"]["url"].split(",", 1)
        self.assertEqual(base64.b64decode(encoded), b"img")
        self.assertIn("JSON only", retry_kwargs["messages"][0]["content"])
        self.assertEqual(out["summary"], "Banner reads Maplewood 1998.")

    def test_blind_model_error_does_not_retry(self):
        with patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}):
            with patch(
                "app.services.meta_client.openai.OpenAI"
            ) as mock_openai:
                create = mock_openai.return_value.chat.completions.create
                create.side_effect = _stub_error(
                    "BadRequestError", 400,
                    "This model does not support image input",
                )
                with self.assertRaises(AIUnsupportedModelError):
                    analyze_image_json(
                        b"img", "image/png", "s", "u", PHOTO_JSON_SCHEMA
                    )
        create.assert_called_once()

    def test_not_found_does_not_retry_and_names_config(self):
        with patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}):
            with patch(
                "app.services.meta_client.openai.OpenAI"
            ) as mock_openai:
                create = mock_openai.return_value.chat.completions.create
                create.side_effect = _stub_error(
                    "NotFoundError", 404, "model_not_found",
                    body={"error": {"code": "model_not_found",
                                    "message": "model 'x' not found"}},
                )
                with self.assertRaises(AINotFoundError) as ctx:
                    analyze_image_json(
                        b"img", "image/png", "s", "u", PHOTO_JSON_SCHEMA
                    )
        create.assert_called_once()
        self.assertIn("META_MODEL_API_BASE", str(ctx.exception))


class SanitizedLoggingTests(unittest.TestCase):
    def test_failure_log_has_route_model_and_vendor_detail(self):
        exc = _stub_error(
            "NotFoundError", 404, "404 not found",
            body={"error": {"code": "model_not_found",
                            "message": "The model 'typo-1.0' does not exist"}},
        )
        with patch.dict(os.environ, {
            "META_MODEL_API_KEY": "sk-test",
            "META_MODEL_API_BASE": "https://api.meta.ai/v1",
        }):
            with self.assertLogs("reconnect.meta_api", level="WARNING") as logs:
                mapped = meta_client._raise_for_sdk(
                    exc, model="muse-spark-1.3"
                )
        self.assertIsInstance(mapped, AINotFoundError)
        line = "\n".join(logs.output)
        self.assertIn("NotFoundError", line)
        self.assertIn("POST /chat/completions", line)
        self.assertIn("muse-spark-1.3", line)
        self.assertIn("api.meta.ai", line)
        self.assertIn("model_not_found", line)
        self.assertIn("typo-1.0", line)

    def test_failure_log_redacts_key_and_image_data(self):
        blob = "A" * 400
        exc = _stub_error(
            "BadRequestError", 400,
            f"bad key sk-live-secret-123 with data:image/jpeg;base64,{blob}",
        )
        with patch.dict(os.environ, {
            "META_MODEL_API_KEY": "sk-live-secret-123",
        }):
            with self.assertLogs("reconnect.meta_api", level="WARNING") as logs:
                meta_client._raise_for_sdk(exc, model="muse-spark-1.3")
        line = "\n".join(logs.output)
        self.assertNotIn("sk-live-secret-123", line)
        self.assertIn("[redacted-key]", line)
        self.assertNotIn(blob, line)
        self.assertNotIn("data:image/jpeg;base64,", line)


class PhotoRouteContractTests(unittest.TestCase):
    def test_sdk_success_flows_through_clue_extraction(self):
        """Full path with the SDK boundary mocked: upload -> vision JSON ->
        validated clues, extraction, and grounded photo analysis."""
        with patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}):
            with patch(
                "app.services.meta_client.openai.OpenAI"
            ) as mock_openai:
                mock_openai.return_value.chat.completions.create.return_value = (
                    _canned_response(_full_photo_payload())
                )
                response = client.post(
                    "/api/detective/analyze-photo",
                    files={
                        "photo": ("pic.png", _minimal_png(), "image/png")
                    },
                    data={"memory": "sports day"},
                )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["visible_text"], "MAPLEWOOD 1998")
        self.assertEqual(body["clues"][0]["label"], "Visible text")
        labels = {(c["label"], c["value"]) for c in body["clues"]}
        self.assertIn(("School", "Maplewood Elementary"), labels)
        self.assertIn(("Year", "1998"), labels)
        extraction = body["extraction"]
        self.assertEqual(extraction["schools"][0]["origin"], "stated")
        self.assertEqual(extraction["summary"], "Banner reads Maplewood 1998.")
        analysis = body["analysis"]
        self.assertEqual(analysis["analysis_source"], "vision_model")
        self.assertTrue(analysis["user_confirmation_required"])
        self.assertEqual(
            analysis["visible_description"],
            "Outdoor field, banner, trophy table.",
        )
        self.assertEqual(
            analysis["possible_context"], "school sports event"
        )


if __name__ == "__main__":
    unittest.main()
