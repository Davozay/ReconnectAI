"""Maintained backend tests for the AI Memory Detective.

No live network calls: tests patch the Meta client boundary and assert it is
invoked with the right model, prompts, and payloads. Fictional profiles stand
in for consenting users until Supabase matching lands.
"""

import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from app.schemas.detective import ConfirmedProfile
from app.services.matcher import find_matches
from app.services.meta_client import AITimeoutError

client = TestClient(main.app)

FAKE_EXTRACTION = {
    "schools": [
        {
            "value": "Maplewood Elementary",
            "kind": "school",
            "origin": "stated",
            "confidence": "high",
        }
    ],
    "nicknames": [
        {"value": "Jo-Jo", "kind": "nickname", "origin": "stated", "confidence": "high"}
    ],
    "locations": [
        {
            "value": "Riverside",
            "kind": "location",
            "origin": "inferred",
            "confidence": "medium",
        }
    ],
    "years": [
        {"value": "1998", "kind": "year", "origin": "stated", "confidence": "high"}
    ],
    "names_mentioned": [],
    "events": [
        {
            "value": "sports day",
            "kind": "event",
            "origin": "stated",
            "confidence": "high",
        }
    ],
    "summary": "A 1998 Maplewood sports-day memory mentioning Jo-Jo.",
}


class StatusTests(unittest.TestCase):
    def test_status_reports_unconfigured_without_key(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("META_MODEL_API_KEY", None)
            # config.ai_configured reads META_MODEL_API_KEY only
            response = client.get("/api/detective/status")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertFalse(body["configured"])
        self.assertEqual(body["mode"], "unconfigured")
        self.assertIn("muse-spark", body["text_model"])
        self.assertNotIn("META_MODEL_API_KEY", response.text)

    def test_status_never_exposes_key(self):
        with patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test-secret-123"}):
            response = client.get("/api/detective/status")
        self.assertTrue(response.json()["configured"])
        self.assertNotIn("sk-test-secret-123", response.text)


class AnalyzeTests(unittest.TestCase):
    def test_empty_input_needs_no_api_call(self):
        with patch(
            "app.routes.detective.complete_json",
            side_effect=AssertionError("must not call API"),
        ):
            response = client.post("/api/detective/analyze", json={"memory": "  "})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["clues"], [])

    def test_unconfigured_returns_503_without_mock_results(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("META_MODEL_API_KEY", None)
            response = client.post(
                "/api/detective/analyze", json={"memory": "sports day trophy"}
            )
        self.assertEqual(response.status_code, 503)
        self.assertIn("META_MODEL_API_KEY", response.json()["detail"])

    def test_live_path_calls_meta_api_and_validates_structure(self):
        with (
            patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}),
            patch(
                "app.routes.detective.complete_json",
                return_value=FAKE_EXTRACTION,
            ) as mock_complete,
        ):
            response = client.post(
                "/api/detective/analyze",
                json={"memory": "Sports day at Maplewood in 1998, Jo-Jo won."},
            )
        self.assertEqual(response.status_code, 200)
        # The Meta API is actually invoked (boundary assertion).
        mock_complete.assert_called_once()
        system, user, schema = mock_complete.call_args.args
        self.assertIn("never identify", system.lower())
        self.assertIn("Maplewood", user)
        self.assertEqual(schema["name"], "memory_extraction")

        body = response.json()
        self.assertFalse(body["simulated"])
        extraction = body["extraction"]
        self.assertEqual(extraction["schools"][0]["value"], "Maplewood Elementary")
        self.assertEqual(extraction["schools"][0]["origin"], "stated")
        self.assertEqual(extraction["locations"][0]["origin"], "inferred")
        # Legacy clue list stays consistent with the extraction.
        labels = {(c["label"], c["value"]) for c in body["clues"]}
        self.assertIn(("School", "Maplewood Elementary"), labels)

    def test_malformed_model_output_is_rejected(self):
        with (
            patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}),
            patch(
                "app.routes.detective.complete_json",
                return_value={"schools": [{"value": 42}]},
            ),
        ):
            response = client.post(
                "/api/detective/analyze", json={"memory": "anything"}
            )
        self.assertEqual(response.status_code, 502)
        self.assertIn("unreadable", response.json()["detail"].lower())

    def test_upstream_timeout_maps_to_clear_error(self):
        with (
            patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}),
            patch(
                "app.routes.detective.complete_json",
                side_effect=AITimeoutError(30),
            ),
        ):
            response = client.post(
                "/api/detective/analyze", json={"memory": "anything"}
            )
        self.assertEqual(response.status_code, 502)
        self.assertIn("30 seconds", response.json()["detail"])


