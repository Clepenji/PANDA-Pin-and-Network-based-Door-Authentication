"""Access PIN Management and Keypad Authentication Service.

Manages cryptographic generation of 6-digit access PINs with guaranteed uniqueness
across active unrevoked records (where revoked_at IS NULL), and handles hardware verification pulses.
"""

import logging
import secrets
import uuid
from datetime import timedelta
from typing import Optional, Tuple, List, Dict, Any
from fastapi import HTTPException, status
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.config.settings import settings
from backend.app.db.base import utc_now
from backend.app.models.active_pin import ActivePin
from backend.app.models.user import User
from backend.app.models.superuser import SuperUser
from backend.app.models.space import Space
from backend.app.models.esp32_device import ESP32Device
from backend.app.models.entry_log import EntryEventType
from backend.app.services.log_service import LogService
from backend.app.services.websocket_service import ws_manager
from backend.app.services.esp32_service import ESP32Service
from backend.app.services.totp_service import TotpService
from backend.app.services.system_setting_service import SystemSettingService

logger = logging.getLogger(__name__)


class PinService:
    """Service handling PIN lifecycle, collision prevention, and keypad unlocks."""

    @staticmethod
    async def generate_unique_pin_code(session: AsyncSession) -> str:
        """Generate a random 6-digit PIN string guaranteed unique among all active unrevoked PINs.

        Uses cryptographic random numbers and verifies against the partial unique index.
        Strictly guarantees that user PINs never collide with any active emergency TOTP code.
        """
        now = utc_now()
        max_attempts = 100

        # Retrieve all currently active emergency master TOTP codes to prevent collision
        active_totp_pins = await TotpService.get_all_active_totp_pins(session)

        for _ in range(max_attempts):
            # Generate 6-digit numeric string: 000000 - 999999
            candidate = f"{secrets.randbelow(1_000_000):06d}"

            # Ensure candidate never matches any space's active emergency TOTP master PIN
            if candidate in active_totp_pins:
                continue

            # Check if this PIN is currently in active/unrevoked use
            stmt = select(ActivePin).where(
                and_(
                    ActivePin.pin_code == candidate,
                    ActivePin.revoked_at.is_(None),
                    ActivePin.expires_at > now
                )
            )
            res = await session.execute(stmt)
            if res.scalar_one_or_none() is None:
                return candidate

        raise RuntimeError("Unable to generate unique PIN after maximum attempts. High active load.")

    @staticmethod
    async def issue_pin_for_grant(
        session: AsyncSession,
        space_id: str,
        holder_user_id: uuid.UUID,
        issued_by_superuser_id: Optional[uuid.UUID],
        issued_by_name: str,
        issued_by_email: str,
    ) -> ActivePin:
        """Create and store a newly approved active PIN with configured TTL."""
        now = utc_now()
        # Use dynamic configurable PIN_TTL_SECONDS from PostgreSQL settings
        ttl_seconds = await SystemSettingService.get_pin_validity_seconds(session)
        expires = now + timedelta(seconds=ttl_seconds)
        pin_code = await PinService.generate_unique_pin_code(session)

        # Look up holder email for targeted UI notifications (never leak raw PIN to browsers over WS)
        holder_res = await session.execute(select(User.email).where(User.id == holder_user_id))
        holder_email = holder_res.scalar_one_or_none()

        # Revoke any existing active PINs for this user and space before creating the new one
        existing_stmt = select(ActivePin).where(
            and_(
                ActivePin.holder_user_id == holder_user_id,
                ActivePin.space_id == space_id,
                ActivePin.revoked_at.is_(None),
                ActivePin.expires_at > now,
            )
        )
        existing_res = await session.execute(existing_stmt)
        for old_pin in existing_res.scalars().all():
            old_pin.revoked_at = now
            revoke_hw_payload = {
                "action": "REVOKE_PIN",
                "space_id": space_id,
                "pin": old_pin.pin_code,
            }
            await ws_manager.broadcast(f"esp32:{space_id}", revoke_hw_payload)
            revoke_ui_payload = {
                "action": "PIN_LIST_UPDATED",
                "type": "PIN_LIST_UPDATED",
                "space_id": space_id,
                "holder_email": holder_email,
            }
            await ws_manager.broadcast(f"space:{space_id}", revoke_ui_payload)
            await ws_manager.broadcast("global", revoke_ui_payload)
            # Enqueue to persistent hardware outbox
            await ESP32Service.enqueue_command(
                session=session,
                space_id=space_id,
                command_type="REVOKE_PIN",
                payload={"pin": old_pin.pin_code}
            )

        active_pin = ActivePin(
            pin_code=pin_code,
            space_id=space_id,
            holder_user_id=holder_user_id,
            issued_by_superuser_id=issued_by_superuser_id,
            issued_by_name_snapshot=issued_by_name[:80],
            issued_by_email_snapshot=issued_by_email[:120],
            expires_at=expires,
            revoked_at=None,
            created_at=now,
        )
        session.add(active_pin)
        await session.flush()

        # Immediately push { "action": "ADD_PIN", ... } strictly to ESP32 hardware channel (never to browser channels)
        add_pin_hw_payload = {
            "action": "ADD_PIN",
            "space_id": space_id,
            "pin": pin_code,
            "expires_at": expires.isoformat(),
        }
        await ws_manager.broadcast(f"esp32:{space_id}", add_pin_hw_payload)

        # Broadcast sanitized refresh signal (NO raw PIN exposed) to web clients
        add_pin_ui_payload = {
            "action": "PIN_ISSUED",
            "type": "PIN_ISSUED",
            "space_id": space_id,
            "holder_email": holder_email,
            "expires_at": expires.isoformat(),
        }
        await ws_manager.broadcast(f"space:{space_id}", add_pin_ui_payload)
        await ws_manager.broadcast("global", add_pin_ui_payload)

        # Enqueue to persistent hardware outbox with Unix epoch expiration
        await ESP32Service.enqueue_command(
            session=session,
            space_id=space_id,
            command_type="ADD_PIN",
            payload={"pin": pin_code, "valid_till": int(expires.timestamp())}
        )

        return active_pin

    @staticmethod
    async def revoke_pin(
        session: AsyncSession,
        pin_id: uuid.UUID,
        actor: Dict[str, Any],
    ) -> ActivePin:
        """Revoke an active PIN early.

        Admins can revoke any PIN across any space.
        SuperUsers can only revoke PINs for spaces within their authority.
        """
        stmt = select(ActivePin).where(ActivePin.id == pin_id)
        res = await session.execute(stmt)
        active_pin = res.scalar_one_or_none()

        if not active_pin:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Active PIN not found."
            )

        if active_pin.revoked_at is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="PIN has already been revoked."
            )

        # Check authority: Admins can revoke any space; SuperUsers check allowed_spaces
        role = actor.get("role")
        if role != "admin":
            authorized_spaces = actor.get("authorized_spaces", [])
            if active_pin.space_id not in authorized_spaces:
                su_stmt = select(SuperUser).where(SuperUser.email == actor["email"])
                su_res = await session.execute(su_stmt)
                su = su_res.scalar_one_or_none()
                if not su or active_pin.space_id not in (su.allowed_spaces or []):
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Not authorized to revoke PIN for this facility space."
                    )

        now = utc_now()
        active_pin.revoked_at = now
        await session.flush()

        # Fetch entrant user details for immutable log attribution
        user_res = await session.execute(
            select(User).where(User.id == active_pin.holder_user_id)
        )
        user = user_res.scalar_one_or_none()
        entrant_name = user.name if user else "Unknown Entrant"
        entrant_email = user.email if user else "unknown@domain"

        # Write immutable audit log for active key revocation
        await LogService.create_entry_log(
            session=session,
            event_type=EntryEventType.PIN_REVOKED,
            space_id=active_pin.space_id,
            actor_name=entrant_name,
            actor_email=entrant_email,
            authority_name=actor.get("name", "Authorizer"),
            authority_email=actor.get("email", "unknown@domain"),
            pin_used=active_pin.pin_code,
            justification_snapshot=f"Active PIN revoked by {actor.get('name', 'Authorizer')} ({actor.get('email', '')})",
        )

        # Immediately broadcast { "action": "REVOKE_PIN", ... } ONLY to ESP32 hardware channel
        revoke_hw_payload = {
            "action": "REVOKE_PIN",
            "space_id": active_pin.space_id,
            "pin": active_pin.pin_code,
        }
        await ws_manager.broadcast(f"esp32:{active_pin.space_id}", revoke_hw_payload)

        # Broadcast sanitized UI revocation notification (NO raw PIN, scoped by holder_email)
        revoke_ui_payload = {
            "action": "PIN_REVOKED_UI",
            "type": "PIN_REVOKED",
            "space_id": active_pin.space_id,
            "holder_email": entrant_email if user else None,
        }
        await ws_manager.broadcast(f"space:{active_pin.space_id}", revoke_ui_payload)
        await ws_manager.broadcast("global", revoke_ui_payload)

        # Enqueue to persistent hardware outbox
        await ESP32Service.enqueue_command(
            session=session,
            space_id=active_pin.space_id,
            command_type="REVOKE_PIN",
            payload={"pin": active_pin.pin_code}
        )

        return active_pin

    @staticmethod
    async def direct_issue_pin(
        session: AsyncSession,
        space_id: str,
        entrant_email: str,
        actor: Dict[str, Any],
        justification: str = "Direct SuperUser access grant",
    ) -> ActivePin:
        """Allow an authorized SuperUser or Admin to generate a direct PIN for an entrant."""
        # Check authority
        role = actor.get("role")
        if role != "admin":
            su_stmt = select(SuperUser).where(SuperUser.email == actor["email"])
            su_res = await session.execute(su_stmt)
            su = su_res.scalar_one_or_none()
            if not su or space_id not in (su.allowed_spaces or []):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Not authorized to issue PIN for this facility space."
                )
            approver_id = su.id
        else:
            approver_id = None

        # Resolve or create entrant user
        user_stmt = select(User).where(User.email == entrant_email)
        user_res = await session.execute(user_stmt)
        user = user_res.scalar_one_or_none()
        if not user:
            user = User(
                email=entrant_email,
                name=entrant_email.split("@")[0].replace(".", " ").title(),
                phone="0000000000",
            )
            session.add(user)
            await session.flush()

        active_pin = await PinService.issue_pin_for_grant(
            session=session,
            space_id=space_id,
            holder_user_id=user.id,
            issued_by_superuser_id=approver_id,
            issued_by_name=actor["name"],
            issued_by_email=actor["email"],
        )

        # Log ACCESS_GRANTED in entry_logs with permanent immutable snapshots
        await LogService.create_entry_log(
            session=session,
            event_type=EntryEventType.ACCESS_GRANTED,
            space_id=space_id,
            actor_name=user.name,
            actor_email=user.email,
            authority_name=actor["name"],
            authority_email=actor["email"],
            pin_used=active_pin.pin_code,
            justification_snapshot=justification[:256],
        )

        return active_pin

    @staticmethod
    async def list_active_pins_for_space(
        session: AsyncSession,
        space_id: str,
    ) -> List[Tuple[ActivePin, User]]:
        """List all currently active, unrevoked PINs for a specific facility space."""
        now = utc_now()
        stmt = select(ActivePin, User).join(
            User, User.id == ActivePin.holder_user_id
        ).where(
            and_(
                ActivePin.space_id == space_id,
                ActivePin.revoked_at.is_(None),
                ActivePin.expires_at > now,
            )
        ).order_by(ActivePin.expires_at.asc())
        res = await session.execute(stmt)
        return list(res.all())

    @staticmethod
    async def verify_keypad_attempt(
        session: AsyncSession,
        device_id: str,
        pin_code: str,
    ) -> Tuple[bool, str, Optional[str]]:
        """Verify a 6-digit keypad entry submitted from an IoT door controller node.

        Returns:
            Tuple: (granted: bool, message: str, space_id: Optional[str])
        """
        now = utc_now()

        # 1. Resolve exact hardware lock device and mapped facility space
        dev_stmt = select(ESP32Device).where(ESP32Device.device_id == device_id)
        dev_res = await session.execute(dev_stmt)
        dev = dev_res.scalar_one_or_none()

        if dev and dev.space_id:
            space_id = dev.space_id
        else:
            space_stmt = select(Space).where(Space.esp32_device_id == device_id)
            space_res = await session.execute(space_stmt)
            space = space_res.scalar_one_or_none()
            space_id = space.slug if space else "unknown_space"

        # 2. Check for active unrevoked PIN for this space
        pin_stmt = select(ActivePin, User).join(
            User, User.id == ActivePin.holder_user_id
        ).where(
            and_(
                ActivePin.pin_code == pin_code,
                ActivePin.space_id == space_id,
                ActivePin.revoked_at.is_(None),
                ActivePin.expires_at > now,
            )
        )
        pin_res = await session.execute(pin_stmt)
        row = pin_res.first()

        if not row:
            # Check if entered PIN matches the Emergency Master TOTP PIN for this specific lock (fixed 24h window)
            if not dev:
                fallback_dev_stmt = select(ESP32Device).where(ESP32Device.space_id == space_id)
                dev = (await session.execute(fallback_dev_stmt)).scalars().first()
            time_step = TotpService.EMERGENCY_TOTP_TIME_STEP_SECONDS
            is_totp_valid = False
            if dev and dev.device_secret:
                is_totp_valid = TotpService.verify_totp(dev.device_secret, pin_code, time_step=time_step)

            if is_totp_valid:
                logger.info(f"Emergency Master TOTP PIN {pin_code} entered for space {space_id} - Access Granted")
                await LogService.create_entry_log(
                    session=session,
                    event_type=EntryEventType.DOOR_UNLOCKED,
                    space_id=space_id,
                    actor_name="Root Administrator (Emergency TOTP)",
                    actor_email=settings.ROOT_ADMIN_EMAIL,
                    authority_name="Emergency Offline TOTP Master Key",
                    authority_email=settings.ROOT_ADMIN_EMAIL,
                    pin_used=pin_code,
                    justification_snapshot=f"Door unlocked via Emergency Master TOTP verification (Device: {device_id})"
                )
                await ws_manager.broadcast_space_event(
                    space_slug=space_id,
                    event_type="DOOR_UNLOCKED",
                    data={
                        "space_slug": space_id,
                        "actor_name": "Root Administrator (Emergency TOTP)",
                        "actor_email": settings.ROOT_ADMIN_EMAIL,
                        "pin_used": pin_code,
                        "duration_seconds": 5
                    }
                )
                return True, "Access Granted: Emergency Master TOTP Verified", space_id

            logger.info(f"Invalid or expired PIN {pin_code} entered for space {space_id}")
            await LogService.create_entry_log(
                session=session,
                event_type=EntryEventType.INVALID_PIN_ATTEMPT,
                space_id=space_id,
                actor_name="Unknown Keypad Entrant",
                actor_email="keypad@facility.local",
                authority_name="Hardware Security Controller",
                authority_email="controller@facility.local",
                pin_used=pin_code,
                justification_snapshot=f"Failed keypad entry at device {device_id}"
            )
            return False, "Access Denied: Invalid or expired PIN", (None if space_id == "unknown_space" else space_id)

        active_pin, user = row

        # 3. Valid access verified! Log DOOR_UNLOCKED to entry_logs
        await LogService.create_entry_log(
            session=session,
            event_type=EntryEventType.DOOR_UNLOCKED,
            space_id=active_pin.space_id,
            actor_name=user.name,
            actor_email=user.email,
            authority_name=active_pin.issued_by_name_snapshot,
            authority_email=active_pin.issued_by_email_snapshot,
            pin_used=pin_code,
            justification_snapshot=f"Door unlocked via keypad verification (Device: {device_id})"
        )

        # Broadcast door unlock pulse over WebSockets
        await ws_manager.broadcast_space_event(
            space_slug=active_pin.space_id,
            event_type="DOOR_UNLOCKED",
            data={
                "space_slug": active_pin.space_id,
                "actor_name": user.name,
                "actor_email": user.email,
                "duration_seconds": 5
            }
        )

        return True, "Access Granted: Door Unlocked", active_pin.space_id
