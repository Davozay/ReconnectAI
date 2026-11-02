"""Contextual matching engine (deterministic, explainable, no biometrics).

Matches a user-confirmed profile against consenting profiles using only
volunteered facts: school names, overlapping years, locations, nicknames,
and shared memory keywords. Output is an ordered list with human-readable
reasons plus a coarse strength band. Internal scores are never exposed, and
nothing here is an identity-verification probability.
"""

import re
import string
from difflib import SequenceMatcher

from app.data.demo_memories import DEMO_MEMORIES
from app.data.demo_profiles import DEMO_PROFILES, DemoProfile
from app.schemas.detective import (
    ConfirmedProfile,
    DiscoverItem,
    MatchCandidate,
    MatchHighlights,
)

_STOPWORDS = frozenset(
    {
        "the", "and", "with", "from", "that", "this", "with", "for", "your",
        "you", "are", "was", "were", "had", "have", "has", "our", "their",
        "them", "they", "then", "than", "when", "what", "who", "into",
        "grade",
    }
)


def normalize(text: str) -> str:
    cleaned = text.lower().translate(str.maketrans("", "", string.punctuation))
    return " ".join(cleaned.split())


def parse_year_range(value: str) -> tuple[int, int] | None:
    """Parse '1998', '1996-2001', '1996 – 2001', or ''98' into (from, to)."""
    text = value.strip().replace("–", "-").replace("—", "-").replace("'", "")
    match = re.fullmatch(r"(\d{2,4})\s*-\s*(\d{2,4})", text)
    if match:
        start, end = (normalize_year(g) for g in match.groups())
        if start is None or end is None:
            return None
        return (min(start, end), max(start, end))
    year = normalize_year(text)
    if year is None:
        return None
    return (year, year)


def normalize_year(token: str) -> int | None:
    token = token.strip()
    if re.fullmatch(r"\d{4}", token):
        year = int(token)
        return year if 1900 <= year <= 2100 else None
    if re.fullmatch(r"\d{2}", token):
        return 1900 + int(token) if int(token) >= 30 else 2000 + int(token)
    return None


