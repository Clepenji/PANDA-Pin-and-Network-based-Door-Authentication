"""Log and Audit Pydantic Schemas.

Data transfer schemas for entry logs and system audit records.
"""

import uuid
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from backend.app.models.entry_log import EntryEventType


class EntryLogResponse(BaseModel):
    """Entry log response representing an access attempt or door operation.
    
    Strict UI privacy rule: Never display INVALID_PIN_ATTEMPT entries or raw PIN codes in the UI.
    """
    id: uuid.UUID
    event_type: EntryEventType
    space_id: str
    space_name: Optional[str] = None
    door_name: Optional[str] = None
    device_id: Optional[str] = None
    actor_name: str
    actor_email: str
    authority_name: str
    authority_email: str
    club_name: Optional[str] = None
    justification_snapshot: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
