"""API Dependencies, JWT Token Verification, and Role Guarding.

Provides FastAPI dependencies for injecting database sessions and validating
actor credentials (Admin, SuperUser, User).
"""

from typing import AsyncGenerator, Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.config.settings import settings
from backend.app.db.session import get_db
from backend.app.models.admin import Admin
from backend.app.models.superuser import SuperUser
from backend.app.models.user import User
from backend.app.models.space import Space

security = HTTPBearer(auto_error=False)


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Generate a signed cryptographic JWT access token."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta if expires_delta else timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "iat": datetime.now(timezone.utc)})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


async def get_current_actor(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Extract and validate the JWT token, returning the actor profile and role."""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials were not provided."
        )

    token = credentials.credentials
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        email: str = payload.get("sub")
        role: str = payload.get("role")
        if not email or not role:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Malformed token claims."
            )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token."
        )

    token_uid = payload.get("uid")
    token_tv = payload.get("tv")
    email_clean = email.lower().strip()

    # Real-time DB verification: reject deleted, deactivated, or modified/re-registered accounts
    if role == "admin":
        res = await session.execute(select(Admin).where(Admin.email == email_clean))
        admin = res.scalar_one_or_none()
        if not admin:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Account no longer exists. Please log in again."
            )
        if token_uid is not None and str(admin.id) != str(token_uid):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session invalidated due to account recreation. Please log in again."
            )
        if (token_tv is not None and token_tv != admin.token_version) or (token_tv is None and admin.token_version > 1):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session invalidated due to account update. Please log in again."
            )
        return {
            "email": admin.email,
            "role": "admin",
            "name": admin.name,
            "is_root": admin.is_root,
            "authorized_spaces": ["all"],
        }

    if role == "superuser":
        res = await session.execute(select(SuperUser).where(SuperUser.email == email_clean))
        su = res.scalar_one_or_none()
        if not su or not su.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="SuperUser account revoked or deleted. Please log in again."
            )
        if token_uid is not None and str(su.id) != str(token_uid):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session invalidated due to account recreation. Please log in again."
            )
        if (token_tv is not None and token_tv != su.token_version) or (token_tv is None and su.token_version > 1):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session invalidated due to authority or profile update. Please log in again."
            )
        return {
            "email": su.email,
            "role": "superuser",
            "name": su.name,
            "is_root": False,
            "authorized_spaces": su.allowed_spaces or [],
        }

    if role == "user":
        res = await session.execute(select(User).where(User.email == email_clean))
        user = res.scalar_one_or_none()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Account no longer exists. Please log in again."
            )
        if token_uid is not None and str(user.id) != str(token_uid):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session invalidated due to account re-registration. Please log in again."
            )
        if (token_tv is not None and token_tv != user.token_version) or (token_tv is None and user.token_version > 1):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session invalidated due to account update. Please log in again."
            )
        return {
            "email": user.email,
            "role": "user",
            "name": user.name,
            "is_root": False,
            "authorized_spaces": [],
        }

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid account role."
    )


async def require_admin(
    actor: Dict[str, Any] = Depends(get_current_actor)
) -> Dict[str, Any]:
    """Dependency verifying the caller is a system administrator."""
    if actor.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access forbidden: Administrator privileges required."
        )
    return actor


async def require_superuser_or_admin(
    actor: Dict[str, Any] = Depends(get_current_actor)
) -> Dict[str, Any]:
    """Dependency verifying caller is either a SuperUser or Admin."""
    if actor.get("role") not in ("superuser", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access forbidden: SuperUser or Admin authority required."
        )
    return actor


async def require_root_admin(
    actor: Dict[str, Any] = Depends(require_admin)
) -> Dict[str, Any]:
    """Dependency verifying caller is the Master Root Administrator (is_root=True)."""
    if not actor.get("is_root", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access forbidden: Master Root Administrator privileges required to manage facility spaces."
        )
    return actor
