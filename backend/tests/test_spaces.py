"""Tests for Modular Facility Space Registry.

Ensures no hardcoded floor assumptions and validates that the space registry functions correctly.
"""

import pytest
from backend.app.config.spaces import (
    REGISTERED_SPACES,
    get_registered_spaces,
    get_space_by_slug,
    get_space_by_device_id,
    get_all_space_slugs,
)


def test_registered_spaces_presence():
    """Verify zero hardcoded spaces on clean reset; dynamic registration works cleanly."""
    from backend.app.config.spaces import register_dynamic_space, unregister_space, reset_to_default_spaces

    reset_to_default_spaces()
    assert get_all_space_slugs() == []

    register_dynamic_space("test_dyn_lab", "Test Dynamic Lab", "ESP32_TEST_DYN_DOOR")
    try:
        slugs = get_all_space_slugs()
        assert "test_dyn_lab" in slugs
    finally:
        unregister_space("test_dyn_lab")


def test_space_metadata_integrity():
    """Verify dynamically registered spaces preserve clean display names without floor descriptions."""
    from backend.app.config.spaces import register_dynamic_space, unregister_space

    register_dynamic_space("robotics_bay", "Robotics Bay", "ESP32_ROBOTICS_BAY_DOOR")
    try:
        spaces = get_registered_spaces()
        assert len(spaces) >= 1

        s0 = get_space_by_slug("robotics_bay")
        assert s0 is not None
        assert s0.name == "Robotics Bay"
        assert s0.esp32_device_id == "ESP32_ROBOTICS_BAY_DOOR"
    finally:
        unregister_space("robotics_bay")


def test_lookup_by_device_id():
    """Verify hardware controller device ID lookups on dynamic spaces."""
    from backend.app.config.spaces import register_dynamic_space, unregister_space

    register_dynamic_space("fab_zone", "Fab Zone", "ESP32_FAB_ZONE_DOOR")
    try:
        space = get_space_by_device_id("ESP32_FAB_ZONE_DOOR")
        assert space is not None
        assert space.slug == "fab_zone"

        non_existent = get_space_by_device_id("ESP32_UNKNOWN_CONTROLLER")
        assert non_existent is None
    finally:
        unregister_space("fab_zone")


@pytest.mark.asyncio
async def test_space_creation_deletion_and_recreation():
    """Verify creating a space without device_id, deleting it completely, and recreating it."""
    from httpx import AsyncClient, ASGITransport
    from backend.app.main import app
    from backend.app.api.deps import create_access_token

    root_token = create_access_token({
        "sub": "rehankuriance@gmail.com",
        "email": "rehankuriance@gmail.com",
        "role": "admin",
        "name": "Rehan Kurian",
        "is_root": True,
        "authorized_spaces": ["all"]
    })

    test_slug = "test_lab_cascade"
    test_name = "Cascade Test Lab"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Clean up first in case test residue exists
        await client.delete(f"/api/v1/spaces/{test_slug}", headers={"Authorization": f"Bearer {root_token}"})

        # 2. Create space without esp32_device_id (auto-generation)
        res = await client.post(
            "/api/v1/spaces",
            json={"slug": test_slug, "name": test_name, "is_active": True},
            headers={"Authorization": f"Bearer {root_token}"}
        )
        assert res.status_code == 201, res.text
        data = res.json()
        assert data["slug"] == test_slug
        assert data["name"] == test_name
        assert data["esp32_device_id"] == f"ESP32_{test_slug.upper()}_DOOR"

        # Verify in memory registry
        assert get_space_by_slug(test_slug) is not None

        # 3. Delete space
        del_res = await client.delete(
            f"/api/v1/spaces/{test_slug}",
            headers={"Authorization": f"Bearer {root_token}"}
        )
        assert del_res.status_code == 200, del_res.text
        assert get_space_by_slug(test_slug) is None

        # 4. Recreate space with the same slug
        recreate_res = await client.post(
            "/api/v1/spaces",
            json={"slug": test_slug, "name": f"{test_name} 2", "is_active": True},
            headers={"Authorization": f"Bearer {root_token}"}
        )
        assert recreate_res.status_code == 201, recreate_res.text
        rec_data = recreate_res.json()
        assert rec_data["slug"] == test_slug
        assert rec_data["esp32_device_id"] == f"ESP32_{test_slug.upper()}_DOOR"

        # 5. Final cleanup
        final_del = await client.delete(
            f"/api/v1/spaces/{test_slug}",
            headers={"Authorization": f"Bearer {root_token}"}
        )
        assert final_del.status_code == 200
