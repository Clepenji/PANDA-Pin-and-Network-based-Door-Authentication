"""Configuration package for PANDA."""
from backend.app.config.settings import settings
from backend.app.config.spaces import (
    REGISTERED_SPACES,
    FacilitySpaceDefinition,
    get_registered_spaces,
    get_space_by_slug,
    get_space_by_device_id,
    get_all_space_slugs,
)

__all__ = [
    "settings",
    "REGISTERED_SPACES",
    "FacilitySpaceDefinition",
    "get_registered_spaces",
    "get_space_by_slug",
    "get_space_by_device_id",
    "get_all_space_slugs",
]