def _minimal_png(width: int = 4, height: int = 3) -> bytes:
    import struct

    return (
        b"\x89PNG\r\n\x1a\n"
        + struct.pack(">I", 13)
        + b"IHDR"
        + struct.pack(">II", width, height)
        + bytes([8, 2, 0, 0, 0])
        + b"\x00\x00\x00\x00"
    )


FAKE_PHOTO_PARSED = {
    "visible_text": "MAPLEWOOD ELEMENTARY 1998",
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
        {"value": "1998", "kind": "year", "origin": "stated", "confidence": "high"}
    ],
    "names_mentioned": [],
    "events": [],
    "summary": "Class banner reads Maplewood Elementary 1998.",
}


class PhotoTests(unittest.TestCase):
    def test_rejects_non_photo_upload(self):
        response = client.post(
            "/api/detective/analyze-photo",
            files={"photo": ("note.txt", b"not a photo", "text/plain")},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("JPEG", response.json()["detail"])

    def test_rejects_renamed_non_photo(self):
        response = client.post(
            "/api/detective/analyze-photo",
            files={"photo": ("fake.png", b"%PDF-fake", "image/png")},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("not a recognized photo", response.json()["detail"])

    def test_rejects_oversize_photo(self):
        with patch("app.config.DETECTIVE_MAX_PHOTO_BYTES", 10):
            response = client.post(
                "/api/detective/analyze-photo",
                files={"photo": ("big.png", _minimal_png(), "image/png")},
            )
        self.assertEqual(response.status_code, 400)
        self.assertIn("too large", response.json()["detail"].lower())

    def test_unconfigured_photo_returns_503(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("META_MODEL_API_KEY", None)
            response = client.post(
                "/api/detective/analyze-photo",
                files={"photo": ("pic.png", _minimal_png(), "image/png")},
            )
        self.assertEqual(response.status_code, 503)

    def test_live_photo_path_sends_bytes_to_vision(self):
        with (
            patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}),
            patch(
                "app.routes.detective.analyze_image_json",
                return_value=dict(FAKE_PHOTO_PARSED),
            ) as mock_vision,
        ):
            png = _minimal_png()
            response = client.post(
                "/api/detective/analyze-photo",
                files={"photo": ("pic.png", png, "image/png")},
                data={"memory": "sports day"},
            )
        self.assertEqual(response.status_code, 200)
        mock_vision.assert_called_once()
        args = mock_vision.call_args.args
        self.assertEqual(args[0], png)
        self.assertEqual(args[1], "image/png")
        self.assertIn("never identify", args[2].lower())
        self.assertIn("sports day", args[3])

        body = response.json()
        self.assertFalse(body["simulated"])
        self.assertEqual(body["photo"]["width"], 4)
        self.assertEqual(body["photo"]["height"], 3)
        self.assertEqual(body["visible_text"], "MAPLEWOOD ELEMENTARY 1998")
        self.assertEqual(body["clues"][0]["label"], "Visible text")


class ConfirmTests(unittest.TestCase):
    def test_confirm_normalizes_and_filters(self):
        response = client.post(
            "/api/detective/confirm",
            json={
                "items": [
                    {"kind": "school", "value": "  Maplewood Elementary ", "confirmed": True},
                    {"kind": "school", "value": "maplewood elementary", "confirmed": True},
                    {"kind": "nickname", "value": "Jo-Jo", "confirmed": True},
                    {"kind": "nickname", "value": "Wrong", "confirmed": False},
                    {"kind": "year", "value": "1998", "confirmed": True},
                    {"kind": "clue", "value": "trophy", "confirmed": True},
                ]
            },
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["schools"], ["Maplewood Elementary"])
        self.assertEqual(body["nicknames"], ["Jo-Jo"])
        self.assertEqual(body["years"], ["1998"])
        self.assertEqual(body["events"], ["trophy"])


class MatchTests(unittest.TestCase):
    SEEKER = {
        "schools": ["Maplewood Elementary"],
        "nicknames": ["Jo-Jo"],
        "locations": ["Riverside"],
        "years": ["1998"],
        "names_mentioned": [],
        "events": ["sports day trophy"],
    }

    def test_matches_route_empty_until_supabase_lands(self):
        """The route never shows fictional people; discovery waits on
        real opted-in Supabase profiles."""
        response = client.post("/api/detective/matches", json=self.SEEKER)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["matches"], [])
        self.assertFalse(body["simulated"])
        self.assertIn("Supabase", body["note"])
        self.assertIn("unavailable", body["note"])

    def test_engine_strong_match_ranked_first_with_reasons(self):
        ranked = find_matches(ConfirmedProfile(**self.SEEKER))
        self.assertGreater(len(ranked), 0)
        top = ranked[0]
        self.assertEqual(top.profile_id, "demo-jo")
        self.assertEqual(top.strength, "Strong overlap")
        reasons = " ".join(top.reasons)
        self.assertIn("Maplewood", reasons)
        self.assertIn("1998", reasons)
        self.assertIn("Jo", reasons)

    def test_engine_year_range_with_endash_overlaps(self):
        ranked = find_matches(
            ConfirmedProfile(
                schools=["Maplewood Elementary"],
                nicknames=[],
                locations=[],
                years=["1996 – 2001"],
                names_mentioned=[],
                events=[],
            )
        )
        reasons = " ".join(ranked[0].reasons)
        self.assertIn("overlapping years", reasons)

    def test_engine_no_overlap_returns_no_matches(self):
        ranked = find_matches(
            ConfirmedProfile(
                schools=["Nonexistent Academy"],
                nicknames=["Xyzzy"],
                locations=["Nowhereville"],
                years=["1980"],
                names_mentioned=[],
                events=["quantum knitting"],
            )
        )
        self.assertEqual(ranked, [])

    def test_engine_matches_expose_no_scores_or_probabilities(self):
        for match in find_matches(ConfirmedProfile(**self.SEEKER)):
            dumped = match.model_dump()
            self.assertNotIn("score", dumped)
            self.assertNotIn("probability", dumped)
            self.assertNotIn("confidence", dumped)
            self.assertGreaterEqual(len(match.reasons), 1)

    def test_full_flow_photo_to_suggestions(self):
        """Upload -> vision extraction -> user confirm -> matches, end to end."""
        with (
            patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}),
            patch(
                "app.routes.detective.analyze_image_json",
                return_value={
                    "visible_text": "MAPLEWOOD 1998",
                    "schools": [
                        {
                            "value": "Maplewood Elementary",
                            "kind": "school",
                            "origin": "stated",
                            "confidence": "high",
                        }
                    ],
                    "nicknames": [
                        {
                            "value": "Jo-Jo",
                            "kind": "nickname",
                            "origin": "stated",
                            "confidence": "high",
                        }
                    ],
                    "locations": [],
                    "years": [
                        {
                            "value": "1998",
                            "kind": "year",
                            "origin": "stated",
                            "confidence": "high",
                        }
                    ],
                    "names_mentioned": [],
                    "events": [],
                    "summary": "Maplewood banner from 1998.",
                },
            ),
        ):
            upload = client.post(
                "/api/detective/analyze-photo",
                files={"photo": ("pic.png", _minimal_png(), "image/png")},
            )
        self.assertEqual(upload.status_code, 200)
        extraction = upload.json()["extraction"]

        items = []
        for group, kind in [
            ("schools", "school"),
            ("nicknames", "nickname"),
            ("locations", "location"),
            ("years", "year"),
            ("names_mentioned", "name"),
            ("events", "event"),
        ]:
            for entry in extraction[group]:
                items.append(
                    {"kind": kind, "value": entry["value"], "confirmed": True}
                )
        confirmed = client.post("/api/detective/confirm", json={"items": items})
        self.assertEqual(confirmed.status_code, 200)

        matches = client.post("/api/detective/matches", json=confirmed.json())
        self.assertEqual(matches.status_code, 200)
        body = matches.json()
        # Discovery honestly reports unavailable until Supabase lands.
        self.assertEqual(body["matches"], [])
        self.assertIn("Supabase", body["note"])

    def test_vision_request_carries_exact_image_bytes(self):
        """Evidence: the uploaded bytes reach the Meta image-analysis call."""
        import base64
        import json
        from unittest.mock import MagicMock

        from app.services.meta_client import analyze_image_json

        payload = {
            "visible_text": "",
            "visible_description": "grass field, banner pole",
            "extracted_text": "",
            "possible_context": None,
            "uncertain_observations": [],
            "schools": [],
            "nicknames": [],
            "locations": [],
            "years": [],
            "names_mentioned": [],
            "events": [],
            "summary": "s",
        }
        response = MagicMock()
        response.choices = [
            MagicMock(message=MagicMock(content=json.dumps(payload)))
        ]
        image = _minimal_png(8, 6)
        with patch.dict(
            os.environ,
            {"META_MODEL_API_KEY": "sk-test", "META_MODEL_VISION": "muse-spark-1.3"},
        ):
            with patch(
                "app.services.meta_client.openai.OpenAI"
            ) as mock_openai:
                mock_openai.return_value.chat.completions.create.return_value = (
                    response
                )
                out = analyze_image_json(
                    image, "image/png", "sys", "user", {"name": "t"}
                )
        self.assertEqual(out["summary"], "s")
        kwargs = (
            mock_openai.return_value.chat.completions.create.call_args.kwargs
        )
        self.assertEqual(kwargs["model"], "muse-spark-1.3")
        parts = kwargs["messages"][1]["content"]
        images = [p for p in parts if p.get("type") == "image_url"]
        self.assertEqual(len(images), 1)
        prefix, encoded = images[0]["image_url"]["url"].split(",", 1)
        self.assertTrue(prefix.startswith("data:image/png;base64"))
        self.assertEqual(base64.b64decode(encoded), image)

    def test_unsupported_image_model_gives_manual_entry_guidance(self):
        from unittest.mock import MagicMock

        from app.services.meta_client import (
            AIUnsupportedModelError,
            analyze_image_json,
        )

        class FakeBadRequest(Exception):
            def __init__(self):
                super().__init__("This model does not support image input.")
                self.status_code = 400

        with patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}):
            with patch(
                "app.services.meta_client.openai.OpenAI"
            ) as mock_openai:
                mock_openai.return_value.chat.completions.create.side_effect = (
                    FakeBadRequest()
                )
                with self.assertRaises(AIUnsupportedModelError) as ctx:
                    analyze_image_json(b"img", "image/png", "s", "u", {})
        self.assertIn("describe the photo manually", str(ctx.exception))

    def test_vision_prompt_bans_invention_and_face_identity(self):
        from app.routes.detective import PHOTO_SYSTEM

        lowered = PHOTO_SYSTEM.lower()
        for required in [
            "only directly observable",
            "exact year",
            "empty string",
            "confirm",
            "never identify",
            "never guess who someone",
        ]:
            self.assertIn(required, lowered)


