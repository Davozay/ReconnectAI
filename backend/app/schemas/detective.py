"""Pydantic contracts for the AI Memory Detective.

Every AI-produced value carries ``origin`` (was it stated by the user or
inferred by the model?) and ``confidence``, so the frontend can always
distinguish confirmed information from AI-generated suggestions.
"""

from typing import Literal

from pydantic import BaseModel, Field

Origin = Literal["stated", "inferred"]
Confidence = Literal["high", "medium", "low"]
ItemKind = Literal[
    "school", "nickname", "location", "year", "name", "event", "clue"
]


class ExtractedItem(BaseModel):
    value: str = Field(min_length=1, max_length=200)
    kind: ItemKind
    origin: Origin = "inferred"
    confidence: Confidence = "medium"


class MemoryExtraction(BaseModel):
    schools: list[ExtractedItem] = Field(default_factory=list)
    nicknames: list[ExtractedItem] = Field(default_factory=list)
    locations: list[ExtractedItem] = Field(default_factory=list)
    years: list[ExtractedItem] = Field(default_factory=list)
    names_mentioned: list[ExtractedItem] = Field(default_factory=list)
    events: list[ExtractedItem] = Field(default_factory=list)
    summary: str = Field(default="", max_length=1000)


class Clue(BaseModel):
    label: str
    value: str
    source: str


class AnalyzeRequest(BaseModel):
    memory: str = Field(default="", max_length=4000)
    nickname: str = Field(default="", max_length=120)
    school: str = Field(default="", max_length=200)
    location: str = Field(default="", max_length=200)
    hasPhoto: bool = False


class AnalyzeResponse(BaseModel):
    summary: str
    clues: list[Clue]
    extraction: MemoryExtraction


class StatusResponse(BaseModel):
    configured: bool
    mode: Literal["live", "unconfigured"]
    text_model: str
    vision_model: str
    max_photo_bytes: int
    allowed_photo_types: list[str]


class ConfirmedItem(BaseModel):
    kind: ItemKind
    value: str = Field(min_length=1, max_length=200)
    confirmed: bool = True


class ConfirmRequest(BaseModel):
    items: list[ConfirmedItem] = Field(max_length=100)


class ConfirmedProfile(BaseModel):
    """Normalized user-confirmed facts used for matching (stateless)."""

    schools: list[str] = Field(default_factory=list)
    nicknames: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    years: list[str] = Field(default_factory=list)
    names_mentioned: list[str] = Field(default_factory=list)
    events: list[str] = Field(default_factory=list)


class MatchHighlights(BaseModel):
    """Structured matched dimensions (powers badges/cards; no scores)."""

    schools: list[str] = Field(default_factory=list)
    places: list[str] = Field(default_factory=list)
    years: list[str] = Field(default_factory=list)
    nicknames: list[str] = Field(default_factory=list)


class MatchCandidate(BaseModel):
    profile_id: str
    display_name: str
    detail: str
    strength: Literal["Strong overlap", "Possible", "Worth a look"]
    reasons: list[str]
    highlights: MatchHighlights = Field(default_factory=MatchHighlights)


class DiscoverItem(BaseModel):
    id: str
    title: str
    author: str
    school: str | None = None
    place: str | None = None
    year: str | None = None
    seed: str
    reasons: list[str] = Field(default_factory=list)


class DiscoverResponse(BaseModel):
    items: list[DiscoverItem]
    note: str


RescueTopic = Literal[
    "year", "place", "school", "names", "event", "scene", "details"
]


class RescueAnswerGiven(BaseModel):
    topic: RescueTopic
    value: str = ""
    skipped: bool = False
    unknown: bool = False


class RescueQuestionsRequest(BaseModel):
    covered_kinds: list[str] = Field(default_factory=list)
    answers: list[RescueAnswerGiven] = Field(default_factory=list)


class RescueQuestion(BaseModel):
    id: str
    topic: RescueTopic
    prompt: str
    hint: str
    placeholder: str


class RescueProgress(BaseModel):
    asked: int
    remaining: int


class RescueQuestionsResponse(BaseModel):
    question: RescueQuestion | None
    done: bool
    progress: RescueProgress
    message: str


class RescueAnswerRequest(BaseModel):
    topic: RescueTopic
    value: str = Field(default="", max_length=1000)
    skipped: bool = False
    unknown: bool = False


class RescueAnswerResponse(BaseModel):
    items: list[ExtractedItem] = Field(default_factory=list)
    source: Literal["ai", "direct", "none"]
    note: str


class RescueDiscoverRequest(BaseModel):
    profile: ConfirmedProfile
    scene_objects: list[str] = Field(default_factory=list)
    scene_setting: str = ""


ANSWER_JSON_SCHEMA: dict = {
    "name": "rescue_answer",
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "value": {"type": "string"},
                    "kind": {
                        "type": "string",
                        "enum": [
                            "school",
                            "nickname",
                            "location",
                            "year",
                            "name",
                            "event",
                            "clue",
                        ],
                    },
                    "confidence": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                    },
                },
                "required": ["value", "kind", "confidence"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}


