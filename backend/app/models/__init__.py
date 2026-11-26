"""Models package registering all PANDA database entities.

Imports all declarative models so that Base.metadata contains the complete
normalized schema definition for Alembic migrations and application services.
"""

from backend.app.db.base import Base
from backend.app.models.admin import Admin
from backend.app.models.club import Club
from backend.app.models.superuser import SuperUser
from backend.app.models.user import User
from backend.app.models.assignment import UserSpaceAssignment
from backend.app.models.access_request import AccessRequest, RequestStatus
from backend.app.models.active_pin import ActivePin
from backend.app.models.entry_log import EntryLog, EntryEventType
from backend.app.models.space import Space
from backend.app.models.push_subscription import PushSubscription
from backend.app.models.esp32_device import ESP32Device
from backend.app.models.esp32_outbox import ESP32CommandOutbox
from backend.app.models.esp32_firmware import ESP32FirmwareRelease
from backend.app.models.system_setting import SystemSetting

__all__ = [
    "Base",
    "Admin",
    "Club",
    "SuperUser",
    "User",
    "UserSpaceAssignment",
    "AccessRequest",
    "RequestStatus",
    "ActivePin",
    "EntryLog",
    "EntryEventType",
    "Space",
    "PushSubscription",
    "ESP32Device",
    "ESP32CommandOutbox",
    "ESP32FirmwareRelease",
    "SystemSetting",
]