class AccuracyTests(unittest.TestCase):
    def _photo_result(self, parsed):
        with (
            patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}),
            patch(
                "app.routes.detective.analyze_image_json",
                return_value=dict(parsed),
            ),
        ):
            return client.post(
                "/api/detective/analyze-photo",
                files={"photo": ("pic.png", _minimal_png(), "image/png")},
            )

    def _empty_parsed(self):
        return {
            "visible_text": "",
            "visible_description": "",
            "extracted_text": "",
            "possible_context": None,
            "uncertain_observations": [],
            "schools": [],
            "nicknames": [],
            "locations": [],
            "years": [],
            "names_mentioned": [],
            "events": [],
            "summary": "Nothing readable.",
        }

    def test_image_without_readable_text_has_no_text_clue(self):
        response = self._photo_result(self._empty_parsed())
        self.assertEqual(response.status_code, 200)
        body = response.json()
        labels = [c["label"] for c in body["clues"]]
        self.assertNotIn("Visible text", labels)
        self.assertEqual(body["analysis"]["extracted_text"], "")
        self.assertEqual(body["analysis"]["analysis_source"], "vision_model")
        self.assertTrue(body["analysis"]["user_confirmation_required"])

    def test_image_without_people_accepts_empty_names(self):
        parsed = self._empty_parsed()
        parsed["visible_description"] = "Empty grass field, goalpost, no people."
        response = self._photo_result(parsed)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["analysis"]["visible_description"],
            "Empty grass field, goalpost, no people.",
        )

    def test_school_sign_text_is_preserved_exactly(self):
        parsed = self._empty_parsed()
        parsed["visible_text"] = "MAPLEWOOD ELEMENTARY — FIELD DAY"
        parsed["extracted_text"] = "MAPLEWOOD ELEMENTARY — FIELD DAY"
        parsed["schools"] = [
            {
                "value": "Maplewood Elementary",
                "kind": "school",
                "origin": "stated",
                "confidence": "high",
            }
        ]
        response = self._photo_result(parsed)
        body = response.json()
        self.assertEqual(
            body["visible_text"], "MAPLEWOOD ELEMENTARY — FIELD DAY"
        )
        self.assertEqual(body["clues"][0]["label"], "Visible text")
        self.assertEqual(
            body["clues"][0]["value"], "MAPLEWOOD ELEMENTARY — FIELD DAY"
        )

    def test_blurry_photo_surfaces_uncertainty(self):
        parsed = self._empty_parsed()
        parsed["possible_context"] = "possibly an outdoor class event"
        parsed["uncertain_observations"] = [
            "Banner text is blurred and unreadable.",
            "Year cannot be determined from appearance.",
        ]
        parsed["years"] = [
            {
                "value": "unknown",
                "kind": "year",
                "origin": "inferred",
                "confidence": "low",
            }
        ]
        response = self._photo_result(parsed)
        body = response.json()
        self.assertEqual(
            body["analysis"]["possible_context"],
            "possibly an outdoor class event",
        )
        self.assertEqual(len(body["analysis"]["uncertain_observations"]), 2)
        year_clues = [c for c in body["clues"] if c["label"] == "Year"]
        self.assertEqual(year_clues[0]["value"], "unknown")
        self.assertEqual(year_clues[0]["source"], "AI suggestion")

    def test_failed_meta_request_returns_error_without_content(self):
        with (
            patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}),
            patch(
                "app.routes.detective.analyze_image_json",
                side_effect=AITimeoutError(30),
            ),
        ):
            response = client.post(
                "/api/detective/analyze-photo",
                files={"photo": ("pic.png", _minimal_png(), "image/png")},
            )
        self.assertEqual(response.status_code, 502)
        body = response.json()
        self.assertIn("30 seconds", body["detail"])
        self.assertNotIn("clues", body)
        self.assertNotIn("summary", body)

    def test_no_fabricated_fallback_descriptions_anywhere(self):
        import pathlib

        repo = pathlib.Path(__file__).resolve().parent.parent.parent
        banned = ["late-90s school sports day", "anchoring your search"]
        hits = []
        for path in list((repo / "backend").rglob("*.py")) + list(
            (repo / "frontend" / "src").rglob("*.ts*")
        ):
            if "node_modules" in str(path):
                continue
            if "tests" in path.parts:
                continue  # this tripwire itself names the banned phrases
            text = path.read_text()
            for phrase in banned:
                if phrase in text:
                    hits.append(f"{path.relative_to(repo)}: {phrase!r}")
        self.assertEqual(hits, [])

    def test_match_highlights_power_badges(self):
        ranked = find_matches(
            ConfirmedProfile(
                schools=["Maplewood Elementary"],
                nicknames=["Jo-Jo"],
                locations=["Riverside"],
                years=["1998"],
                names_mentioned=[],
                events=["sports day trophy"],
            )
        )
        highlights = ranked[0].highlights
        self.assertIn("Maplewood Elementary", highlights.schools)
        self.assertIn("Riverside", highlights.places)
        self.assertIn("1998", highlights.years)
        self.assertTrue(
            any("Jo" in nick for nick in highlights.nicknames)
        )


