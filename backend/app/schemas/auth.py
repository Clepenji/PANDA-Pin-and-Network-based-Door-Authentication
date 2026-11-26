"""Authentication and User Profile Pydantic Schemas.

Handles passwordless email login, role determination (Admin, SuperUser, User),
account tagging (New/Old during July 15 - September 1 window), and pre-reset warning banners.
"""

import uuid
from typing import Optional, List, Any
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, field_validator
from backend.app.core.sql_shield import SAFE_SLUG_RE, assert_safe_identifier


class EmailLoginRequest(BaseModel):
    """Payload for submitting institutional email address for authentication."""
    email: EmailStr = Field(description="Entrant, SuperUser, or Admin institutional email")


class TokenResponse(BaseModel):
    """JWT bearer token response returned after successful authentication."""
    access_token: str
    token_type: str = "bearer"
    role: str = Field(description="'admin', 'superuser', or 'user'")
    email: str
    name: str
    phone: Optional[str] = None
    club_name: Optional[str] = None
    is_root: bool = False
    authorized_spaces: List[str] = Field(default_factory=list, description="Slugs of spaces this entity governs")
    account_tag: Optional[str] = Field(default=None, description="'New' or 'Old' (only between July 15 and September 1)")
    college_year: Optional[str] = Field(default="Not Applicable", description="College year level")
    note: Optional[str] = Field(default=None, description="Self-declared role title or representative note")


class UserProfileResponse(BaseModel):
    """Current authenticated actor profile information."""
    id: uuid.UUID
    email: str
    name: str
    phone: Optional[str] = None
    role: str
    is_root: bool = False
    club_name: Optional[str] = None
    authorized_spaces: List[str] = Field(default_factory=list)
    created_at: datetime
    account_tag: Optional[str] = Field(default=None, description="'New' or 'Old' during July 15 - Sept 1, else null")
    college_year: Optional[str] = Field(default="Not Applicable")
    note: Optional[str] = Field(default=None, description="Self-declared role title or representative note")


class PreResetWarningResponse(BaseModel):
    """Annual lifecycle warning status active from August 25 through August 31."""
    is_warning_active: bool
    warning_message: Optional[str] = None


class UserRegisterRequest(BaseModel):
    """Onboarding registration schema for new users or revoked SuperUsers."""
    email: EmailStr = Field(description="Institutional email address")
    name: str = Field(min_length=1, max_length=25, description="Entrant name (max 25 characters)")
    phone: str = Field(min_length=7, max_length=20, description="Mobile number with country code")
    college_year: str = Field(default="Not Applicable", description="1st Year, 2nd Year, 3rd Year, 4th Year, Postgraduate, or Not Applicable")
    club_name: Optional[str] = Field(default=None, max_length=25, description="Selected or newly created club name")
    space_id: Optional[str] = Field(default=None, description="One initial Facility Space to register (optional if 0 spaces exist)")
    assigned_superuser_id: Optional[uuid.UUID] = Field(default=None, description="Assigned SuperUser ID")
    note: Optional[str] = Field(default=None, max_length=255, description="Self-declared role title or representative note")
    oauth_registration_token: Optional[str] = Field(default=None, description="Signed Google OAuth verification token (enforced in OAuth mode)")

    @field_validator("name", mode="before")
    @classmethod
    def truncate_name(cls, v: Any) -> Any:
        if isinstance(v, str):
            return v.strip()[:25]
        return v

    @field_validator("space_id")
    @classmethod
    def validate_space_id(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not v.strip():
            return None
        return assert_safe_identifier(v, SAFE_SLUG_RE, "facility space identifier")


class UserProfileUpdateRequest(BaseModel):
    """Schema for updating entrant profile details via settings drawer."""
    name: Optional[str] = Field(default=None, min_length=1, max_length=25, description="Entrant name (max 25 characters)")

    @field_validator("name", mode="before")
    @classmethod
    def truncate_name(cls, v: Any) -> Any:
        if isinstance(v, str):
            return v.strip()[:25]
        return v
    phone: Optional[str] = Field(default=None, min_length=7, max_length=20)
    college_year: Optional[str] = Field(default=None, description="1st Year, 2nd Year, 3rd Year, 4th Year, Postgraduate, or Not Applicable")
    club_name: Optional[str] = Field(default=None, max_length=25)
    note: Optional[str] = Field(default=None, max_length=255, description="Self-declared role title or representative note")


class SuperUserInfoResponse(BaseModel):
    """SuperUser metadata provided for assignment dropdowns (SuperUser Name — Club Name)."""
    id: uuid.UUID
    name: str
    email: str
    phone: str
    club_name: Optional[str] = None
    allowed_spaces: List[str] = Field(default_factory=list)
    college_year: Optional[str] = Field(default="Not Applicable")
    note: Optional[str] = Field(default=None, description="Self-declared role title or representative note")


class ClubResponse(BaseModel):
    """Campus club/organization record."""
    id: uuid.UUID
    name: str


class ActivePinSummary(BaseModel):
    """Publicly safe summary of an active PIN with expiry timestamp (no unmasked PIN digits for privacy)."""
    id: uuid.UUID
    pin_code: Optional[str] = None
    expires_at: datetime
    valid_till: str


class PendingRequestSummary(BaseModel):
    """Summary of a pending access request for visual pulsing."""
    id: uuid.UUID
    justification: str
    created_at: datetime


class UserSpaceCardResponse(BaseModel):
    """Floating card payload for user dashboard."""
    space_id: str
    space_name: str
    assigned_superuser_id: Optional[uuid.UUID] = None
    assigned_superuser_name: Optional[str] = None
    assigned_superuser_phone: Optional[str] = None
    active_pin: Optional[ActivePinSummary] = None
    pending_request: Optional[PendingRequestSummary] = None
    status: str = "APPROVED"


class UserSpaceAssignmentCreate(BaseModel):
    """Schema for registering additional facility spaces from dashboard."""
    space_id: str = Field(max_length=50)
    assigned_superuser_id: Optional[uuid.UUID] = None

    @field_validator("space_id")
    @classmethod
    def validate_space_id(cls, v: str) -> str:
        return assert_safe_identifier(v, SAFE_SLUG_RE, "facility space identifier")


class UserSpaceAssignmentUpdate(BaseModel):
    """Schema for switching assigned superuser for a facility space."""
    assigned_superuser_id: Optional[uuid.UUID] = None


class ActiveKeySummaryResponse(BaseModel):
    """Privacy-compliant active PIN summary for SuperUser Active Keys tab (raw PIN omitted)."""
    id: uuid.UUID
    holder_name: str
    holder_email: str
    space_id: str
    space_name: str
    expires_at: datetime
    valid_till: str
    account_tag: Optional[str] = None
    can_revoke: bool = True
