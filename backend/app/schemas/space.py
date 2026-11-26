"""Facility Space Pydantic Schemas.

Data transfer objects for Facility Space inspection and status queries.
"""

import uuid
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field, field_validator
from backend.app.core.sql_shield import SAFE_DEVICE_ID_RE, SAFE_SLUG_RE, assert_safe_identifier


class AssignedLockSummary(BaseModel):
    """Summary of a hardware door lock assigned to a space."""
    id: uuid.UUID
    device_id: str
    name: str
    is_online: bool = False
    is_disabled: bool = False
    firmware_version: Optional[str] = "1.0.0"
    ip_address: Optional[str] = None
    mac_address: Optional[str] = None
    last_seen_at: Optional[datetime] = None
    last_ping_ms: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


class SpaceBase(BaseModel):
    """Base attributes for a facility space."""
    slug: str = Field(description="Unique system slug (e.g. sandboxx_0)")
    name: str = Field(description="Display name (e.g. SandBoxx 0)")
    esp32_device_id: Optional[str] = Field(default=None, description="Primary IoT controller hardware ID, e.g. ESP32_SANDBOXX_0_DOOR")
    is_active: bool = Field(default=True, description="Whether space is active")


class SpaceCreate(BaseModel):
    """Payload for registering a new facility space / ESP32 controller."""
    slug: str = Field(..., max_length=50, description="Unique system slug, e.g. sandboxx_2")
    name: str = Field(..., max_length=100, description="Display name, e.g. SandBoxx 2")
    lock_name: Optional[str] = Field(default="Main Door", max_length=100, description="Friendly lock name, e.g. Main Door")
    esp32_device_id: Optional[str] = Field(default=None, max_length=100, description="IoT controller hardware ID, e.g. ESP32_SANDBOXX_2_DOOR (auto-generated if omitted)")
    is_active: bool = Field(default=True, description="Whether space is active")

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str) -> str:
        return assert_safe_identifier(v, SAFE_SLUG_RE, "facility space slug").lower()

    @field_validator("esp32_device_id")
    @classmethod
    def validate_device_id(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not v.strip():
            return None
        return assert_safe_identifier(v, SAFE_DEVICE_ID_RE, "ESP32 device ID")


class SpaceUpdate(BaseModel):
    """Payload for updating an existing Facility Space."""
    name: Optional[str] = Field(default=None, max_length=100, description="Display name, e.g. SandBoxx 0")
    is_active: Optional[bool] = Field(default=None, description="Whether space is active and accepting requests")
    esp32_device_id: Optional[str] = Field(default=None, max_length=100, description="Primary IoT controller hardware ID")

    @field_validator("esp32_device_id")
    @classmethod
    def validate_device_id(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not v.strip():
            return None
        return assert_safe_identifier(v, SAFE_DEVICE_ID_RE, "ESP32 device ID")


class SpaceResponse(SpaceBase):
    """Schema returned for facility space queries."""
    id: uuid.UUID = Field(description="Database primary key UUID")
    assigned_devices: List[AssignedLockSummary] = Field(default_factory=list, description="All locks provisioned for this space")

    model_config = ConfigDict(from_attributes=True)


class SpaceStatusResponse(BaseModel):
    """Real-time operational status of a space."""
    slug: str
    name: str
    is_active: bool
    door_locked: bool = Field(default=True, description="Current lock solenoid status")
    active_pin_count: int = Field(default=0, description="Number of currently active valid PINs")
    pending_request_count: int = Field(default=0, description="Number of pending access requests")
