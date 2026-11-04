"""AI Memory Detective routes (live Meta Model API, no mocks).

All AI calls go through :mod:`app.services.meta_client`. When no API key is
configured the endpoints answer 503 with a clear message instead of
fabricating results. This API never performs facial recognition.
"""

import os

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app import config
from app.schemas.detective import (
    ANSWER_JSON_SCHEMA,
    EXTRACTION_JSON_SCHEMA,
    PHOTO_JSON_SCHEMA,
    AnalyzeRequest,
    AnalyzeResponse,
    Clue,
    ConfirmedProfile,
    ConfirmRequest,
    DiscoverResponse,
    ExtractedItem,
    MatchesResponse,
    MemoryExtraction,
    PhotoAnalysis,
    PhotoInfo,
    PhotoResponse,
    RescueAnswerRequest,
    RescueAnswerResponse,
    RescueDiscoverRequest,
    RescueQuestionsRequest,
    RescueQuestionsResponse,
    StatusResponse,
)
from app.services.images import PhotoValidationError, read_validated_photo
from app.services.matcher import normalize, parse_year_range
from app.services.rescue import next_question
from app.services.meta_client import (
    NO_FACE_IDENTITY,
    AIBadResponseError,
    analyze_image_json,
    complete_json,
)

router = APIRouter(prefix="/api/detective", tags=["detective"])

EXTRACTION_SYSTEM = (
    "You extract structured childhood-memory facts for a social reconnection "
    "app. Read the user's note plus the optional nickname, school, and place "
    "fields. Output JSON matching the schema: schools, nicknames, locations, "
    "years (single years like '1998' or ranges like '1996-2001'), "
    "names_mentioned (people named in the note), events, and a one-sentence "
    "summary. Mark each item 'stated' when the user wrote it almost verbatim "
    "and 'inferred' when you guessed, normalized, or expanded it. Prefer fewer "
    "high-confidence items over speculation. Never invent schools, years, or "
    "names that have no basis in the input. " + NO_FACE_IDENTITY
)


def _prompt_from(request: AnalyzeRequest) -> str:
    parts = []
    if request.memory.strip():
        parts.append(f"Memory note: {request.memory.strip()}")
    if request.nickname.strip():
        parts.append(f"Nickname field: {request.nickname.strip()}")
    if request.school.strip():
        parts.append(f"School field: {request.school.strip()}")
    if request.location.strip():
        parts.append(f"Place field: {request.location.strip()}")
    parts.append(
        "A childhood photo was provided separately."
        if request.hasPhoto
        else "No photo was provided; use the text only."
    )
    return "\n".join(parts)


def _clues_from(extraction: MemoryExtraction) -> list[Clue]:
    def source_of(origin: str) -> str:
        return "your note (confirmed)" if origin == "stated" else "AI suggestion"

    clues: list[Clue] = []
    groups = [
        ("School", extraction.schools),
        ("Nickname", extraction.nicknames),
        ("Location", extraction.locations),
        ("Year", extraction.years),
        ("Name mentioned", extraction.names_mentioned),
        ("Event", extraction.events),
    ]
    for label, items in groups:
        for item in items[:3]:
            clues.append(
                Clue(
                    label=label,
                    value=item.value,
                    source=source_of(item.origin),
                )
            )
    return clues


@router.get("/status", response_model=StatusResponse)
def status() -> StatusResponse:
    live = config.ai_configured()
    return StatusResponse(
        configured=live,
        mode="live" if live else "unconfigured",
        text_model=os.environ.get("META_MODEL_TEXT", config.META_MODEL_TEXT),
        vision_model=os.environ.get("META_MODEL_VISION", config.META_MODEL_VISION),
        max_photo_bytes=config.DETECTIVE_MAX_PHOTO_BYTES,
        allowed_photo_types=sorted(config.DETECTIVE_ALLOWED_PHOTO_TYPES),
    )


@router.post("/analyze", response_model=AnalyzeResponse)
def analyze(payload: AnalyzeRequest) -> AnalyzeResponse:
    if not payload.memory.strip() and not payload.nickname.strip():
        return AnalyzeResponse(
            summary="Add a memory or a nickname to analyze.",
            clues=[],
            extraction=MemoryExtraction(),
        )
    parsed = complete_json(
        EXTRACTION_SYSTEM, _prompt_from(payload), EXTRACTION_JSON_SCHEMA
    )
    try:
        extraction = MemoryExtraction.model_validate(parsed)
    except ValidationError as exc:
        raise AIBadResponseError() from exc
    summary = extraction.summary or "Extracted the details below from your note."
    return AnalyzeResponse(
        summary=summary,
        clues=_clues_from(extraction),
        extraction=extraction,
    )


