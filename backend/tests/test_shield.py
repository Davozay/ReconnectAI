"""Security tests for ReConnect Shield.

Covers: auth rejection, opt-in discovery, request lifecycle, blocks,
reports + admin-only moderation, connected-only messaging, local scam
warnings, private photos, rate limits, and JWT verification. Demo mode
(X-Demo-User) stands in for Supabase Auth; fixtures are fictional.
"""

import base64
import hashlib
import hmac
import json
import os
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from app import config
from app.services import rate_limit, scam_scan, shield_store

client = TestClient(main.app)

ALI = {"X-Demo-User": "alice"}
BOB = {"X-Demo-User": "bob"}
CAR = {"X-Demo-User": "cara"}
MOD = {"X-Demo-User": "moderator"}

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG_EXIF = (
    b"\xff\xd8"
    + b"\xff\xe1\x00\x10" + b"Exif\x00\x00" + b"0" * 8
    + b"\xff\xd9"
)


def _demo_env(**overrides):
    env = {"SHIELD_DEMO_MODE": "true", "SHIELD_ADMIN_IDS": "demo:moderator"}
    env.pop("SUPABASE_JWT_SECRET", None)
    env.update(overrides)
    return env


def _clear_supabase_env():
    # Keep Supabase verification fully out of demo-mode tests (the mode now
    # also honors SUPABASE_URL / SUPABASE_JWKS_URL, not just the secret).
    os.environ.pop("SUPABASE_URL", None)
    os.environ.pop("SUPABASE_JWKS_URL", None)
    os.environ.pop("SUPABASE_JWT_SECRET", None)


