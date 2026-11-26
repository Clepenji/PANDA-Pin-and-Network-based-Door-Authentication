"""Active PIN Pydantic Schemas.

Data models for active 6-digit access codes and keypad verification payloads.
"""

import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from backend.app.core.sql_shield import (
    SAFE_DEVICE_ID_RE,
    SAFE_SLUG_RE,
    SIX_DIGIT_PIN_RE,
    assert_safe_identifier,
)


class ActivePinResponse(BaseModel):
    """Schema returned to user upon PIN approval."""
    id: uuid.UUID
    pin_code: str = Field(description="6-digit access code")
    space_id: str
    holder_user_id: uuid.UUID
    holder_name: str
    holder_email: str
    issued_by_name: str
    issued_by_email: str
    issued_at: datetime
    expires_at: datetime
    is_revoked: bool
    remaining_seconds: int

    model_config = ConfigDict(from_attributes=True)


class KeypadAttemptRequest(BaseModel):
    """Hardware controller keypad entry submission."""
    device_id: str = Field(max_length=100, description="ESP32 hardware device identifier (e.g. ESP32_SANDBOXX_0_DOOR)")
    pin_code: str = Field(min_length=6, max_length=6, description="6-digit numeric string")

    @field_validator("device_id")
    @classmethod
    def validate_device_id(cls, v: str) -> str:
        return assert_safe_identifier(v, SAFE_DEVICE_ID_RE, "ESP32 device ID")

    @field_validator("pin_code")
    @classmethod
    def validate_pin_code(cls, v: str) -> str:
        return assert_safe_identifier(v, SIX_DIGIT_PIN_RE, "6-digit PIN code")


class KeypadAttemptResponse(BaseModel):
    """Door lock unlock response returned to ESP32."""
    granted: bool
    message: str
    space_slug: Optional[str] = None
    unlock_duration_seconds: int = 5


class DirectPinCreateRequest(BaseModel):
    """Schema for direct PIN generation by SuperUsers or Admins."""
    space_id: str = Field(max_length=50, description="Facility space identifier (e.g. sandboxx_0)")
    entrant_email: EmailStr = Field(description="Email of the entrant receiving the PIN")
    justification: Optional[str] = Field(default="Direct access grant", max_length=256)

    @field_validator("space_id")
    @classmethod
    def validate_space_id(cls, v: str) -> str:
        return assert_safe_identifier(v, SAFE_SLUG_RE, "facility space identifier")


class ESP32SyncPinItem(BaseModel):
    """Individual PIN record returned during ESP32 memory synchronization."""
    pin: str = Field(description="6-digit numeric access PIN")
    expires_at: datetime = Field(description="Timezone-aware expiration timestamp")
    holder_name: str
    holder_email: str


class ESP32SyncResponse(BaseModel):
    """Memory sync payload polled by physical ESP32 or virtual simulator."""
    space_id: str
    synced_at: datetime
    pins: list[ESP32SyncPinItem]


class ESP32EventRequest(BaseModel):
    """Physical keypad entry event submitted by ESP32 WROOM node."""
    space_id: str = Field(max_length=50, description="Facility space identifier (e.g. sandboxx_0)")
    device_id: Optional[str] = Field(default=None, max_length=100, description="Hardware controller identifier, e.g. ESP32_SANDBOXX_0_DOOR")
    pin_entered: str = Field(min_length=6, max_length=6, description="6-digit numeric PIN entered on keypad")
    timestamp: Optional[str] = Field(default=None, max_length=64, description="ISO timestamp of keypad event")
    door_unlocked: bool = Field(default=True, description="Whether door unlock pulse was triggered")

    @field_validator("space_id")
    @classmethod
    def validate_space_id(cls, v: str) -> str:
        return assert_safe_identifier(v, SAFE_SLUG_RE, "facility space identifier")

    @field_validator("device_id")
    @classmethod
    def validate_device_id(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not v.strip():
            return None
        return assert_safe_identifier(v, SAFE_DEVICE_ID_RE, "ESP32 device ID")

    @field_validator("pin_entered")
    @classmethod
    def validate_pin_entered(cls, v: str) -> str:
        return assert_safe_identifier(v, SIX_DIGIT_PIN_RE, "6-digit keypad PIN")


class ESP32EventResponse(BaseModel):
    """Ingestion acknowledgement returned for ESP32 keypad events."""
    status: str
    event_recorded: str
    granted: bool
    message: str
    space_id: str


class RevokePinResponse(BaseModel):
    """Confirmation payload returned upon early PIN revocation."""
    id: uuid.UUID
    pin_code: str
    space_id: str
    revoked_at: datetime
    message: str