PHOTO_SYSTEM = (
    "You read childhood photographs for a social reconnection app. Accuracy "
    "rules, in order of importance:\n"
    "1. visible_description lists ONLY directly observable details (objects, "
    "setting, clothing, visible text-bearing items). Describe what is there, "
    "never what it might mean.\n"
    "2. extracted_text transcribes text ONLY when it is actually readable in "
    "the image. If no text is readable, return an empty string. Never invent "
    "banner text, signs, or dates.\n"
    "3. Never invent schools, dates, locations, names, or events. A fact goes "
    "in the structured lists ONLY when visible text or the user's own note "
    "supports it; anything else goes in uncertain_observations or is omitted.\n"
    "4. Never infer a photograph's exact year from clothing, cars, photo style, "
    "color, or aging. Years come from visible text or the user's note only.\n"
    "5. possible_context is your best single-guess context (e.g. 'outdoor "
    "school sports event') or null when unsupported. uncertain_observations "
    "holds every interpretation you are unsure about, phrased as uncertainty.\n"
    "6. The user must confirm every clue before it is used; mark 'stated' "
    "only what is literally visible as text, everything else 'inferred' with "
    "an honest confidence.\n"
    "7. Describe scenes and objects, not people. " + NO_FACE_IDENTITY
)


@router.post("/analyze-photo", response_model=PhotoResponse)
async def analyze_photo(
    photo: UploadFile = File(...),
    memory: str = Form(default=""),
    nickname: str = Form(default=""),
) -> PhotoResponse | JSONResponse:
    try:
        data, content_type, dims = await read_validated_photo(photo)
    except PhotoValidationError as exc:
        return JSONResponse(status_code=400, content={"detail": exc.message})

    user_notes = []
    if memory.strip():
        user_notes.append(f"User note: {memory.strip()}")
    if nickname.strip():
        user_notes.append(f"Nickname from user: {nickname.strip()}")
    user_notes.append(
        "Combine the photo with these notes. User-typed facts outrank guesses."
    )
    parsed = analyze_image_json(
        data, content_type, PHOTO_SYSTEM, "\n".join(user_notes), PHOTO_JSON_SCHEMA
    )
    try:
        visible_text = str(parsed.pop("visible_text", "") or "")
        extracted_text = str(parsed.pop("extracted_text", "") or "")
        visible_description = str(parsed.pop("visible_description", "") or "")
        possible_context = parsed.pop("possible_context", None)
        possible_context = str(possible_context) if possible_context else None
        uncertain_raw = parsed.pop("uncertain_observations", []) or []
        extraction = MemoryExtraction.model_validate(parsed)
    except (ValidationError, AttributeError) as exc:
        raise AIBadResponseError() from exc

    text = extracted_text.strip() or visible_text.strip()
    clues = _clues_from(extraction)
    if text:
        clues.insert(
            0,
            Clue(
                label="Visible text",
                value=text[:300],
                source="photo text (confirmed)",
            ),
        )
    width, height = dims if dims else (None, None)
    return PhotoResponse(
        summary=extraction.summary or "Read the details below from your photo.",
        clues=clues,
        extraction=extraction,
        visible_text=text,
        photo=PhotoInfo(
            content_type=content_type, bytes=len(data), width=width, height=height
        ),
        analysis=PhotoAnalysis(
            visible_description=visible_description.strip(),
            extracted_text=text,
            possible_context=possible_context,
            uncertain_observations=[
                str(item).strip() for item in uncertain_raw if str(item).strip()
            ][:10],
            user_confirmation_required=True,
            analysis_source="vision_model",
        ),
    )


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        key = value.strip().lower()
        if key and key not in seen:
            seen.add(key)
            ordered.append(value.strip())
    return ordered


@router.post("/confirm", response_model=ConfirmedProfile)
def confirm(payload: ConfirmRequest) -> ConfirmedProfile:
    """Normalize user-confirmed/corrected clues (stateless, no AI call)."""
    grouped: dict[str, list[str]] = {
        "schools": [],
        "nicknames": [],
        "locations": [],
        "years": [],
        "names_mentioned": [],
        "events": [],
    }
    for item in payload.items:
        if not item.confirmed:
            continue
        value = item.value.strip()
        if not value:
            continue
        if item.kind == "school":
            grouped["schools"].append(value)
        elif item.kind == "nickname":
            grouped["nicknames"].append(value)
        elif item.kind == "location":
            grouped["locations"].append(value)
        elif item.kind == "year":
            grouped["years"].append(value)
        elif item.kind == "name":
            grouped["names_mentioned"].append(value)
        else:
            grouped["events"].append(value)
    return ConfirmedProfile(**{key: _dedupe(vals) for key, vals in grouped.items()})


@router.post("/matches", response_model=MatchesResponse)
def matches(payload: ConfirmedProfile) -> MatchesResponse:
    """Ranked connection suggestions with human-readable explanations.

    Real discovery searches opted-in Supabase profiles. That integration
    has not landed yet, so this route honestly returns no matches rather
    than fictional people. The ranking engine (``find_matches``) stays
    unit-tested and will power this route once Supabase is wired in.
    """
    _ = payload
    return MatchesResponse(
        matches=[],
        note=(
            "Connection discovery is unavailable until Supabase is "
            "connected — there are no real opted-in profiles to search "
            "yet, so no matches are shown instead of invented people."
        ),
    )


