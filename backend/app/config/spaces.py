"""Central Facility Space Registry.

Single source of truth for Facility Spaces supported by PANDA.
Supports dynamic space registration by the Master Root Administrator from the portal
without needing code modifications or server restarts.
"""

from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class FacilitySpaceDefinition(BaseModel):
    """Specification of a registered facility space."""
    slug: str = Field(description="Unique system identifier for the space, e.g. sandboxx_0")
    name: str = Field(description="Display name of the facility space, e.g. SandBoxx 0")
    esp32_device_id: str = Field(description="Unique hardware controller identifier for the door lock")
    is_active: bool = Field(default=True, description="Whether the space is currently enabled for access requests")
    description: Optional[str] = Field(default=None, description="Optional administrative notes for maintenance")


# Central Facility Space Registry Map (populated dynamically from PostgreSQL at startup)
REGISTERED_SPACES: Dict[str, FacilitySpaceDefinition] = {}


def register_dynamic_space(
    slug: str,
    name: str,
    esp32_device_id: str,
    is_active: bool = True,
    description: Optional[str] = None
) -> FacilitySpaceDefinition:
    """Dynamically register or update a facility space definition at runtime."""
    slug_clean = slug.strip().lower()
    space_def = FacilitySpaceDefinition(
        slug=slug_clean,
        name=name.strip(),
        esp32_device_id=esp32_device_id.strip(),
        is_active=is_active,
        description=description,
    )
    REGISTERED_SPACES[slug_clean] = space_def
    return space_def


def unregister_space(slug: str) -> None:
    """Remove a space from the active in-memory registry."""
    slug_clean = slug.strip().lower()
    if slug_clean in REGISTERED_SPACES:
        del REGISTERED_SPACES[slug_clean]


def reset_to_default_spaces() -> None:
    """Clear the active in-memory space registry (zero default spaces on reset)."""
    REGISTERED_SPACES.clear()


def get_registered_spaces() -> List[FacilitySpaceDefinition]:
    """Return an ordered list of all registered facility spaces."""
    return list(REGISTERED_SPACES.values())


def get_space_by_slug(slug: str) -> Optional[FacilitySpaceDefinition]:
    """Retrieve space metadata by its unique slug."""
    return REGISTERED_SPACES.get(slug.strip().lower())


def get_space_by_device_id(device_id: str) -> Optional[FacilitySpaceDefinition]:
    """Retrieve space metadata by hardware controller identifier (ESP32 device ID)."""
    for space in REGISTERED_SPACES.values():
        if space.esp32_device_id == device_id:
            return space
    return None


def get_all_space_slugs() -> List[str]:
    """Return all valid space slugs."""
    return list(REGISTERED_SPACES.keys())