class DiscoverTests(unittest.TestCase):
    SEEKER = {
        "schools": ["Maplewood Elementary"],
        "nicknames": [],
        "locations": ["Riverside"],
        "years": ["1998"],
        "names_mentioned": [],
        "events": ["sports day trophy"],
    }

    def test_discover_returns_ranked_labeled_fixtures(self):
        response = client.post("/api/detective/discover", json=self.SEEKER)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["simulated"])
        self.assertIn("Demonstration fixtures", body["note"])
        self.assertGreater(len(body["items"]), 0)
        first = body["items"][0]
        self.assertEqual(first["school"], "Maplewood Elementary")
        self.assertGreaterEqual(len(first["reasons"]), 1)

    def test_discover_filters_by_context(self):
        response = client.post(
            "/api/detective/discover",
            json={
                "schools": ["Hillcrest Academy"],
                "nicknames": [],
                "locations": [],
                "years": [],
                "names_mentioned": [],
                "events": [],
            },
        )
        schools = {item["school"] for item in response.json()["items"]}
        self.assertEqual(schools, {"Hillcrest Academy"})

    def test_discover_empty_profile_returns_empty(self):
        response = client.post(
            "/api/detective/discover",
            json={
                "schools": [],
                "nicknames": [],
                "locations": [],
                "years": [],
                "names_mentioned": [],
                "events": [],
            },
        )
        self.assertEqual(response.json()["items"], [])

    def test_discover_items_carry_no_face_or_identity_data(self):
        response = client.post("/api/detective/discover", json=self.SEEKER)
        allowed = {
            "id",
            "title",
            "author",
            "school",
            "place",
            "year",
            "seed",
            "reasons",
        }
        for item in response.json()["items"]:
            self.assertLessEqual(set(item.keys()), allowed)

    def test_rescue_starts_with_year_and_skips_covered(self):
        first = client.post(
            "/api/detective/rescue/questions",
            json={"covered_kinds": [], "answers": []},
        ).json()
        self.assertFalse(first["done"])
        self.assertEqual(first["question"]["topic"], "year")

        skipped = client.post(
            "/api/detective/rescue/questions",
            json={
                "covered_kinds": ["year", "location"],
                "answers": [{"topic": "school", "value": "Maplewood"}],
            },
        ).json()
        self.assertEqual(skipped["question"]["topic"], "names")
        self.assertEqual(skipped["progress"]["asked"], 1)

    def test_rescue_personalizes_with_prior_answers(self):
        body = client.post(
            "/api/detective/rescue/questions",
            json={
                "covered_kinds": ["year"],
                "answers": [{"topic": "place", "value": "Riverside"}],
            },
        ).json()
        self.assertEqual(body["question"]["topic"], "school")
        self.assertIn("Riverside", body["question"]["prompt"])

    def test_rescue_completes_after_all_topics(self):
        body = client.post(
            "/api/detective/rescue/questions",
            json={
                "covered_kinds": [],
                "answers": [
                    {"topic": t, "value": "x"} for t in
                    ["year", "place", "school", "names", "event", "scene", "details"]
                ],
            },
        ).json()
        self.assertTrue(body["done"])
        self.assertIsNone(body["question"])

    def test_rescue_answer_skip_needs_no_ai(self):
        with patch(
            "app.routes.detective.complete_json",
            side_effect=AssertionError("must not call AI"),
        ):
            for payload in [
                {"topic": "year", "skipped": True},
                {"topic": "year", "unknown": True},
                {"topic": "year", "value": "   "},
            ]:
                response = client.post("/api/detective/rescue/answer", json=payload)
                self.assertEqual(response.status_code, 200)
                body = response.json()
                self.assertEqual(body["items"], [])
                self.assertEqual(body["source"], "none")

    def test_rescue_answer_direct_fallback_uses_own_words(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("META_MODEL_API_KEY", None)
            response = client.post(
                "/api/detective/rescue/answer",
                json={"topic": "school", "value": "  Maplewood Elementary "},
            )
        body = response.json()
        self.assertEqual(body["source"], "direct")
        self.assertEqual(body["items"][0]["value"], "Maplewood Elementary")
        self.assertEqual(body["items"][0]["origin"], "stated")

    def test_rescue_answer_direct_rejects_non_year(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("META_MODEL_API_KEY", None)
            response = client.post(
                "/api/detective/rescue/answer",
                json={"topic": "year", "value": "a long time ago"},
            )
        self.assertEqual(response.json()["items"][0]["kind"], "clue")

    def test_rescue_answer_ai_path_splits_and_marks_origins(self):
        with (
            patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}),
            patch(
                "app.routes.detective.complete_json",
                return_value={
                    "items": [
                        {"value": "Jo-Jo", "kind": "nickname", "confidence": "high"},
                        {"value": "Maya", "kind": "name", "confidence": "high"},
                        {"value": "1999", "kind": "year", "confidence": "low"},
                    ]
                },
            ) as mock_complete,
        ):
            response = client.post(
                "/api/detective/rescue/answer",
                json={"topic": "names", "value": "Jo-Jo and Maya"},
            )
        mock_complete.assert_called_once()
        items = response.json()["items"]
        self.assertEqual(response.json()["source"], "ai")
        self.assertEqual([i["value"] for i in items], ["Jo-Jo", "Maya", "1999"])
        self.assertTrue(all(i["origin"] == "stated" for i in items[:2]))
        self.assertEqual(items[2]["kind"], "clue")  # off-topic coerced
        self.assertEqual(items[2]["origin"], "inferred")  # not in answer

    def test_rescue_discover_matches_scene_objects(self):
        response = client.post(
            "/api/detective/rescue/discover",
            json={
                "profile": {
                    "schools": [],
                    "nicknames": [],
                    "locations": [],
                    "years": [],
                    "names_mentioned": [],
                    "events": [],
                },
                "scene_objects": ["trophy", "banner"],
                "scene_setting": "field",
            },
        )
        body = response.json()
        self.assertTrue(body["simulated"])
        self.assertGreater(len(body["items"]), 0)
        reasons = " ".join(r for item in body["items"] for r in item["reasons"])
        self.assertIn("Similar scene", reasons)
        for item in body["items"]:
            self.assertLessEqual(
                set(item.keys()),
                {"id", "title", "author", "school", "place", "year", "seed", "reasons"},
            )

    def test_no_biometric_matching_in_codebase(self):
        import pathlib

        backend = pathlib.Path(__file__).resolve().parent.parent
        forbidden = ["face_recognition", "face-encoding", "biometric", "faceprint"]
        hits = []
        for path in list((backend / "app").rglob("*.py")):
            text = path.read_text().lower()
            for term in forbidden:
                if term in text and "no biometric" not in text:
                    hits.append(f"{path.name}: {term}")
        self.assertEqual(hits, [])


if __name__ == "__main__":
    unittest.main()