@router.post("/discover", response_model=DiscoverResponse)
def discover(payload: ConfirmedProfile) -> DiscoverResponse:
    """Community memories ranked by contextual overlap.

    Real discovery searches shared Supabase memories. That integration
    has not landed yet, so this route honestly returns no memories rather
    than fictional ones. The ranking engine (``find_memories``) stays
    unit-tested and will power this route once Supabase is wired in.
    """
    _ = payload
    return DiscoverResponse(
        items=[],
        note=(
            "Community discovery is unavailable until Supabase is "
            "connected — there are no real shared memories to search "
            "yet, so none are shown instead of invented ones."
        ),
    )


@router.post("/rescue/questions", response_model=RescueQuestionsResponse)
def rescue_questions(payload: RescueQuestionsRequest) -> RescueQuestionsResponse:
    """Next adaptive Memory Rescue question (rule-based, needs no AI key)."""
    return next_question(payload)


RESCUE_TOPIC_KINDS: dict[str, set[str]] = {
    "year": {"year", "clue"},
    "place": {"location", "clue"},
    "school": {"school", "clue"},
    "names": {"name", "nickname"},
    "event": {"event", "clue"},
    "scene": {"clue"},
    "details": {"school", "nickname", "location", "year", "name", "event", "clue"},
}

RESCUE_DIRECT_KIND: dict[str, str] = {
    "year": "year",
    "place": "location",
    "school": "school",
    "names": "name",
    "event": "event",
    "scene": "clue",
    "details": "clue",
}

RESCUE_ANSWER_SYSTEM = (
    "You turn one short user answer into structured memory clues. Extract ONLY "
    "facts the user stated — split lists like 'Jo-Jo, Maya' into separate "
    "items, keep the user's own words, and never invent schools, years, names, "
    "or places. If the answer holds no usable fact, return an empty list. "
    + NO_FACE_IDENTITY
)


@router.post("/rescue/answer", response_model=RescueAnswerResponse)
def rescue_answer(payload: RescueAnswerRequest) -> RescueAnswerResponse:
    """Extract structured clues from one rescue answer (or record a skip)."""
    if payload.skipped or payload.unknown or not payload.value.strip():
        return RescueAnswerResponse(
            items=[],
            source="none",
            note="Skipped — no problem, moving on.",
        )
    if not config.ai_configured():
        kind = RESCUE_DIRECT_KIND[payload.topic]
        value = payload.value.strip()
        if payload.topic == "year" and parse_year_range(value) is None:
            kind = "clue"
        return RescueAnswerResponse(
            items=[
                ExtractedItem(
                    value=value,
                    kind=kind,  # type: ignore[arg-type]
                    origin="stated",
                    confidence="high",
                )
            ],
            source="direct",
            note="Taken directly from your answer (AI unavailable).",
        )
    parsed = complete_json(
        RESCUE_ANSWER_SYSTEM,
        f"Topic: {payload.topic}\nAnswer: {payload.value.strip()}",
        ANSWER_JSON_SCHEMA,
        max_tokens=2000,
    )
    raw_items = parsed.get("items", [])
    if not isinstance(raw_items, list):
        raise AIBadResponseError()
    answer_norm = normalize(payload.value)
    items: list[ExtractedItem] = []
    for raw in raw_items[:10]:
        if not isinstance(raw, dict):
            continue
        value = str(raw.get("value", "")).strip()
        if not value:
            continue
        kind = raw.get("kind")
        if kind not in RESCUE_TOPIC_KINDS[payload.topic]:
            kind = "clue"
        confidence = raw.get("confidence")
        if confidence not in ("high", "medium", "low"):
            confidence = "medium"
        origin = "stated" if normalize(value) in answer_norm else "inferred"
        items.append(
            ExtractedItem(
                value=value,
                kind=kind,  # type: ignore[arg-type]
                origin=origin,  # type: ignore[arg-type]
                confidence=confidence,  # type: ignore[arg-type]
            )
        )
    return RescueAnswerResponse(
        items=items,
        source="ai",
        note="Extracted from your answer — please confirm below.",
    )


@router.post("/rescue/discover", response_model=DiscoverResponse)
def rescue_discover(payload: RescueDiscoverRequest) -> DiscoverResponse:
    """Scene-aware community memory search (never by faces).

    Honestly empty until the Supabase community-sharing integration lands;
    no fictional memories are ever returned.
    """
    _ = payload
    return DiscoverResponse(
        items=[],
        note=(
            "Community discovery is unavailable until Supabase is "
            "connected — there are no real shared memories to search "
            "yet, so none are shown instead of invented ones."
        ),
    )
