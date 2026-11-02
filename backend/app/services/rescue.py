"""Memory Rescue question engine (deterministic, no AI calls).

Selects the next adaptive follow-up question for photos with insufficient
clues. Rule-based so it works even when the Meta API is unconfigured:
topics already covered by the analysis (or already answered/skipped) are
never asked again, and prompts are personalized with what the user said.
"""

from app.schemas.detective import (
    RescueAnswerGiven,
    RescueProgress,
    RescueQuestion,
    RescueQuestionsRequest,
    RescueQuestionsResponse,
)

# Topic order = most discriminative first. kind coverage from the analysis
# maps onto topics so answered topics are never repeated.
_ORDER = ["year", "place", "school", "names", "event", "scene", "details"]

_KIND_TO_TOPIC = {
    "year": "year",
    "location": "place",
    "school": "school",
    "nickname": "names",
    "name": "names",
    "event": "event",
}

_BASE: dict[str, dict[str, str]] = {
    "year": {
        "prompt": "About when do you think this photo was taken?",
        "hint": "A year or range is perfect — even a rough guess helps.",
        "placeholder": "e.g. 1998, or 1996–2001",
    },
    "place": {
        "prompt": "Which city or neighborhood is this from?",
        "hint": "Where you lived when this photo was taken.",
        "placeholder": "e.g. Riverside",
    },
    "school": {
        "prompt": "Which school is this memory connected to?",
        "hint": "The school you attended around that time.",
        "placeholder": "e.g. Maplewood Elementary",
    },
    "names": {
        "prompt": "Who might be in this photo — names or nicknames?",
        "hint": "First names or childhood nicknames are enough.",
        "placeholder": "e.g. Jo-Jo, Maya",
    },
    "event": {
        "prompt": "What was happening when this was taken?",
        "hint": "A sports day, picnic, assembly, holiday…",
        "placeholder": "e.g. sports day",
    },
    "scene": {
        "prompt": "What objects or scenery stand out in the photo?",
        "hint": "Trophy, banner, field, classroom — anything visible.",
        "placeholder": "e.g. trophy, banner, field",
    },
    "details": {
        "prompt": "Anything else you remember about this moment?",
        "hint": "Smells, sounds, who took the photo — every detail helps.",
        "placeholder": "Anything at all…",
    },
}


def _mentions(answers: list[RescueAnswerGiven], topic: str) -> str:
    for answer in answers:
        if (
            answer.topic == topic
            and not answer.skipped
            and not answer.unknown
            and answer.value.strip()
        ):
            return answer.value.strip()[:60]
    return ""


def _personalize(topic: str, answers: list[RescueAnswerGiven]) -> dict[str, str]:
    base = dict(_BASE[topic])
    place = _mentions(answers, "place")
    school = _mentions(answers, "school")
    year = _mentions(answers, "year")
    if topic == "school" and place:
        base["prompt"] = f"Which school in {place} is this memory from?"
    elif topic == "place" and school:
        base["prompt"] = f"Where was {school} — which city or neighborhood?"
    elif topic == "event" and year:
        base["prompt"] = f"What was happening around {year} in this photo?"
    elif topic == "names" and school:
        base["prompt"] = f"Who from {school} might be in this photo?"
    elif topic == "details" and (place or school):
        where = place or school
        base["prompt"] = f"Anything else about that time in {where}?"
    return base


def next_question(request: RescueQuestionsRequest) -> RescueQuestionsResponse:
    covered = {_KIND_TO_TOPIC[k] for k in request.covered_kinds if k in _KIND_TO_TOPIC}
    handled = {a.topic for a in request.answers} | covered
    remaining = [topic for topic in _ORDER if topic not in handled]
    asked = len(request.answers)

    if not remaining:
        return RescueQuestionsResponse(
            question=None,
            done=True,
            progress=RescueProgress(asked=asked, remaining=0),
            message=(
                "That's everything I wanted to ask — nice work! "
                "Let's search with what we've gathered."
            ),
        )

    topic = remaining[0]
    copy = _personalize(topic, request.answers)
    first = asked == 0
    return RescueQuestionsResponse(
        question=RescueQuestion(
            id=f"rescue-{topic}-{asked + 1}",
            topic=topic,  # type: ignore[arg-type]
            prompt=copy["prompt"],
            hint=copy["hint"],
            placeholder=copy["placeholder"],
        ),
        done=False,
        progress=RescueProgress(asked=asked, remaining=len(remaining)),
        message=(
            "This photo didn't give me much to work with — but that's okay! "
            "I'll ask a few quick questions and we'll figure it out together. "
            "Skip anything you don't remember."
            if first
            else "Got it — one more question."
        ),
    )
