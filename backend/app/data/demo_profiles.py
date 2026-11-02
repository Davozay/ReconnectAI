"""DEMO DATASET — fictional consenting profiles for the matching engine.

Every profile here is invented for development and clearly labeled as demo
data wherever it surfaces. Real Supabase-backed matching replaces this module
in the next milestone; the matcher API stays the same.
"""

from typing import TypedDict


class DemoSchool(TypedDict):
    name: str
    years_from: int
    years_to: int


class DemoProfile(TypedDict):
    profile_id: str
    display_name: str
    detail: str
    schools: list[DemoSchool]
    locations: list[str]
    nicknames: list[str]
    memories: list[str]


DEMO_PROFILES: list[DemoProfile] = [
    {
        "profile_id": "demo-jo",
        "display_name": "J. Mensah",
        "detail": "Maplewood Elementary · 1996–2001 · Riverside",
        "schools": [
            {"name": "Maplewood Elementary", "years_from": 1996, "years_to": 2001}
        ],
        "locations": ["Riverside"],
        "nicknames": ["Jo", "Jo-Jo"],
        "memories": [
            "sports day trophy race",
            "class banner painting",
            "fourth grade classroom",
        ],
    },
    {
        "profile_id": "demo-aw",
        "display_name": "A. Whitfield",
        "detail": "Maplewood Elementary · 1997–2002 · Riverside",
        "schools": [
            {"name": "Maplewood Elementary", "years_from": 1997, "years_to": 2002}
        ],
        "locations": ["Riverside"],
        "nicknames": ["Allie"],
        "memories": ["story hour fridays", "paper lanterns", "reading corner"],
    },
    {
        "profile_id": "demo-sa",
        "display_name": "S. Adeyemi",
        "detail": "Riverside Primary · 1995–2000 · Riverside",
        "schools": [
            {"name": "Riverside Primary", "years_from": 1995, "years_to": 2000}
        ],
        "locations": ["Riverside"],
        "nicknames": ["Sammy"],
        "memories": ["class picnic", "trophy cabinet", "school choir"],
    },
    {
        "profile_id": "demo-to",
        "display_name": "T. Okafor",
        "detail": "St. Anne's High · 2001–2005 · Riverside",
        "schools": [
            {"name": "St. Anne's High", "years_from": 2001, "years_to": 2005}
        ],
        "locations": ["Riverside"],
        "nicknames": ["Tee"],
        "memories": ["story hour fridays", "graduation dance", "morning assembly"],
    },
    {
        "profile_id": "demo-lk",
        "display_name": "L. Kovacs",
        "detail": "Hillcrest Academy · 1999–2004 · Lakeside",
        "schools": [
            {"name": "Hillcrest Academy", "years_from": 1999, "years_to": 2004}
        ],
        "locations": ["Lakeside"],
        "nicknames": ["Leo"],
        "memories": ["chess club", "winter fair", "bicycle race"],
    },
]
