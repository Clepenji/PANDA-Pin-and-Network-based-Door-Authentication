"""Admin Portal, Analytics, Directory and Cluster Graph Pydantic Schemas.

Defines schemas for Admin management, operational analytics metrics,
SuperUser administration, directory queries, and interactive affiliation cluster graph.
"""

import re
import uuid
from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from backend.app.core.sql_shield import SAFE_SLUG_RE, assert_safe_identifier


class AdminAccountResponse(BaseModel):
    """Secondary administrator representation."""
    id: uuid.UUID
    email: str
    name: str
    is_root: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminCreateRequest(BaseModel):
    """Payload to create an administrator (root or standard)."""
    name: str = Field(min_length=1, max_length=25, description="Administrator name (max 25 characters)")
    email: EmailStr = Field(description="Institutional email address for admin login")
    is_root: bool = Field(default=False, description="Flag indicating if the administrator has root privileges")

    @field_validator("name", mode="before")
    @classmethod
    def truncate_name(cls, v: Any) -> Any:
        if isinstance(v, str):
            return v.strip()[:25]
        return v


class SuperUserCreateRequest(BaseModel):
    """Payload for registering a new SuperUser."""
    name: str = Field(min_length=1, max_length=25, description="SuperUser name (max 25 characters)")
    email: EmailStr
    phone: str = Field(min_length=7, max_length=20)
    college_year: str = Field(default="Not Applicable", description="1st Year, 2nd Year, 3rd Year, 4th Year, Postgraduate, or Not Applicable")
    club_name: Optional[str] = Field(default=None, max_length=25)
    allowed_spaces: List[str] = Field(default_factory=list, description="Facility spaces under this lead's authority")
    note: Optional[str] = Field(default=None, max_length=255, description="Self-declared role title or representative note")

    @field_validator("name", mode="before")
    @classmethod
    def truncate_name(cls, v: Any) -> Any:
        if isinstance(v, str):
            return v.strip()[:25]
        return v

    @field_validator("allowed_spaces")
    @classmethod
    def validate_allowed_spaces(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return None
        return [assert_safe_identifier(s, SAFE_SLUG_RE, "facility space slug") for s in v]

    @field_validator("phone", mode="before")
    @classmethod
    def normalize_phone_number(cls, v: Any) -> Any:
        if isinstance(v, str):
            clean = re.sub(r"[\s\-()]", "", v)
            if re.match(r"^[0-9]{10}$", clean):
                return f"+91{clean}"
            if not clean.startswith("+") and len(clean) >= 10:
                return f"+{clean}"
            return clean
        return v


class SuperUserUpdateRequest(BaseModel):
    """Payload for updating an existing SuperUser."""
    name: Optional[str] = Field(default=None, min_length=1, max_length=25, description="SuperUser name (max 25 characters)")
    phone: Optional[str] = Field(default=None, min_length=7, max_length=20)
    college_year: Optional[str] = None
    club_name: Optional[str] = Field(default=None, max_length=25)
    allowed_spaces: Optional[List[str]] = None
    is_active: Optional[bool] = None
    note: Optional[str] = Field(default=None, max_length=255, description="Self-declared role title or representative note")

    @field_validator("name", mode="before")
    @classmethod
    def truncate_name(cls, v: Any) -> Any:
        if isinstance(v, str):
            return v.strip()[:25]
        return v

    @field_validator("allowed_spaces")
    @classmethod
    def validate_allowed_spaces(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return None
        return [assert_safe_identifier(s, SAFE_SLUG_RE, "facility space slug") for s in v]

    @field_validator("phone", mode="before")
    @classmethod
    def normalize_phone_number(cls, v: Any) -> Any:
        if isinstance(v, str):
            clean = re.sub(r"[\s\-()]", "", v)
            if re.match(r"^[0-9]{10}$", clean):
                return f"+91{clean}"
            if not clean.startswith("+") and len(clean) >= 10:
                return f"+{clean}"
            return clean
        return v


class AdminSuperUserResponse(BaseModel):
    """Full SuperUser representation for administrative overview."""
    id: uuid.UUID
    email: str
    name: str
    phone: str
    college_year: Optional[str] = "Not Applicable"
    club_id: Optional[uuid.UUID] = None
    club_name: Optional[str] = None
    allowed_spaces: List[str] = Field(default_factory=list)
    is_active: bool
    account_tag: Optional[str] = None
    note: Optional[str] = None
    created_at: datetime


class AdminMetricsResponse(BaseModel):
    """Top operational metrics strip for desktop-optimized Admin Portal.

    Strictly contains:
    1. Total registered users
    2. Weekly entries per Facility Space
    3. Average access requests per day
    (Zero active pins or pending requests summary cards).
    """
    total_registered_users: int
    weekly_entries_per_space: Dict[str, int]
    weekly_entries_space_names: Dict[str, str]
    avg_access_requests_per_day: float


class DirectoryMemberResponse(BaseModel):
    """Directory member entry (Users and SuperUsers, excluding Admins)."""
    id: uuid.UUID
    name: str
    email: str
    phone: str
    role: str  # 'user' | 'superuser'
    college_year: Optional[str] = "Not Applicable"
    club_id: Optional[uuid.UUID] = None
    club_name: Optional[str] = None
    spaces: List[str] = Field(default_factory=list)
    assigned_superuser_ids: List[str] = Field(default_factory=list)
    assigned_superusers: List[Dict[str, Any]] = Field(default_factory=list)
    is_active: bool
    account_tag: Optional[str] = None
    note: Optional[str] = None
    created_at: datetime


class ClusterGraphNode(BaseModel):
    """Node in the interactive affiliation cluster graph."""
    id: str
    name: str
    role: str  # 'club' | 'superuser' | 'user'
    college_year: Optional[str] = None
    club_id: Optional[str] = None
    club_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    spaces: List[str] = Field(default_factory=list)
    assigned_superuser_ids: List[str] = Field(default_factory=list)
    assigned_superusers: List[Dict[str, Any]] = Field(default_factory=list)
    is_active: bool = True
    member_count: Optional[int] = None
    note: Optional[str] = None


class ClusterGraphLink(BaseModel):
    """Directed link connecting members/superusers to club centroids."""
    source: str
    target: str
    relation: str  # 'member_of' | 'leads'


class ClusterGraphResponse(BaseModel):
    """Interactive affiliation cluster graph payload (excludes Admins)."""
    nodes: List[ClusterGraphNode]
    links: List[ClusterGraphLink]
