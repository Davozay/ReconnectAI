"""DEMO DATASET — fictional community memories for photo discovery.

Clearly-labeled fixtures until real community sharing lands with Supabase.
No real people, no real photos: ``seed`` drives generative placeholder art,
and matching uses context overlap only (never faces).
"""

from typing import TypedDict


class DemoMemory(TypedDict):
    id: str
    title: str
    author: str
    school: str | None
    place: str | None
    year: str | None
    seed: str
    keywords: list[str]


DEMO_MEMORIES: list[DemoMemory] = [
    {
        "id": "mem-sports98",
        "title": "Sports day finish line",
        "author": "Maya R.",
        "school": "Maplewood Elementary",
        "place": "Riverside",
        "year": "1998",
        "seed": "sports-day",
        "keywords": ["sports", "trophy", "race", "banner"],
    },
    {
        "id": "mem-lanterns",
        "title": "Friday lantern story hour",
        "author": "Daniel O.",
        "school": "St. Anne's High",
        "place": "Riverside",
        "year": "2003",
        "seed": "lanterns",
        "keywords": ["story", "lanterns", "friday", "whitfield"],
    },
    {
        "id": "mem-picnic",
        "title": "Class picnic by the river",
        "author": "Priya S.",
        "school": "Riverside Primary",
        "place": "Riverside",
        "year": "1997",
        "seed": "picnic",
        "keywords": ["picnic", "cake", "river", "blanket"],
    },
    {
        "id": "mem-trophy",
        "title": "The trophy cabinet",
        "author": "Jonah M.",
        "school": "Maplewood Elementary",
        "place": "Riverside",
        "year": "1999",
        "seed": "trophy-close",
        "keywords": ["trophy", "cabinet", "sports", "medal"],
    },
    {
        "id": "mem-boathall",
        "title": "Reading corner boat",
        "author": "Amara T.",
        "school": "Maplewood Elementary",
        "place": "Riverside",
        "year": "2000",
        "seed": "boat-corner",
        "keywords": ["reading", "boat", "corner", "books"],
    },
    {
        "id": "mem-assembly",
        "title": "Morning assembly choir",
        "author": "S. Adeyemi",
        "school": "Riverside Primary",
        "place": "Riverside",
        "year": "1996",
        "seed": "lanterns-choir",
        "keywords": ["choir", "assembly", "morning", "singing"],
    },
    {
        "id": "mem-chess",
        "title": "Chess club finals",
        "author": "Leo K.",
        "school": "Hillcrest Academy",
        "place": "Lakeside",
        "year": "2002",
        "seed": "walk-home",
        "keywords": ["chess", "club", "finals", "trophy"],
    },
    {
        "id": "mem-fair",
        "title": "Winter fair stalls",
        "author": "N. Haddad",
        "school": "Hillcrest Academy",
        "place": "Lakeside",
        "year": "2001",
        "seed": "picnic-winter",
        "keywords": ["winter", "fair", "stalls", "snow"],
    },
]
