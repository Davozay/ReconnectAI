"""Pydantic schemas for ReConnect Shield APIs."""

from typing import Literal

from pydantic import BaseModel, Field

ReportCategory = Literal[
    "impersonation", "scam", "harassment", "suspicious_message", "unauthorized_photo"
]
ReportTarget = Literal["user", "message", "photo", "post"]
ReportStatus = Literal["open", "reviewing", "resolved", "dismissed"]
RequestStatus = Literal["pending", "accepted", "declined", "cancelled"]


class ShieldStatus(BaseModel):
    enabled: bool = True
    demo_mode: bool
    admin_configured: bool
    request_limit: int
    message_limit: int


class ProfileUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)
    discoverable: bool = False


class ProfileOut(BaseModel):
    user_id: str
    display_name: str
    discoverable: bool


class DiscoverEntry(BaseModel):
    user_id: str
    display_name: str


class RequestCreate(BaseModel):
    to_user_id: str = Field(min_length=1, max_length=128)
    message: str = Field(default="", max_length=500)


class RequestOut(BaseModel):
    id: str
    from_id: str
    to_id: str
    message: str
    status: str
    created_at: float


class RequestList(BaseModel):
    incoming: list[RequestOut]
    outgoing: list[RequestOut]


class BlockCreate(BaseModel):
    user_id: str = Field(min_length=1, max_length=128)


class BlockList(BaseModel):
    blocked: list[str]


class ReportCreate(BaseModel):
    target_type: ReportTarget
    target_id: str = Field(min_length=1, max_length=128)
    category: ReportCategory
    details: str = Field(default="", max_length=2000)


class ReportOut(BaseModel):
    id: str
    reporter_id: str
    target_type: str
    target_id: str
    category: str
    details: str
    status: str
    created_at: float


class MessageCreate(BaseModel):
    to_user_id: str = Field(min_length=1, max_length=128)
    text: str = Field(min_length=1, max_length=2000)


class ScamWarningOut(BaseModel):
    code: str
    title: str
    detail: str


class MessageOut(BaseModel):
    id: str
    from_id: str
    to_id: str
    text: str
    created_at: float
    warnings: list[ScamWarningOut] = []


class ThreadOut(BaseModel):
    peer_id: str
    messages: list[MessageOut]


class PhotoOut(BaseModel):
    id: str
    owner_id: str
    content_type: str
    bytes: int
    metadata_stripped: bool
    created_at: float


class ScamCheckRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class ScamCheckResponse(BaseModel):
    warnings: list[ScamWarningOut]


class ReportStatusUpdate(BaseModel):
    status: ReportStatus
