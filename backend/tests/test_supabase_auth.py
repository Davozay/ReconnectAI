"""Tests for Supabase JWT verification (JWKS + legacy HS256 fallback).

Covers: JWKS fetch/verify with the current asymmetric signing keys, key
rotation refresh, unknown kids, alg=none rejection, issuer/audience/
expiration enforcement, and the legacy HS256 path (strict only when the
expected issuer/audience are known). Network is never touched: JWKS
fetches are patched out.
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
from app.services import shield_auth

client = TestClient(main.app)

SUPABASE_URL = "https://example.supabase.co"
ISSUER = f"{SUPABASE_URL}/auth/v1"
AUDIENCE = "authenticated"

try:
    import jwt as pyjwt
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    _HAVE_JWKS_LIBS = True
except ImportError:  # pragma: no cover - depends on installed extras
    _HAVE_JWKS_LIBS = False


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _hs256(payload: dict, secret: str) -> str:
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = _b64(json.dumps(payload).encode())
    sig = _b64(
        hmac.new(secret.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest()
    )
    return f"{header}.{body}.{sig}"


def _unsigned(payload: dict) -> str:
    header = _b64(json.dumps({"alg": "none", "typ": "JWT"}).encode())
    return f"{header}.{_b64(json.dumps(payload).encode())}."


class SupabaseModeTests(unittest.TestCase):
    def test_url_enables_supabase_mode(self):
        with patch.dict(
            os.environ,
            {"SUPABASE_URL": SUPABASE_URL, "SHIELD_DEMO_MODE": "false"},
        ):
            os.environ.pop("SUPABASE_JWT_SECRET", None)
            from app import config

            self.assertEqual(config.shield_auth_mode(), "supabase")

    def test_jwks_url_enables_supabase_mode(self):
        with patch.dict(
            os.environ,
            {
                "SUPABASE_JWKS_URL": "https://keys.example/jwks.json",
                "SHIELD_DEMO_MODE": "false",
            },
        ):
            os.environ.pop("SUPABASE_URL", None)
            os.environ.pop("SUPABASE_JWT_SECRET", None)
            from app import config

            self.assertEqual(config.shield_auth_mode(), "supabase")


class LegacySecretTests(unittest.TestCase):
    def setUp(self):
        shield_auth.clear_jwks_cache()
        self.addCleanup(shield_auth.clear_jwks_cache)

    def _env(self, **overrides):
        env = {
            "SHIELD_DEMO_MODE": "false",
            "SUPABASE_JWT_SECRET": "s3cret",
        }
        env.update(overrides)
        return patch.dict(os.environ, env)

    def test_legacy_without_project_stays_compatible(self):
        token = _hs256({"sub": "user-1", "exp": time.time() + 600}, "s3cret")
        with self._env():
            os.environ.pop("SUPABASE_URL", None)
            os.environ.pop("SUPABASE_JWKS_URL", None)
            self.assertEqual(
                shield_auth.verify_bearer_token(token), "user-1"
            )

    def test_legacy_with_project_enforces_issuer_and_audience(self):
        good = _hs256(
            {
                "sub": "user-1",
                "exp": time.time() + 600,
                "iss": ISSUER,
                "aud": AUDIENCE,
            },
            "s3cret",
        )
        bad_iss = _hs256(
            {
                "sub": "user-1",
                "exp": time.time() + 600,
                "iss": "https://evil.example/auth/v1",
                "aud": AUDIENCE,
            },
            "s3cret",
        )
        bad_aud = _hs256(
            {
                "sub": "user-1",
                "exp": time.time() + 600,
                "iss": ISSUER,
                "aud": "someone-else",
            },
            "s3cret",
        )
        with self._env(SUPABASE_URL=SUPABASE_URL):
            self.assertEqual(shield_auth.verify_bearer_token(good), "user-1")
            for token in (bad_iss, bad_aud):
                with self.assertRaises(Exception) as ctx:
                    shield_auth.verify_bearer_token(token)
                self.assertEqual(ctx.exception.status_code, 401)


@unittest.skipUnless(_HAVE_JWKS_LIBS, "pyjwt + cryptography required")
class JwksTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = ec.generate_private_key(ec.SECP256R1())
        public = cls.key.public_key()
        numbers = public.public_numbers()
        cls.kid = "test-key-1"
        cls.jwk = {
            "kty": "EC",
            "crv": "P-256",
            "kid": cls.kid,
            "x": _b64(numbers.x.to_bytes(32, "big")),
            "y": _b64(numbers.y.to_bytes(32, "big")),
        }
        cls.private_pem = cls.key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )

    def setUp(self):
        shield_auth.clear_jwks_cache()
        self.addCleanup(shield_auth.clear_jwks_cache)
        self._env = patch.dict(
            os.environ,
            {
                "SHIELD_DEMO_MODE": "false",
                "SUPABASE_URL": SUPABASE_URL,
                "SUPABASE_JWKS_URL": "https://keys.example/jwks.json",
            },
        )
        self._env.start()
        os.environ.pop("SUPABASE_JWT_SECRET", None)
        self.addCleanup(self._env.stop)

    def _token(self, **claims) -> str:
        payload = {"sub": "user-1", "exp": time.time() + 600}
        payload.update(claims)
        return pyjwt.encode(
            payload, self.private_pem, algorithm="ES256", headers={"kid": self.kid}
        )

    def _jwks(self, keys=None):
        return {"keys": keys if keys is not None else [self.jwk]}

    def test_valid_jwks_token_accepted(self):
        token = self._token(iss=ISSUER, aud=AUDIENCE)
        with patch.object(
            shield_auth, "_fetch_jwks", return_value=self._jwks()
        ) as fetch:
            self.assertEqual(shield_auth.verify_bearer_token(token), "user-1")
            # Second call reuses the cache: no refetch.
            self.assertEqual(shield_auth.verify_bearer_token(token), "user-1")
            self.assertEqual(fetch.call_count, 1)

    def test_wrong_issuer_rejected(self):
        token = self._token(iss="https://evil.example/auth/v1", aud=AUDIENCE)
        with patch.object(shield_auth, "_fetch_jwks", return_value=self._jwks()):
            with self.assertRaises(Exception) as ctx:
                shield_auth.verify_bearer_token(token)
            self.assertEqual(ctx.exception.status_code, 401)
            self.assertIn("issuer", str(ctx.exception.detail).lower())

    def test_wrong_audience_rejected(self):
        token = self._token(iss=ISSUER, aud="someone-else")
        with patch.object(shield_auth, "_fetch_jwks", return_value=self._jwks()):
            with self.assertRaises(Exception) as ctx:
                shield_auth.verify_bearer_token(token)
            self.assertEqual(ctx.exception.status_code, 401)
            self.assertIn("audience", str(ctx.exception.detail).lower())

    def test_expired_token_rejected(self):
        token = self._token(
            iss=ISSUER, aud=AUDIENCE, exp=time.time() - 10
        )
        with patch.object(shield_auth, "_fetch_jwks", return_value=self._jwks()):
            with self.assertRaises(Exception) as ctx:
                shield_auth.verify_bearer_token(token)
            self.assertEqual(ctx.exception.status_code, 401)

    def test_tampered_signature_rejected(self):
        token = self._token(iss=ISSUER, aud=AUDIENCE)
        head, body, sig = token.split(".")
        bad_sig = ("A" if not sig.startswith("A") else "B") + sig[1:]
        with patch.object(shield_auth, "_fetch_jwks", return_value=self._jwks()):
            with self.assertRaises(Exception) as ctx:
                shield_auth.verify_bearer_token(f"{head}.{body}.{bad_sig}")
            self.assertEqual(ctx.exception.status_code, 401)

    def test_alg_none_rejected(self):
        token = _unsigned(
            {
                "sub": "user-1",
                "exp": time.time() + 600,
                "iss": ISSUER,
                "aud": AUDIENCE,
            }
        )
        with patch.object(shield_auth, "_fetch_jwks", return_value=self._jwks()):
            with self.assertRaises(Exception) as ctx:
                shield_auth.verify_bearer_token(token)
            self.assertEqual(ctx.exception.status_code, 401)

    def test_unknown_kid_refreshes_once_then_rejects(self):
        other_key = ec.generate_private_key(ec.SECP256R1())
        other_pem = other_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        token = pyjwt.encode(
            {
                "sub": "user-1",
                "exp": time.time() + 600,
                "iss": ISSUER,
                "aud": AUDIENCE,
            },
            other_pem,
            algorithm="ES256",
            headers={"kid": "unknown-kid"},
        )
        with patch.object(
            shield_auth, "_fetch_jwks", return_value=self._jwks()
        ) as fetch:
            with self.assertRaises(Exception) as ctx:
                shield_auth.verify_bearer_token(token)
            self.assertEqual(ctx.exception.status_code, 401)
            # Initial load + one rotation refresh.
            self.assertEqual(fetch.call_count, 2)

    def test_rotation_refresh_picks_up_new_key(self):
        rotated_key = ec.generate_private_key(ec.SECP256R1())
        numbers = rotated_key.public_key().public_numbers()
        rotated_jwk = {
            "kty": "EC",
            "crv": "P-256",
            "kid": "rotated-key",
            "x": _b64(numbers.x.to_bytes(32, "big")),
            "y": _b64(numbers.y.to_bytes(32, "big")),
        }
        rotated_pem = rotated_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        token = pyjwt.encode(
            {
                "sub": "user-1",
                "exp": time.time() + 600,
                "iss": ISSUER,
                "aud": AUDIENCE,
            },
            rotated_pem,
            algorithm="ES256",
            headers={"kid": "rotated-key"},
        )
        calls = {"n": 0}

        def fake_fetch(_url):
            calls["n"] += 1
            if calls["n"] == 1:
                return self._jwks()  # stale cache without the new key
            return self._jwks([self.jwk, rotated_jwk])

        with patch.object(shield_auth, "_fetch_jwks", side_effect=fake_fetch):
            self.assertEqual(shield_auth.verify_bearer_token(token), "user-1")
            self.assertEqual(calls["n"], 2)

    def test_protected_route_accepts_jwks_bearer(self):
        token = self._token(iss=ISSUER, aud=AUDIENCE)
        with patch.object(shield_auth, "_fetch_jwks", return_value=self._jwks()):
            resp = client.patch(
                "/api/shield/profile",
                json={"display_name": "JWKS User", "discoverable": False},
                headers={"Authorization": f"Bearer {token}"},
            )
            self.assertEqual(resp.status_code, 200, resp.text)
            self.assertEqual(resp.json()["user_id"], "user-1")

    def test_protected_route_rejects_bad_issuer(self):
        token = self._token(iss="https://evil.example/auth/v1", aud=AUDIENCE)
        with patch.object(shield_auth, "_fetch_jwks", return_value=self._jwks()):
            resp = client.get(
                "/api/shield/profile/me",
                headers={"Authorization": f"Bearer {token}"},
            )
            self.assertEqual(resp.status_code, 401)


if __name__ == "__main__":
    unittest.main()
