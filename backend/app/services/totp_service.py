"""Time-Based One-Time Password (TOTP) Service (RFC 6238 / RFC 4226).

Generates and validates emergency 6-digit master access PINs for Facility Spaces
derived from device shared secrets. Fixed to a 24-hour (86400s) rotation window
synchronized with offline ESP32 hardware firmware.
"""

import hmac
import hashlib
import struct
import time
from typing import Dict, Any, List, Optional, Set
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.models.esp32_device import ESP32Device


class TotpService:
    """RFC 6238-compliant TOTP engine using HMAC-SHA256."""

    # Emergency Master TOTP strictly rotates on a fixed 24-hour window (matches ESP32 firmware)
    EMERGENCY_TOTP_TIME_STEP_SECONDS = 86400

    @staticmethod
    def compute_totp(
        secret: str,
        time_step: int = EMERGENCY_TOTP_TIME_STEP_SECONDS,
        for_time: Optional[int] = None,
        digits: int = 6
    ) -> Dict[str, Any]:
        """Compute the 6-digit TOTP PIN, remaining validity seconds, and expiration timestamp."""
        if for_time is None:
            for_time = int(time.time())

        # Time counter window
        counter = int(for_time // time_step)
        msg = struct.pack(">Q", counter)

        # HMAC-SHA256 over big-endian 64-bit counter
        h = hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).digest()

        # Dynamic truncation (RFC 4226 Section 5.3)
        offset = h[-1] & 0x0F
        binary = (struct.unpack(">I", h[offset:offset+4])[0] & 0x7FFFFFFF)
        pin = f"{binary % (10 ** digits):0{digits}d}"

        remaining_seconds = time_step - (for_time % time_step)
        valid_till = for_time + remaining_seconds

        return {
            "pin": pin,
            "counter": counter,
            "remaining_seconds": remaining_seconds,
            "time_step": time_step,
            "valid_till": valid_till,
        }

    @staticmethod
    def verify_totp(
        secret: str,
        pin_to_verify: str,
        time_step: int = EMERGENCY_TOTP_TIME_STEP_SECONDS,
        tolerance_windows: int = 1
    ) -> bool:
        """Verify an entered 6-digit PIN against the current and adjacent time windows.

        Allows for clock drift up to tolerance_windows periods before/after.
        """
        pin_clean = str(pin_to_verify).strip()
        if len(pin_clean) != 6 or not pin_clean.isdigit():
            return False

        current_time = int(time.time())
        # Check current window and previous window to handle slight clock skew
        for offset_window in range(-tolerance_windows, 1):
            t = current_time + (offset_window * time_step)
            computed = TotpService.compute_totp(secret, time_step=time_step, for_time=t)["pin"]
            if hmac.compare_digest(pin_clean, computed):
                return True
        return False

    @staticmethod
    async def get_all_active_totp_pins(session: AsyncSession) -> Set[str]:
        """Collect all active emergency TOTP PINs across all spaces (current + previous + next windows).

        Used by PinService to guarantee user PINs never collide with emergency master TOTP codes.
        """
        stmt = select(ESP32Device.device_secret)
        res = await session.execute(stmt)
        secrets_list = res.scalars().all()

        time_step = TotpService.EMERGENCY_TOTP_TIME_STEP_SECONDS
        now = int(time.time())
        active_pins: Set[str] = set()

        for sec in secrets_list:
            if not sec:
                continue
            # Check current, previous, and next window
            for w in (-1, 0, 1):
                t = now + (w * time_step)
                active_pins.add(TotpService.compute_totp(sec, time_step=time_step, for_time=t)["pin"])

        return active_pins
