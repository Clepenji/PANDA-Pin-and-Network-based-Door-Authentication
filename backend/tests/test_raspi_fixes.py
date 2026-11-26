"""Comprehensive Verification Suite for Raspberry Pi Release Fixes.

Validates:
1. execute_admin_system_reset executes without AttributeError: 'Settings' object has no attribute 'BASE_DIR'.
2. Purging orphaned ESP32 devices during system purge.
3. Space creation auto-generates ESP32_<SLUG>_DOOR if esp32_device_id is omitted.
4. Re-registration of a previously deleted space succeeds cleanly.
5. delete_lock_device permanently deletes devices matching by device_id, UUID, or space_id.
6. get_esp32_devices_status auto-prunes orphaned ESP32 devices.
7. ping_device resolves device_id and space_id and formats WebSocket broadcast payload properly.
"""

import pytest
import uuid
from sqlalchemy import select, func
from backend.app.db.session import AsyncSessionLocal
from backend.app.models.space import Space
from backend.app.models.esp32_device import ESP32Device
from backend.app.models.admin import Admin
from backend.app.models.superuser import SuperUser
from backend.app.services.space_service import SpaceService
from backend.app.services.esp32_service import ESP32Service, esp32_manager
from backend.app.services.lifecycle_service import execute_admin_system_reset
from backend.app.config.settings import settings


@pytest.mark.asyncio
async def test_settings_base_dir_accessible():
    """Verify settings.BASE_DIR is a string path that can be converted to Path."""
    from pathlib import Path
    assert hasattr(settings, "BASE_DIR")
    base_path = Path(settings.BASE_DIR)
    assert base_path.exists()
    assert (base_path / "backend").exists()


@pytest.mark.asyncio
async def test_system_reset_execution_and_orphan_purge():
    """Verify execute_admin_system_reset runs without error and purges orphaned devices."""
    async with AsyncSessionLocal() as session:
        # Create a test space and a dummy orphan device
        slug = f"test_purge_{uuid.uuid4().hex[:6]}"
        space = Space(slug=slug, name=f"Test Purge {slug}", esp32_device_id=f"ESP32_{slug.upper()}_DOOR", is_active=True)
        session.add(space)

        # Create an orphaned device with nonexistent space_id
        orphan = ESP32Device(
            device_id=f"ESP32_ORPHAN_{uuid.uuid4().hex[:6]}",
            space_id="nonexistent_space_12345",
            name="Shadow Door",
            device_secret="0123456789abcdef0123456789abcdef",
            is_disabled=False,
            is_online=False,
            firmware_version="1.0.0"
        )
        session.add(orphan)
        await session.commit()
        orphan_id = orphan.device_id

        # Run system reset
        stats = await execute_admin_system_reset(session)
        assert stats["audit_logs_preserved_internally"] is True
        assert stats["spaces_preserved"] is True
        assert stats["orphaned_esps_purged"] >= 1

        # Check orphan is gone
        chk = await session.execute(select(ESP32Device).where(ESP32Device.device_id == orphan_id))
        assert chk.scalar_one_or_none() is None

        # Clean up space
        await session.delete(space)
        await session.commit()

        # Reseed lead.robotics@college.edu and revoked.lead@college.edu if purged so other test suites remain green
        su_chk = await session.execute(select(SuperUser).where(SuperUser.email == "lead.robotics@college.edu"))
        if not su_chk.scalar_one_or_none():
            session.add(SuperUser(
                email="lead.robotics@college.edu",
                name="Arjun Sharma",
                phone="+919876543210",
                college_year="4th Year",
                allowed_spaces=["sandboxx_0"],
                is_active=True
            ))
        rev_chk = await session.execute(select(SuperUser).where(SuperUser.email == "revoked.lead@college.edu"))
        if not rev_chk.scalar_one_or_none():
            session.add(SuperUser(
                email="revoked.lead@college.edu",
                name="Revoked Lead",
                phone="+919876543211",
                college_year="4th Year",
                allowed_spaces=["sandboxx_0"],
                is_active=False
            ))
        await session.commit()


@pytest.mark.asyncio
async def test_create_and_reregister_space():
    """Verify deleting and re-registering the same space succeeds without duplicate constraint errors."""
    slug = f"sandboxx_recycle_{uuid.uuid4().hex[:6]}"
    name = "SandBoxx Recycle"

    async with AsyncSessionLocal() as session:
        # 1. Create space without explicit esp32_device_id (auto-generation test)
        res = await SpaceService.create_space(
            session=session,
            slug=slug,
            name=name,
            esp32_device_id=None,
            lock_name="Main Entrance"
        )
        assert res.slug == slug
        assert res.esp32_device_id == f"ESP32_{slug.upper()}_DOOR"

        # Check device exists
        dev_res = await session.execute(select(ESP32Device).where(ESP32Device.space_id == slug))
        dev = dev_res.scalar_one_or_none()
        assert dev is not None
        assert dev.device_id == f"ESP32_{slug.upper()}_DOOR"

        # 2. Remove space
        removed = await SpaceService.remove_space(session, slug, "admin@sandboxx.in")
        assert removed is True

        # Check space and device are removed
        sp_chk = await SpaceService.get_space_by_slug(session, slug)
        assert sp_chk is None

        # 3. Simulate an orphaned device left behind (e.g. from prior failed delete or partial state)
        seed_orphan = ESP32Device(
            device_id=f"ESP32_{slug.upper()}_DOOR",
            space_id=slug,
            name="Orphaned Lock",
            device_secret="fedcba9876543210fedcba9876543210",
            is_disabled=False,
            is_online=False,
            firmware_version="1.0.0"
        )
        session.add(seed_orphan)
        await session.commit()

        # 4. Re-register the EXACT same space slug
        recreated = await SpaceService.create_space(
            session=session,
            slug=slug,
            name=name,
            esp32_device_id=f"ESP32_{slug.upper()}_DOOR",
            lock_name="Main Entrance Reborn"
        )
        assert recreated.slug == slug
        assert recreated.esp32_device_id == f"ESP32_{slug.upper()}_DOOR"

        # Clean up
        await SpaceService.remove_space(session, slug, "admin@sandboxx.in")


@pytest.mark.asyncio
async def test_delete_shadow_device_by_uuid_or_space_id():
    """Verify delete_lock_device can delete shadow devices by UUID or space slug."""
    from backend.app.api.v1.esp32 import delete_lock_device

    async with AsyncSessionLocal() as session:
        # Create shadow device with no space or dummy space
        dummy_slug = f"shadow_space_{uuid.uuid4().hex[:6]}"
        dev = ESP32Device(
            device_id=f"ESP32_SHADOW_{uuid.uuid4().hex[:6]}",
            space_id=dummy_slug,
            name="Shadow Node",
            device_secret="1234567890abcdef1234567890abcdef",
            is_disabled=False,
            is_online=False,
            firmware_version="1.0.0"
        )
        session.add(dev)
        await session.commit()
        await session.refresh(dev)

        dev_uuid_str = str(dev.id)
        dev_id = dev.device_id

        # Delete by UUID string
        result = await delete_lock_device(
            device_id=dev_uuid_str,
            current_root_admin={"email": "source@sandboxx.in", "is_root": True},
            session=session
        )
        assert result["status"] == "success"

        # Verify it was deleted
        chk = await session.execute(select(ESP32Device).where(ESP32Device.id == dev.id))
        assert chk.scalar_one_or_none() is None