def ranges_overlap(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return a[0] <= b[1] and b[0] <= a[1]


def keywords(text: str) -> set[str]:
    return {
        word
        for word in normalize(text).split()
        if len(word) > 3 and word not in _STOPWORDS
    }


def _score_profile(
    seeker: ConfirmedProfile, candidate: DemoProfile
) -> tuple[int, list[str], MatchHighlights]:
    score = 0
    reasons: list[str] = []
    highlights = MatchHighlights()

    seeker_schools = {normalize(s) for s in seeker.schools if s.strip()}
    seeker_years = [
        parsed
        for raw in seeker.years
        if (parsed := parse_year_range(raw)) is not None
    ]
    for school in candidate["schools"]:
        norm = normalize(school["name"])
        if norm in seeker_schools:
            score += 3
            label = school["name"]
            if label not in highlights.schools:
                highlights.schools.append(label)
            span = (school["years_from"], school["years_to"])
            overlap = next(
                (y for y in seeker_years if ranges_overlap(y, span)), None
            )
            if overlap:
                score += 2
                yours = (
                    f"{overlap[0]}"
                    if overlap[0] == overlap[1]
                    else f"{overlap[0]}–{overlap[1]}"
                )
                if yours not in highlights.years:
                    highlights.years.append(yours)
                reasons.append(
                    f"Same school ({label}) with overlapping years "
                    f"({span[0]}–{span[1]} overlaps your {yours})"
                )
            else:
                reasons.append(f"Same school ({label})")
        elif norm and any(
            norm in s or s in norm for s in seeker_schools if s
        ):
            score += 1
            reasons.append(f"Similar school name ({school['name']})")

    seeker_places = {normalize(p) for p in seeker.locations if p.strip()}
    for place in candidate["locations"]:
        if normalize(place) in seeker_places:
            score += 2
            if place not in highlights.places:
                highlights.places.append(place)
            reasons.append(f"Same childhood place ({place})")
            break

    for nick in seeker.nicknames:
        needle = normalize(nick)
        if not needle:
            continue
        for theirs in candidate["nicknames"]:
            them = normalize(theirs)
            if not them:
                continue
            if needle == them:
                score += 2
                if theirs not in highlights.nicknames:
                    highlights.nicknames.append(theirs)
                reasons.append(f"Same nickname ({theirs})")
                break
            if SequenceMatcher(None, needle, them).ratio() >= 0.75:
                score += 1
                if theirs not in highlights.nicknames:
                    highlights.nicknames.append(theirs)
                reasons.append(
                    f"Nickname {theirs!r} resembles your {nick.strip()!r}"
                )
                break

    seeker_words: set[str] = set()
    for event in seeker.events:
        seeker_words |= keywords(event)
    shared: set[str] = set()
    for memory in candidate["memories"]:
        shared |= seeker_words & keywords(memory)
    for word in sorted(shared)[:2]:
        score += 1
        reasons.append(f"Shared memory keyword ({word})")

    return (score, reasons, highlights)


def strength_for(score: int) -> str:
    if score >= 6:
        return "Strong overlap"
    if score >= 3:
        return "Possible"
    return "Worth a look"


def find_matches(
    seeker: ConfirmedProfile, limit: int = 5
) -> list[MatchCandidate]:
    ranked: list[tuple[int, MatchCandidate]] = []
    for candidate in DEMO_PROFILES:
        score, reasons, highlights = _score_profile(seeker, candidate)
        if score <= 0 or not reasons:
            continue
        ranked.append(
            (
                score,
                MatchCandidate(
                    profile_id=candidate["profile_id"],
                    display_name=candidate["display_name"],
                    detail=candidate["detail"],
                    strength=strength_for(score),  # type: ignore[arg-type]
                    reasons=reasons,
                    highlights=highlights,
                ),
            )
        )
    ranked.sort(key=lambda pair: pair[0], reverse=True)
    return [candidate for _, candidate in ranked[:limit]]


def find_memories(
    seeker: ConfirmedProfile,
    limit: int = 6,
    scene_keywords: list[str] | None = None,
) -> list[DiscoverItem]:
    """Community memories ranked by contextual overlap.

    Context only (school, place, era, keywords) — never faces. Demo
    fixtures until real community sharing lands; callers must label them.
    """
    seeker_schools = {normalize(s) for s in seeker.schools if s.strip()}
    seeker_places = {normalize(p) for p in seeker.locations if p.strip()}
    seeker_years = [
        parsed
        for raw in seeker.years
        if (parsed := parse_year_range(raw)) is not None
    ]
    seeker_words: set[str] = set()
    for event in seeker.events:
        seeker_words |= keywords(event)
    for nick in seeker.nicknames:
        seeker_words |= keywords(nick)

    ranked: list[tuple[int, DiscoverItem]] = []
    for memory in DEMO_MEMORIES:
        score = 0
        reasons: list[str] = []
        if memory["school"] and normalize(memory["school"]) in seeker_schools:
            score += 3
            reasons.append(f"Same school ({memory['school']})")
        if memory["place"] and normalize(memory["place"]) in seeker_places:
            score += 2
            reasons.append(f"Same place ({memory['place']})")
        if memory["year"]:
            span = parse_year_range(memory["year"])
            if span and any(ranges_overlap(span, y) for y in seeker_years):
                score += 2
                reasons.append(f"Same era ({memory['year']})")
        shared = seeker_words & {w for k in memory["keywords"] for w in keywords(k)}
        for word in sorted(shared)[:2]:
            score += 1
            reasons.append(f"Shared theme ({word})")
        scene: set[str] = set()
        for raw in scene_keywords or []:
            scene |= keywords(raw)
        for word in sorted(scene & {w for k in memory["keywords"] for w in keywords(k)})[:2]:
            score += 2
            reasons.append(f"Similar scene ({word})")
        if score <= 0:
            continue
        ranked.append(
            (
                score,
                DiscoverItem(
                    id=memory["id"],
                    title=memory["title"],
                    author=memory["author"],
                    school=memory["school"],
                    place=memory["place"],
                    year=memory["year"],
                    seed=memory["seed"],
                    reasons=reasons,
                ),
            )
        )
    ranked.sort(key=lambda pair: pair[0], reverse=True)
    return [item for _, item in ranked[:limit]]
