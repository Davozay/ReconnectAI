"""ReConnect Shield: trust, privacy, and anti-scam APIs.

All identity comes from the auth dependency (never from request bodies).
Private resources return generic errors that do not reveal account
existence. Message text is scanned with local heuristics only.
"""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response

from app import config
from app.services import rate_limit, scam_scan, shield_auth, shield_store
from app.services.images import sniff_content_type
from app.schemas.shield import (
    BlockCreate,
    BlockList,
    DiscoverEntry,
    MessageCreate,
    MessageOut,
    PhotoOut,
    ProfileOut,
    ProfileUpdate,
    ReportCreate,
    ReportOut,
    ReportStatusUpdate,
    RequestCreate,
    RequestList,
    RequestOut,
    ScamCheckRequest,
    ScamCheckResponse,
    ScamWarningOut,
    ShieldStatus,
    ThreadOut,
)

router = APIRouter(prefix="/api/shield", tags=["shield"])

_UNAVAILABLE = "User not available."
_MAX_PHOTO_BYTES = 5 * 1024 * 1024
_ALLOWED_PHOTO_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
_DAY = 24 * 3600
_HOUR = 3600


def _rate_limited(bucket: str, user_id: str, limit: int, window: int) -> None:
    if not rate_limit.check(bucket, user_id, limit, window):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Please try again later.",
        )


def _strip_jpeg_app1(data: bytes) -> tuple[bytes, bool]:
    """Drop JPEG APP1 (EXIF) segments; returns (bytes, stripped_any)."""
    if len(data) < 4 or data[0:2] != b"\xff\xd8":
        return data, False
    out = bytearray(data[0:2])
    stripped = False
    pos = 2
    end = len(data)
    try:
        while pos + 4 <= end:
            if data[pos] != 0xFF:
                break
            marker = data[pos + 1]
            if marker == 0xDA:  # start of scan: copy remainder verbatim
                out += data[pos:]
                return bytes(out), stripped
            if marker == 0xD9:  # EOI
                out += data[pos : pos + 2]
                return bytes(out), stripped
            if 0xD0 <= marker <= 0xD7 or marker == 0x01:
                out += data[pos : pos + 2]
                pos += 2
                continue
            seg_len = int.from_bytes(data[pos + 2 : pos + 4], "big")
            if seg_len < 2 or pos + 2 + seg_len > end:
                break
            segment = data[pos : pos + 2 + seg_len]
            if marker == 0xE1:  # APP1/EXIF
                stripped = True
            else:
                out += segment
            pos += 2 + seg_len
        out += data[pos:]
    except IndexError:
        return data, False
    return bytes(out), stripped


@router.get("/status", response_model=ShieldStatus)
def shield_status() -> ShieldStatus:
    return ShieldStatus(
        demo_mode=config.shield_auth_mode() == "demo",
        admin_configured=bool(config.shield_admin_ids()),
        request_limit=config.SHIELD_REQUESTS_PER_DAY,
        message_limit=config.SHIELD_MESSAGES_PER_HOUR,
    )


# -- Profiles & discovery -------------------------------------------------


@router.patch("/profile", response_model=ProfileOut)
def update_profile(
    body: ProfileUpdate,
    user_id: str = Depends(shield_auth.current_user_id),
) -> ProfileOut:
    profile = shield_store.upsert_profile(
        user_id, body.display_name.strip(), body.discoverable
    )
    return ProfileOut(**{k: profile[k] for k in ("user_id", "display_name", "discoverable")})