class MatchesResponse(BaseModel):
    matches: list[MatchCandidate]
    note: str


class PhotoInfo(BaseModel):
    content_type: str
    bytes: int
    width: int | None = None
    height: int | None = None


class PhotoExtraction(BaseModel):
    visible_text: str = Field(default="", max_length=2000)
    extraction: MemoryExtraction = Field(default_factory=MemoryExtraction)


AnalysisSource = Literal["vision_model", "ocr", "user_input"]


class PhotoAnalysis(BaseModel):
    """Grounded photo reading: observed facts separated from uncertainty."""

    visible_description: str = Field(default="", max_length=2000)
    extracted_text: str = Field(default="", max_length=2000)
    possible_context: str | None = Field(default=None, max_length=500)
    uncertain_observations: list[str] = Field(default_factory=list)
    user_confirmation_required: bool = True
    analysis_source: AnalysisSource


class PhotoResponse(BaseModel):
    summary: str
    clues: list[Clue]
    extraction: MemoryExtraction
    visible_text: str = ""
    photo: PhotoInfo
    analysis: PhotoAnalysis


PHOTO_JSON_SCHEMA: dict = {
    "name": "photo_extraction",
    "type": "object",
    "properties": {
        "visible_text": {
            "type": "string",
            "description": "Deprecated alias of extracted_text; keep identical.",
        },
        "visible_description": {
            "type": "string",
            "description": "Only directly observable details: objects, setting, visible text-bearing items. No guesses.",
        },
        "extracted_text": {
            "type": "string",
            "description": "Exact transcription of text visible in the photo, or empty string when none is readable.",
        },
        # Strict json_schema mode has no union types: unknown context is an
        # empty string here (the route maps "" back to None for the API).
        "possible_context": {
            "type": "string",
            "description": "Best-guess context (e.g. 'school sports event') or empty string when unsupported.",
        },
        "uncertain_observations": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Interpretations that are uncertain; never stated as fact.",
        },
        "schools": {
            "type": "array",
            "items": {"$ref": "#/$defs/item"},
        },
        "nicknames": {"type": "array", "items": {"$ref": "#/$defs/item"}},
        "locations": {"type": "array", "items": {"$ref": "#/$defs/item"}},
        "years": {"type": "array", "items": {"$ref": "#/$defs/item"}},
        "names_mentioned": {
            "type": "array",
            "items": {"$ref": "#/$defs/item"},
        },
        "events": {"type": "array", "items": {"$ref": "#/$defs/item"}},
        "summary": {"type": "string"},
    },
    "required": [
        "visible_text",
        "visible_description",
        "extracted_text",
        "possible_context",
        "uncertain_observations",
        "schools",
        "nicknames",
        "locations",
        "years",
        "names_mentioned",
        "events",
        "summary",
    ],
    "additionalProperties": False,
    "$defs": {
        "item": {
            "type": "object",
            "properties": {
                "value": {"type": "string"},
                "kind": {
                    "type": "string",
                    "enum": [
                        "school",
                        "nickname",
                        "location",
                        "year",
                        "name",
                        "event",
                        "clue",
                    ],
                },
                "origin": {"type": "string", "enum": ["stated", "inferred"]},
                "confidence": {
                    "type": "string",
                    "enum": ["high", "medium", "low"],
                },
            },
            "required": ["value", "kind", "origin", "confidence"],
            "additionalProperties": False,
        }
    },
}


EXTRACTION_JSON_SCHEMA: dict = {
    "name": "memory_extraction",
    "type": "object",
    "properties": {
        "schools": {
            "type": "array",
            "items": {"$ref": "#/$defs/item"},
        },
        "nicknames": {"type": "array", "items": {"$ref": "#/$defs/item"}},
        "locations": {"type": "array", "items": {"$ref": "#/$defs/item"}},
        "years": {"type": "array", "items": {"$ref": "#/$defs/item"}},
        "names_mentioned": {
            "type": "array",
            "items": {"$ref": "#/$defs/item"},
        },
        "events": {"type": "array", "items": {"$ref": "#/$defs/item"}},
        "summary": {"type": "string"},
    },
    "required": [
        "schools",
        "nicknames",
        "locations",
        "years",
        "names_mentioned",
        "events",
        "summary",
    ],
    "additionalProperties": False,
    "$defs": {
        "item": {
            "type": "object",
            "properties": {
                "value": {"type": "string"},
                "kind": {
                    "type": "string",
                    "enum": [
                        "school",
                        "nickname",
                        "location",
                        "year",
                        "name",
                        "event",
                        "clue",
                    ],
                },
                "origin": {"type": "string", "enum": ["stated", "inferred"]},
                "confidence": {
                    "type": "string",
                    "enum": ["high", "medium", "low"],
                },
            },
            "required": ["value", "kind", "origin", "confidence"],
            "additionalProperties": False,
        }
    },
}
