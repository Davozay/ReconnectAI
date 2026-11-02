"""Heuristic scam-signal detection for Shield messaging.

Pure local pattern matching — message text is never sent to any external
AI provider. Findings are non-accusatory warnings for the recipient; they
never trigger automatic bans or blocks.
"""

import re
from typing import TypedDict

_MONEY = re.compile(
    r"\b(money|cash|wire|transfer|bank|account|gift\s*card|bitcoin|crypto|"
    r"western\s*union|moneygram|payment|pay\s*me|send\s*\$|\$\s*\d|dollars?)\b",
    re.IGNORECASE,
)
_CREDENTIALS = re.compile(
    r"\b(password|passcode|otp|one-?time|verification\s*code|2fa|pin\s*(code|number)?|"
    r"login|sign-?in\s*(details|info))\b",
    re.IGNORECASE,
)
_URL = re.compile(r"https?://\S+|www\.\S+|\b\S+\.(ru|tk|ml|ga|cf|gq|xyz|top|click|link)\b", re.IGNORECASE)
_PRESSURE = re.compile(
    r"\b(urgent|immediately|right\s*now|asap|don't\s*tell|keep\s*secret|"
    r"emergency|limited\s*time|act\s*fast|tonight\s*only)\b",
    re.IGNORECASE,
)


class ScamWarning(TypedDict):
    code: str
    title: str
    detail: str


def _has_link(text: str) -> bool:
    return bool(_URL.search(text))


def scan_message(text: str, *, is_new_connection: bool) -> list[ScamWarning]:
    """Return zero or more warnings. New connections get a gentle reminder."""
    warnings: list[ScamWarning] = []
    lowered = text.lower()

    asks_money = bool(_MONEY.search(text)) and any(
        verb in lowered
        for verb in ["send", "need", "lend", "borrow", "give", "transfer", "wire", "pay"]
    )
    if asks_money:
        warnings.append(
            {
                "code": "money_request",
                "title": "Money request detected",
                "detail": (
                    "This message asks for money or payment details. Real "
                    "childhood friends rarely open with this — consider "
                    "verifying through another channel before responding."
                ),
            }
        )

    if bool(_CREDENTIALS.search(text)):
        warnings.append(
            {
                "code": "credential_request",
                "title": "Sensitive info request",
                "detail": (
                    "This message asks for passwords, codes, or login details. "
                    "ReConnect will never ask for these, and neither should "
                    "anyone you meet here."
                ),
            }
        )

    if _has_link(text):
        warnings.append(
            {
                "code": "external_link",
                "title": "External link",
                "detail": (
                    "This message contains a link. Check the address carefully "
                    "before opening it, especially from someone you just met."
                ),
            }
        )

    if asks_money and bool(_PRESSURE.search(text)):
        warnings.append(
            {
                "code": "pressure_tactics",
                "title": "High-pressure language",
                "detail": (
                    "Urgency plus a money request is a common scam pattern. "
                    "Take your time — a real friend will understand."
                ),
            }
        )

    if is_new_connection and not warnings:
        warnings.append(
            {
                "code": "new_connection",
                "title": "New connection",
                "detail": (
                    "You recently connected. Keep personal details private "
                    "until trust is established."
                ),
            }
        )
    return warnings