@router.get("/profile/me", response_model=ProfileOut)
def get_my_profile(
    user_id: str = Depends(shield_auth.current_user_id),
) -> ProfileOut:
    profile = shield_store.get_profile(user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not set up yet.")
    return ProfileOut(**{k: profile[k] for k in ("user_id", "display_name", "discoverable")})


@router.get("/discover", response_model=list[DiscoverEntry])
def discover(
    user_id: str = Depends(shield_auth.current_user_id),
) -> list[DiscoverEntry]:
    _rate_limited("discover", user_id, config.SHIELD_DISCOVER_PER_HOUR, _HOUR)
    results = []
    for profile in shield_store.discoverable_profiles():
        if profile["user_id"] == user_id:
            continue
        if shield_store.blocked_either_way(user_id, profile["user_id"]):
            continue
        results.append(
            DiscoverEntry(user_id=profile["user_id"], display_name=profile["display_name"])
        )
    return results


# -- Reconnection requests ------------------------------------------------


@router.post("/requests", response_model=RequestOut, status_code=201)
def send_request(
    body: RequestCreate,
    user_id: str = Depends(shield_auth.current_user_id),
) -> RequestOut:
    target = body.to_user_id.strip()
    if not target or target == user_id:
        raise HTTPException(status_code=400, detail="Invalid request target.")
    _rate_limited("requests", user_id, config.SHIELD_REQUESTS_PER_DAY, _DAY)
    profile = shield_store.get_profile(target)
    if profile is None or not profile.get("discoverable"):
        # Generic: do not reveal account existence or settings.
        raise HTTPException(status_code=404, detail=_UNAVAILABLE)
    if shield_store.blocked_either_way(user_id, target):
        raise HTTPException(status_code=404, detail=_UNAVAILABLE)
    if shield_store.connected(user_id, target):
        raise HTTPException(status_code=409, detail="Already connected.")
    if shield_store.pending_between(user_id, target):
        raise HTTPException(status_code=409, detail="A request is already pending.")
    record = shield_store.create_request(user_id, target, body.message.strip())
    return RequestOut(**record)


@router.get("/requests", response_model=RequestList)
def list_requests(
    user_id: str = Depends(shield_auth.current_user_id),
) -> RequestList:
    data = shield_store.requests_for(user_id)
    return RequestList(
        incoming=[RequestOut(**r) for r in data["incoming"]],
        outgoing=[RequestOut(**r) for r in data["outgoing"]],
    )


def _own_request_as(rid: str, user_id: str, role: str) -> dict:
    record = shield_store.get_request(rid)
    if record is None or record["status"] != "pending":
        raise HTTPException(status_code=404, detail="Request not found.")
    if record[role] != user_id:
        raise HTTPException(status_code=403, detail="Not your request to act on.")
    return record


@router.post("/requests/{rid}/accept", response_model=RequestOut)
def accept_request(
    rid: str, user_id: str = Depends(shield_auth.current_user_id)
) -> RequestOut:
    record = _own_request_as(rid, user_id, "to_id")
    if shield_store.blocked_either_way(user_id, record["from_id"]):
        raise HTTPException(status_code=404, detail=_UNAVAILABLE)
    shield_store.set_request_status(rid, "accepted")
    updated = shield_store.get_request(rid)
    assert updated is not None
    return RequestOut(**updated)


@router.post("/requests/{rid}/decline", response_model=RequestOut)
def decline_request(
    rid: str, user_id: str = Depends(shield_auth.current_user_id)
) -> RequestOut:
    _own_request_as(rid, user_id, "to_id")
    shield_store.set_request_status(rid, "declined")
    updated = shield_store.get_request(rid)
    assert updated is not None
    return RequestOut(**updated)


@router.post("/requests/{rid}/cancel", response_model=RequestOut)
def cancel_request(
    rid: str, user_id: str = Depends(shield_auth.current_user_id)
) -> RequestOut:
    _own_request_as(rid, user_id, "from_id")
    shield_store.set_request_status(rid, "cancelled")
    updated = shield_store.get_request(rid)
    assert updated is not None
    return RequestOut(**updated)


# -- Blocks ---------------------------------------------------------------


@router.post("/blocks", response_model=BlockList)
def block_user(
    body: BlockCreate,
    user_id: str = Depends(shield_auth.current_user_id),
) -> BlockList:
    target = body.user_id.strip()
    if not target or target == user_id:
        raise HTTPException(status_code=400, detail="Invalid block target.")
    shield_store.add_block(user_id, target)
    pending = shield_store.pending_between(user_id, target)
    if pending:
        shield_store.set_request_status(pending["id"], "cancelled")
    return BlockList(blocked=shield_store.blocked_by(user_id))


@router.delete("/blocks/{target_id}", response_model=BlockList)
def unblock_user(
    target_id: str, user_id: str = Depends(shield_auth.current_user_id)
) -> BlockList:
    shield_store.remove_block(user_id, target_id)
    return BlockList(blocked=shield_store.blocked_by(user_id))


@router.get("/blocks", response_model=BlockList)
def list_blocks(
    user_id: str = Depends(shield_auth.current_user_id),
) -> BlockList:
    return BlockList(blocked=shield_store.blocked_by(user_id))


# -- Reports --------------------------------------------------------------


@router.post("/reports", response_model=ReportOut, status_code=201)
def create_report(
    body: ReportCreate,
    user_id: str = Depends(shield_auth.current_user_id),
) -> ReportOut:
    _rate_limited("reports", user_id, config.SHIELD_REPORTS_PER_DAY, _DAY)
    record = shield_store.create_report(
        user_id, body.target_type, body.target_id.strip(),
        body.category, body.details.strip(),
    )
    return ReportOut(**record)


@router.get("/reports/mine", response_model=list[ReportOut])
def my_reports(
    user_id: str = Depends(shield_auth.current_user_id),
) -> list[ReportOut]:
    return [ReportOut(**r) for r in shield_store.reports_by(user_id)]


@router.get("/admin/reports", response_model=list[ReportOut])
def admin_reports(
    _admin: str = Depends(shield_auth.admin_user_id),
) -> list[ReportOut]:
    return [ReportOut(**r) for r in shield_store.all_reports()]


@router.patch("/admin/reports/{rid}", response_model=ReportOut)
def admin_update_report(
    rid: str,
    body: ReportStatusUpdate,
    _admin: str = Depends(shield_auth.admin_user_id),
) -> ReportOut:
    record = shield_store.get_report(rid)
    if record is None:
        raise HTTPException(status_code=404, detail="Report not found.")
    shield_store.set_report_status(rid, body.status)
    updated = shield_store.get_report(rid)
    assert updated is not None
    return ReportOut(**updated)


# -- Messaging (connected peers only) -------------------------------------


def _thread_or_404(user_id: str, peer: str) -> None:
    if shield_store.blocked_either_way(user_id, peer):
        raise HTTPException(status_code=404, detail=_UNAVAILABLE)
    if not shield_store.connected(user_id, peer):
        raise HTTPException(status_code=403, detail="Connect before messaging.")


@router.post("/messages", response_model=MessageOut, status_code=201)
def send_message(
    body: MessageCreate,
    user_id: str = Depends(shield_auth.current_user_id),
) -> MessageOut:
    peer = body.to_user_id.strip()
    if not peer or peer == user_id:
        raise HTTPException(status_code=400, detail="Invalid message target.")
    _rate_limited("messages", user_id, config.SHIELD_MESSAGES_PER_HOUR, _HOUR)
    _thread_or_404(user_id, peer)
    existing = shield_store.thread_messages(user_id, peer)
    warnings = scam_scan.scan_message(
        body.text, is_new_connection=len(existing) < 3
    )
    record = shield_store.add_message(user_id, peer, body.text)
    return MessageOut(**record, warnings=[ScamWarningOut(**w) for w in warnings])


@router.get("/messages/{peer_id}", response_model=ThreadOut)
def read_thread(
    peer_id: str, user_id: str = Depends(shield_auth.current_user_id)
) -> ThreadOut:
    _thread_or_404(user_id, peer_id)
    messages = []
    for record in shield_store.thread_messages(user_id, peer_id):
        warnings: list[ScamWarningOut] = []
        if record["from_id"] != user_id:
            warnings = [
                ScamWarningOut(**w)
                for w in scam_scan.scan_message(record["text"], is_new_connection=False)
            ]
        messages.append(MessageOut(**record, warnings=warnings))
    return ThreadOut(peer_id=peer_id, messages=messages)


# -- Private photos -------------------------------------------------------


@router.post("/photos", response_model=PhotoOut, status_code=201)
async def upload_photo(
    file: UploadFile = File(...),
    user_id: str = Depends(shield_auth.current_user_id),
) -> PhotoOut:
    _rate_limited("photos", user_id, config.SHIELD_PHOTOS_PER_DAY, _DAY)
    data = await file.read(_MAX_PHOTO_BYTES + 1)
    if len(data) > _MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Photo exceeds 5 MB limit.")
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload.")
    sniffed = sniff_content_type(data)
    if sniffed is None or sniffed not in _ALLOWED_PHOTO_TYPES:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, GIF, or WebP photos.")
    stripped = False
    if sniffed == "image/jpeg":
        data, stripped = _strip_jpeg_app1(data)
    record = shield_store.store_photo(user_id, sniffed, data, stripped)
    return PhotoOut(**record)


@router.get("/photos/{pid}")
def download_photo(
    pid: str, user_id: str = Depends(shield_auth.current_user_id)
) -> Response:
    record = shield_store.get_photo(pid)
    if record is None:
        raise HTTPException(status_code=404, detail="Photo not found.")
    if record["owner_id"] != user_id and user_id not in config.shield_admin_ids():
        raise HTTPException(status_code=403, detail="Not your photo.")
    return Response(content=record["data"], media_type=record["content_type"])


@router.delete("/photos/{pid}", status_code=204)
def delete_photo(
    pid: str, user_id: str = Depends(shield_auth.current_user_id)
) -> None:
    record = shield_store.get_photo(pid)
    if record is None:
        raise HTTPException(status_code=404, detail="Photo not found.")
    if record["owner_id"] != user_id and user_id not in config.shield_admin_ids():
        raise HTTPException(status_code=403, detail="Not your photo.")
    shield_store.delete_photo(pid)
    return None


# -- Composer-side scam pre-check -----------------------------------------


@router.post("/scam-check", response_model=ScamCheckResponse)
def scam_check(
    body: ScamCheckRequest,
    user_id: str = Depends(shield_auth.current_user_id),
) -> ScamCheckResponse:
    _rate_limited("scamcheck", user_id, config.SHIELD_SCAMCHECK_PER_HOUR, _HOUR)
    warnings = scam_scan.scan_message(body.text, is_new_connection=False)
    return ScamCheckResponse(warnings=[ScamWarningOut(**w) for w in warnings])