def _hs256(payload, secret):
    def b64(raw: bytes) -> str:
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = b64(json.dumps(payload).encode())
    sig = b64(hmac.new(secret.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest())
    return f"{header}.{body}.{sig}"


class ShieldTestCase(unittest.TestCase):
    def setUp(self):
        self._env_patch = patch.dict(os.environ, _demo_env())
        self._env_patch.start()
        _clear_supabase_env()
        self.addCleanup(self._env_patch.stop)
        shield_store.reset_all()
        rate_limit.reset()
        self.addCleanup(shield_store.reset_all)
        self.addCleanup(rate_limit.reset)

    def _profile(self, headers, name, discoverable=True):
        resp = client.patch(
            "/api/shield/profile",
            json={"display_name": name, "discoverable": discoverable},
            headers=headers,
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        return resp.json()

    def _connect(self, sender=ALI, target="demo:bob", sender_name="Alice", target_headers=BOB,
                 target_name="Bob"):
        self._profile(sender, sender_name)
        self._profile(target_headers, target_name)
        resp = client.post(
            "/api/shield/requests",
            json={"to_user_id": target, "message": "Maplewood '98?"},
            headers=sender,
        )
        self.assertEqual(resp.status_code, 201, resp.text)
        rid = resp.json()["id"]
        resp = client.post(f"/api/shield/requests/{rid}/accept", headers=target_headers)
        self.assertEqual(resp.status_code, 200, resp.text)
        return rid


class AuthTests(ShieldTestCase):
    def test_missing_identity_rejected(self):
        for method, url, kwargs in [
            ("GET", "/api/shield/profile/me", {}),
            ("GET", "/api/shield/discover", {}),
            ("POST", "/api/shield/requests", {"json": {"to_user_id": "demo:bob"}}),
            ("GET", "/api/shield/admin/reports", {}),
        ]:
            resp = client.request(method, url, **kwargs)
            self.assertEqual(resp.status_code, 401, f"{method} {url}: {resp.text}")

    def test_malformed_demo_identity_rejected(self):
        resp = client.get("/api/shield/profile/me", headers={"X-Demo-User": "bad id!"})
        self.assertEqual(resp.status_code, 401)

    def test_auth_off_returns_503(self):
        with patch.dict(os.environ, {"SHIELD_DEMO_MODE": "false"}):
            _clear_supabase_env()
            resp = client.get("/api/shield/profile/me", headers=ALI)
            self.assertEqual(resp.status_code, 503)

    def test_sender_identity_comes_from_header_not_body(self):
        self._profile(ALI, "Alice")
        self._profile(BOB, "Bob")
        resp = client.post(
            "/api/shield/requests",
            json={"to_user_id": "demo:bob", "from_id": "demo:cara"},
            headers=ALI,
        )
        self.assertEqual(resp.status_code, 201, resp.text)
        self.assertEqual(resp.json()["from_id"], "demo:alice")


class JwtTests(ShieldTestCase):
    def _jwt_env(self, secret):
        return patch.dict(
            os.environ,
            {"SHIELD_DEMO_MODE": "false", "SUPABASE_JWT_SECRET": secret},
        )

    def test_valid_bearer_token_accepted(self):
        token = _hs256({"sub": "user-1", "exp": time.time() + 600}, "s3cret")
        with self._jwt_env("s3cret"):
            resp = client.patch(
                "/api/shield/profile",
                json={"display_name": "Supa", "discoverable": True},
                headers={"Authorization": f"Bearer {token}"},
            )
            self.assertEqual(resp.status_code, 200, resp.text)
            self.assertEqual(resp.json()["user_id"], "user-1")

    def test_wrong_secret_rejected(self):
        token = _hs256({"sub": "user-1", "exp": time.time() + 600}, "other")
        with self._jwt_env("s3cret"):
            resp = client.get(
                "/api/shield/profile/me", headers={"Authorization": f"Bearer {token}"}
            )
            self.assertEqual(resp.status_code, 401)

    def test_expired_token_rejected(self):
        token = _hs256({"sub": "user-1", "exp": time.time() - 10}, "s3cret")
        with self._jwt_env("s3cret"):
            resp = client.get(
                "/api/shield/profile/me", headers={"Authorization": f"Bearer {token}"}
            )
            self.assertEqual(resp.status_code, 401)

    def test_missing_bearer_in_supabase_mode_rejected(self):
        with self._jwt_env("s3cret"):
            resp = client.get("/api/shield/profile/me", headers=ALI)
            self.assertEqual(resp.status_code, 401)


class DiscoveryTests(ShieldTestCase):
    def test_private_by_default_until_opt_in(self):
        self._profile(BOB, "Bob", discoverable=False)
        self._profile(ALI, "Alice", discoverable=True)
        resp = client.get("/api/shield/discover", headers=ALI)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_discover_returns_public_fields_only(self):
        self._profile(BOB, "Bob", discoverable=True)
        resp = client.get("/api/shield/discover", headers=ALI)
        self.assertEqual(
            resp.json(), [{"user_id": "demo:bob", "display_name": "Bob"}]
        )

    def test_self_excluded(self):
        self._profile(ALI, "Alice", discoverable=True)
        resp = client.get("/api/shield/discover", headers=ALI)
        self.assertEqual(resp.json(), [])


class RequestTests(ShieldTestCase):
    def test_request_to_undiscoverable_hides_existence(self):
        self._profile(BOB, "Bob", discoverable=False)
        resp = client.post(
            "/api/shield/requests", json={"to_user_id": "demo:bob"}, headers=ALI
        )
        missing = client.post(
            "/api/shield/requests", json={"to_user_id": "demo:ghost"}, headers=ALI
        )
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(resp.json(), missing.json())

    def test_duplicate_requests_rejected(self):
        self._profile(ALI, "Alice")
        self._profile(BOB, "Bob")
        first = client.post(
            "/api/shield/requests", json={"to_user_id": "demo:bob"}, headers=ALI
        )
        self.assertEqual(first.status_code, 201)
        dup = client.post(
            "/api/shield/requests", json={"to_user_id": "demo:bob"}, headers=ALI
        )
        reverse = client.post(
            "/api/shield/requests", json={"to_user_id": "demo:alice"}, headers=BOB
        )
        self.assertEqual(dup.status_code, 409)
        self.assertEqual(reverse.status_code, 409)

    def test_self_request_rejected(self):
        resp = client.post(
            "/api/shield/requests", json={"to_user_id": "demo:alice"}, headers=ALI
        )
        self.assertEqual(resp.status_code, 400)

    def test_only_recipient_can_accept(self):
        self._profile(ALI, "Alice")
        self._profile(BOB, "Bob")
        self._profile(CAR, "Cara")
        sent = client.post(
            "/api/shield/requests", json={"to_user_id": "demo:bob"}, headers=ALI
        )
        rid = sent.json()["id"]
        self.assertEqual(
            client.post(f"/api/shield/requests/{rid}/accept", headers=CAR).status_code, 403
        )
        self.assertEqual(
            client.post(f"/api/shield/requests/{rid}/accept", headers=ALI).status_code, 403
        )
        self.assertEqual(
            client.post(f"/api/shield/requests/{rid}/accept", headers=BOB).status_code, 200
        )

    def test_decline_and_cancel(self):
        self._profile(ALI, "Alice")
        self._profile(BOB, "Bob")
        sent = client.post(
            "/api/shield/requests", json={"to_user_id": "demo:bob"}, headers=ALI
        )
        rid = sent.json()["id"]
        declined = client.post(f"/api/shield/requests/{rid}/decline", headers=BOB)
        self.assertEqual(declined.json()["status"], "declined")
        sent2 = client.post(
            "/api/shield/requests", json={"to_user_id": "demo:bob"}, headers=ALI
        )
        rid2 = sent2.json()["id"]
        cancelled = client.post(f"/api/shield/requests/{rid2}/cancel", headers=ALI)
        self.assertEqual(cancelled.json()["status"], "cancelled")


class BlockTests(ShieldTestCase):
    def test_block_hides_from_discovery_and_requests(self):
        self._profile(ALI, "Alice")
        self._profile(BOB, "Bob")
        client.post("/api/shield/blocks", json={"user_id": "demo:bob"}, headers=ALI)
        discover = client.get("/api/shield/discover", headers=ALI)
        self.assertEqual(discover.json(), [])
        req = client.post(
            "/api/shield/requests", json={"to_user_id": "demo:bob"}, headers=ALI
        )
        reverse = client.post(
            "/api/shield/requests", json={"to_user_id": "demo:alice"}, headers=BOB
        )
        self.assertEqual(req.status_code, 404)
        self.assertEqual(reverse.status_code, 404)
        self.assertEqual(req.json(), reverse.json())

    def test_block_cancels_pending_request(self):
        self._profile(ALI, "Alice")
        self._profile(BOB, "Bob")
        sent = client.post(
            "/api/shield/requests", json={"to_user_id": "demo:bob"}, headers=ALI
        )
        client.post("/api/shield/blocks", json={"user_id": "demo:alice"}, headers=BOB)
        pending = client.get("/api/shield/requests", headers=BOB).json()
        self.assertEqual(pending["incoming"], [])
        accept = client.post(
            f"/api/shield/requests/{sent.json()['id']}/accept", headers=BOB
        )
        self.assertEqual(accept.status_code, 404)

    def test_blocked_users_cannot_message(self):
        self._connect()
        sent = client.post(
            "/api/shield/messages",
            json={"to_user_id": "demo:bob", "text": "hello"},
            headers=ALI,
        )
        self.assertEqual(sent.status_code, 201)
        client.post("/api/shield/blocks", json={"user_id": "demo:bob"}, headers=ALI)
        blocked = client.post(
            "/api/shield/messages",
            json={"to_user_id": "demo:bob", "text": "again"},
            headers=ALI,
        )
        read = client.get("/api/shield/messages/demo:bob", headers=ALI)
        self.assertEqual(blocked.status_code, 404)
        self.assertEqual(read.status_code, 404)

    def test_unblock_restores_contact(self):
        self._connect()
        client.post("/api/shield/blocks", json={"user_id": "demo:bob"}, headers=ALI)
        unblocked = client.delete("/api/shield/blocks/demo:bob", headers=ALI)
        self.assertEqual(unblocked.json(), {"blocked": []})
        sent = client.post(
            "/api/shield/messages",
            json={"to_user_id": "demo:bob", "text": "back"},
            headers=ALI,
        )
        self.assertEqual(sent.status_code, 201)


class MessageTests(ShieldTestCase):
    def test_messaging_requires_connection(self):
        self._profile(ALI, "Alice")
        self._profile(BOB, "Bob")
        resp = client.post(
            "/api/shield/messages",
            json={"to_user_id": "demo:bob", "text": "hi stranger"},
            headers=ALI,
        )
        self.assertEqual(resp.status_code, 403)

    def test_stranger_cannot_read_thread(self):
        self._connect()
        client.post(
            "/api/shield/messages",
            json={"to_user_id": "demo:bob", "text": "secret"},
            headers=ALI,
        )
        self._profile(CAR, "Cara")
        resp = client.get("/api/shield/messages/demo:alice", headers=CAR)
        self.assertEqual(resp.status_code, 403)

    def test_recipient_sees_warnings_sender_does_not(self):
        self._connect()
        sent = client.post(
            "/api/shield/messages",
            json={"to_user_id": "demo:bob", "text": "send money now please"},
            headers=ALI,
        )
        self.assertTrue(any(w["code"] == "money_request" for w in sent.json()["warnings"]))
        thread_bob = client.get("/api/shield/messages/demo:alice", headers=BOB).json()
        self.assertTrue(
            any(w["code"] == "money_request" for w in thread_bob["messages"][0]["warnings"])
        )
        thread_ali = client.get("/api/shield/messages/demo:bob", headers=ALI).json()
        self.assertEqual(thread_ali["messages"][0]["warnings"], [])


class ScamScanTests(unittest.TestCase):
    def test_money_request(self):
        warnings = scam_scan.scan_message(
            "Can you send $200 for my bus fare?", is_new_connection=False
        )
        self.assertTrue(any(w["code"] == "money_request" for w in warnings))

    def test_credential_request(self):
        warnings = scam_scan.scan_message(
            "What is your password and OTP code?", is_new_connection=False
        )
        self.assertTrue(any(w["code"] == "credential_request" for w in warnings))

    def test_suspicious_link(self):
        warnings = scam_scan.scan_message(
            "Check this out http://free-prizes.tk/claim", is_new_connection=False
        )
        self.assertTrue(any(w["code"] == "external_link" for w in warnings))

    def test_pressure_plus_money(self):
        warnings = scam_scan.scan_message(
            "Urgent! Wire the money right now, don't tell anyone.",
            is_new_connection=False,
        )
        codes = {w["code"] for w in warnings}
        self.assertIn("money_request", codes)
        self.assertIn("pressure_tactics", codes)

    def test_benign_message_clean_for_known_contact(self):
        warnings = scam_scan.scan_message(
            "Loved seeing the Maplewood class photo!", is_new_connection=False
        )
        self.assertEqual(warnings, [])

    def test_new_connection_gets_gentle_notice_only(self):
        warnings = scam_scan.scan_message("Hey, Maplewood '98?", is_new_connection=True)
        self.assertEqual([w["code"] for w in warnings], ["new_connection"])

    def test_scam_check_endpoint(self):
        with patch.dict(os.environ, _demo_env()):
            _clear_supabase_env()
            shield_store.reset_all()
            rate_limit.reset()
            try:
                resp = client.post(
                    "/api/shield/scam-check",
                    json={"text": "Send your verification code ASAP"},
                    headers=ALI,
                )
                self.assertEqual(resp.status_code, 200)
                self.assertTrue(
                    any(w["code"] == "credential_request" for w in resp.json()["warnings"])
                )
            finally:
                shield_store.reset_all()
                rate_limit.reset()


class ReportTests(ShieldTestCase):
    def test_report_lifecycle_and_admin_only_queue(self):
        self._profile(ALI, "Alice")
        created = client.post(
            "/api/shield/reports",
            json={
                "target_type": "user",
                "target_id": "demo:bob",
                "category": "scam",
                "details": "Asked for gift cards.",
            },
            headers=ALI,
        )
        self.assertEqual(created.status_code, 201)
        mine = client.get("/api/shield/reports/mine", headers=ALI).json()
        self.assertEqual(len(mine), 1)
        others = client.get("/api/shield/reports/mine", headers=BOB).json()
        self.assertEqual(others, [])
        denied = client.get("/api/shield/admin/reports", headers=ALI)
        self.assertEqual(denied.status_code, 403)
        queue = client.get("/api/shield/admin/reports", headers=MOD)
        self.assertEqual(queue.status_code, 200)
        self.assertEqual(len(queue.json()), 1)
        updated = client.patch(
            f"/api/shield/admin/reports/{created.json()['id']}",
            json={"status": "reviewing"},
            headers=MOD,
        )
        self.assertEqual(updated.json()["status"], "reviewing")
        forbidden_update = client.patch(
            f"/api/shield/admin/reports/{created.json()['id']}",
            json={"status": "resolved"},
            headers=ALI,
        )
        self.assertEqual(forbidden_update.status_code, 403)

    def test_invalid_category_rejected(self):
        resp = client.post(
            "/api/shield/reports",
            json={"target_type": "user", "target_id": "demo:bob", "category": "spam"},
            headers=ALI,
        )
        self.assertEqual(resp.status_code, 422)


class PhotoTests(ShieldTestCase):
    def test_upload_download_delete_owner_only(self):
        uploaded = client.post(
            "/api/shield/photos",
            files={"file": ("class.png", PNG, "image/png")},
            headers=ALI,
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.text)
        body = uploaded.json()
        self.assertEqual(body["owner_id"], "demo:alice")
        self.assertNotIn("data", body)
        pid = body["id"]
        got = client.get(f"/api/shield/photos/{pid}", headers=ALI)
        self.assertEqual(got.status_code, 200)
        self.assertEqual(got.content, PNG)
        denied = client.get(f"/api/shield/photos/{pid}", headers=BOB)
        self.assertEqual(denied.status_code, 403)
        anon = client.get(f"/api/shield/photos/{pid}")
        self.assertEqual(anon.status_code, 401)
        delete_denied = client.delete(f"/api/shield/photos/{pid}", headers=BOB)
        self.assertEqual(delete_denied.status_code, 403)
        deleted = client.delete(f"/api/shield/photos/{pid}", headers=ALI)
        self.assertEqual(deleted.status_code, 204)
        gone = client.get(f"/api/shield/photos/{pid}", headers=ALI)
        self.assertEqual(gone.status_code, 404)

    def test_non_image_rejected(self):
        resp = client.post(
            "/api/shield/photos",
            files={"file": ("evil.txt", b"not an image", "text/plain")},
            headers=ALI,
        )
        self.assertEqual(resp.status_code, 400)

    def test_oversize_rejected(self):
        big = b"\x89PNG\r\n\x1a\n" + b"\x00" * (5 * 1024 * 1024)
        resp = client.post(
            "/api/shield/photos",
            files={"file": ("big.png", big, "image/png")},
            headers=ALI,
        )
        self.assertEqual(resp.status_code, 413)

    def test_jpeg_exif_stripped(self):
        resp = client.post(
            "/api/shield/photos",
            files={"file": ("photo.jpg", JPEG_EXIF, "image/jpeg")},
            headers=ALI,
        )
        self.assertEqual(resp.status_code, 201, resp.text)
        self.assertTrue(resp.json()["metadata_stripped"])
        pid = resp.json()["id"]
        stored = client.get(f"/api/shield/photos/{pid}", headers=ALI).content
        self.assertNotIn(b"Exif", stored)
        self.assertTrue(stored.startswith(b"\xff\xd8"))


class RateLimitTests(ShieldTestCase):
    def test_request_limit_enforced(self):
        self._profile(ALI, "Alice")
        targets = ["user1", "user2", "user3"]
        for name in targets:
            self._profile({"X-Demo-User": name}, name.title())
        with patch.object(config, "SHIELD_REQUESTS_PER_DAY", 2):
            for name in targets[:2]:
                resp = client.post(
                    "/api/shield/requests",
                    json={"to_user_id": f"demo:{name}"},
                    headers=ALI,
                )
                self.assertEqual(resp.status_code, 201, resp.text)
            limited = client.post(
                "/api/shield/requests",
                json={"to_user_id": "demo:user3"},
                headers=ALI,
            )
            self.assertEqual(limited.status_code, 429)

    def test_message_limit_enforced(self):
        self._connect()
        with patch.object(config, "SHIELD_MESSAGES_PER_HOUR", 1):
            first = client.post(
                "/api/shield/messages",
                json={"to_user_id": "demo:bob", "text": "one"},
                headers=ALI,
            )
            self.assertEqual(first.status_code, 201)
            limited = client.post(
                "/api/shield/messages",
                json={"to_user_id": "demo:bob", "text": "two"},
                headers=ALI,
            )
            self.assertEqual(limited.status_code, 429)

    def test_limiter_unit_sliding_window(self):
        self.assertTrue(rate_limit.check("t", "k", 2, 60))
        self.assertTrue(rate_limit.check("t", "k", 2, 60))
        self.assertFalse(rate_limit.check("t", "k", 2, 60))
        self.assertTrue(rate_limit.check("t", "other", 2, 60))


if __name__ == "__main__":
    unittest.main()
