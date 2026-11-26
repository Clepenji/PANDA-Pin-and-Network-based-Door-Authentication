"""Access Request Pydantic Schemas.

Validates entrant access requests and SuperUser adjudication decisions.
"""

import uuid
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, field_validator
from backend.app.core.sql_shield import SAFE_SLUG_RE, assert_safe_identifier
from backend.app.models.access_request import RequestStatus


class AccessRequestCreate(BaseModel):
    """Schema for submitting an access request to a Facility Space."""
    space_slug: str = Field(max_length=50, description="Target facility space slug (e.g. sandboxx_0)")
    justification: str = Field(
        min_length=1,
        max_length=256,
        description="Mandatory justification for room entry (max 256 chars, non-empty)"
    )
    target_superuser_id: Optional[uuid.UUID] = Field(
        default=None,
        description="Optional explicitly designated supervising lead UUID"
    )

    @field_validator("space_slug")
    @classmethod
    def validate_space_slug(cls, v: str) -> str:
        return assert_safe_identifier(v, SAFE_SLUG_RE, "facility space slug")

    @field_validator("justification")
    @classmethod
    def validate_justification_not_empty(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Justification cannot be empty or purely whitespace.")
        return cleaned


class AccessRequestDecision(BaseModel):
    """Schema for SuperUser approving or rejecting a pending request."""
    status: RequestStatus = Field(description="APPROVED or REJECTED")


class AccessRequestResponse(BaseModel):
    """Full access request response object."""
    id: uuid.UUID
    requester_user_id: uuid.UUID
    requester_email: str
    requester_name: str
    requester_phone: Optional[str] = None
    requester_college_year: Optional[str] = "Not Applicable"
    club_name: Optional[str] = None
    space_id: str
    superuser_id: Optional[uuid.UUID] = None
    justification: str
    status: RequestStatus
    request_type: str = "ACCESS"
    created_at: datetime
    resolved_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
