"""Shield data stores (in-memory reference implementation).

Holds profiles, reconnection requests, blocks, reports, messages, and photo
metadata for local development. Every accessor is a small function so the
Supabase/Postgres implementation can replace this module without touching
routes. Resets between tests via :func:`reset_all`.
"""

import itertools
import time
from typing import Any

_profiles: dict[str, dict[str, Any]] = {}
_requests: dict[str, dict[str, Any]] = {}
_blocks: set[tuple[str, str]] = set()
_reports: dict[str, dict[str, Any]] = {}
_messages: dict[str, list[dict[str, Any]]] = {}
_photos: dict[str, dict[str, Any]] = {}
_counters = {
    "request": itertools.count(1),
    "report": itertools.count(1),
    "message": itertools.count(1),
    "photo": itertools.count(1),
}


def reset_all() -> None:
    _profiles.clear()
    _requests.clear()
    _blocks.clear()
    _reports.clear()
    _messages.clear()
    _photos.clear()
    for key in _counters:
        _counters[key] = itertools.count(1)


def now() -> float:
    return time.time()


# Profiles: private by default, discoverability is explicit opt-in.
def get_profile(user_id: str) -> dict[str, Any] | None:
    return _profiles.get(user_id)


def upsert_profile(user_id: str, display_name: str, discoverable: bool) -> dict[str, Any]:
    profile = _profiles.get(user_id, {"user_id": user_id})
    profile.update(
        {"display_name": display_name, "discoverable": bool(discoverable)}
    )
    _profiles[user_id] = profile
    return profile


def discoverable_profiles() -> list[dict[str, Any]]:
    return [p for p in _profiles.values() if p.get("discoverable")]


# Reconnection requests.
def create_request(from_id: str, to_id: str, message: str) -> dict[str, Any]:
    rid = f"req-{next(_counters['request'])}"
    record = {
        "id": rid,
        "from_id": from_id,
        "to_id": to_id,
        "message": message,
        "status": "pending",
        "created_at": now(),
    }
    _requests[rid] = record
    return record


def get_request(rid: str) -> dict[str, Any] | None:
    return _requests.get(rid)


def pending_between(a: str, b: str) -> dict[str, Any] | None:
    for record in _requests.values():
        if record["status"] != "pending":
            continue
        pair = {record["from_id"], record["to_id"]}
        if pair == {a, b}:
            return record
    return None


def set_request_status(rid: str, status: str) -> None:
    if rid in _requests:
        _requests[rid]["status"] = status


def requests_for(user_id: str) -> dict[str, list[dict[str, Any]]]:
    incoming = [
        r for r in _requests.values()
        if r["to_id"] == user_id and r["status"] == "pending"
    ]
    outgoing = [
        r for r in _requests.values()
        if r["from_id"] == user_id and r["status"] == "pending"
    ]
    return {"incoming": incoming, "outgoing": outgoing}


def connected(a: str, b: str) -> bool:
    return any(
        r["status"] == "accepted" and {r["from_id"], r["to_id"]} == {a, b}
        for r in _requests.values()
    )


def connections_of(user_id: str) -> list[str]:
    peers = set()
    for record in _requests.values():
        if record["status"] != "accepted":
            continue
        if record["from_id"] == user_id:
            peers.add(record["to_id"])
        elif record["to_id"] == user_id:
            peers.add(record["from_id"])
    return sorted(peers)


# Blocks (directional; enforced both directions for contact).
def add_block(blocker: str, blocked: str) -> None:
    _blocks.add((blocker, blocked))


def remove_block(blocker: str, blocked: str) -> None:
    _blocks.discard((blocker, blocked))


def blocked_by(user_id: str) -> list[str]:
    return sorted(b for (blocker, b) in _blocks if blocker == user_id)


def blocked_either_way(a: str, b: str) -> bool:
    return (a, b) in _blocks or (b, a) in _blocks


# Reports (reporter-visible own; admins see all).
def create_report(
    reporter_id: str, target_type: str, target_id: str, category: str, details: str
) -> dict[str, Any]:
    rid = f"rep-{next(_counters['report'])}"
    record = {
        "id": rid,
        "reporter_id": reporter_id,
        "target_type": target_type,
        "target_id": target_id,
        "category": category,
        "details": details,
        "status": "open",
        "created_at": now(),
    }
    _reports[rid] = record
    return record


def get_report(rid: str) -> dict[str, Any] | None:
    return _reports.get(rid)


def reports_by(reporter_id: str) -> list[dict[str, Any]]:
    return [r for r in _reports.values() if r["reporter_id"] == reporter_id]


def all_reports() -> list[dict[str, Any]]:
    return sorted(_reports.values(), key=lambda r: r["created_at"], reverse=True)


def set_report_status(rid: str, status: str) -> None:
    if rid in _reports:
        _reports[rid]["status"] = status


# Messages (threads keyed by ordered peer pair).
def thread_key(a: str, b: str) -> str:
    return "|".join(sorted([a, b]))


def add_message(from_id: str, to_id: str, text: str) -> dict[str, Any]:
    record = {
        "id": f"msg-{next(_counters['message'])}",
        "from_id": from_id,
        "to_id": to_id,
        "text": text,
        "created_at": now(),
    }
    _messages.setdefault(thread_key(from_id, to_id), []).append(record)
    return record


def thread_messages(a: str, b: str) -> list[dict[str, Any]]:
    return list(_messages.get(thread_key(a, b), []))


# Private photos (bytes held server-side; never public URLs).
def store_photo(
    owner_id: str, content_type: str, data: bytes, stripped: bool
) -> dict[str, Any]:
    pid = f"pic-{next(_counters['photo'])}"
    record = {
        "id": pid,
        "owner_id": owner_id,
        "content_type": content_type,
        "bytes": len(data),
        "data": data,
        "metadata_stripped": stripped,
        "created_at": now(),
    }
    _photos[pid] = record
    return {k: v for k, v in record.items() if k != "data"}


def get_photo(pid: str) -> dict[str, Any] | None:
    return _photos.get(pid)


def delete_photo(pid: str) -> None:
    _photos.pop(pid, None)


def photos_of(owner_id: str) -> list[dict[str, Any]]:
    return [
        {k: v for k, v in record.items() if k != "data"}
        for record in _photos.values()
        if record["owner_id"] == owner_id
    ]
