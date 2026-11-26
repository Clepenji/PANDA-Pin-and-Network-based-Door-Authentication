"""Authentication, User Profile, and Lifecycle Warning API Endpoints.

Provides institutional email login, role determination, account tagging (New/Old),
and pre-reset warning banners.
"""

from datetime import timedelta, datetime, timezone
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, and_, delete
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.db.session import get_db
from backend.app.schemas.auth import (
    EmailLoginRequest,
    TokenResponse,
    UserProfileResponse,
    UserProfileUpdateRequest,
    PreResetWarningResponse,
    UserRegisterRequest,
    SuperUserInfoResponse,
    ClubResponse,
)
from backend.app.db.base import utc_now
from backend.app.models.admin import Admin
from backend.app.models.superuser import SuperUser
from backend.app.models.user import User
from backend.app.models.club import Club
from backend.app.models.assignment import UserSpaceAssignment
from backend.app.models.access_request import AccessRequest, RequestStatus
from backend.app.models.active_pin import ActivePin
from backend.app.models.system_setting import SystemSetting
from backend.app.config.settings import settings
from backend.app.api.deps import create_access_token, get_current_actor
from backend.app.services.lifecycle_service import (
    get_account_tag,
    get_pre_reset_warning,
    purge_person_by_identifier,
)
from backend.app.services.websocket_service import ws_manager
from backend.app.services.notification_service import NotificationService

router = APIRouter(prefix="/auth", tags=["Authentication"])


def validate_email_domain(email: str) -> None:
    """Enforce institutional domain restrictions.
    
    Source Root Admin (settings.ROOT_ADMIN_EMAIL) is permanently exempt.
    In 'dev' mode, @gmail.com is always allowed for developer testing and personas.
    All other accounts must belong to settings.ALLOWED_EMAIL_DOMAIN if configured.
    If settings.ALLOWED_EMAIL_DOMAIN is empty or not set, all email domains are permitted in dev mode.
    """
    clean = email.lower().strip()
    root_email = settings.ROOT_ADMIN_EMAIL.lower().strip()
    if clean == root_email:
        return

    # In dev mode, always permit @gmail.com accounts
    if settings.AUTH_MODE == "dev" and clean.endswith("@gmail.com"):
        return

    allowed_domain_raw = (settings.ALLOWED_EMAIL_DOMAIN or "").lower().strip()
    if not allowed_domain_raw or allowed_domain_raw in ("*", "all", "none"):
        return

    allowed_domains = [d.strip().lstrip("@") for d in allowed_domain_raw.split(",") if d.strip()]
    if not allowed_domains:
        return

    if not any(clean.endswith(f"@{dom}") for dom in allowed_domains):
        dom_display = ", ".join(f"@{dom}" for dom in allowed_domains)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Access restricted to authorized accounts ({dom_display})."
        )


@router.get("/config")
async def get_auth_config() -> Dict[str, Any]:
    """Retrieve public institutional authentication settings."""
    return {
        "auth_mode": settings.AUTH_MODE,
        "allowed_email_domain": settings.ALLOWED_EMAIL_DOMAIN,
        "google_client_id": settings.GOOGLE_CLIENT_ID,
        "root_admin_email": settings.ROOT_ADMIN_EMAIL,
    }


@router.get("/oauth/google/url")
async def get_google_oauth_url(redirect_uri: Optional[str] = Query(None)) -> Dict[str, str]:
    """Generate official Google OAuth 2.0 authorization redirect URL."""
    client_id = settings.GOOGLE_CLIENT_ID
    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="GOOGLE_CLIENT_ID is not configured in .env."
        )
    eff_redirect = (settings.GOOGLE_REDIRECT_URI or redirect_uri or f"{settings.FRONTEND_URL}/login").rstrip("/")
    from urllib.parse import urlencode
    params = {
        "client_id": client_id,
        "redirect_uri": eff_redirect,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "online",
        "prompt": "select_account",
    }
    if settings.ALLOWED_EMAIL_DOMAIN:
        params["hd"] = settings.ALLOWED_EMAIL_DOMAIN
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)
    return {"url": url}


@router.post("/oauth/google")
async def google_oauth_login(
    payload: Dict[str, Any],
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Google Workspace OAuth login endpoint.

    Supports both:
    1. Standard Authorization Code redirect flow (code + redirect_uri)
    2. Google Identity Services ID token (credential or id_token)
    """
    import httpx
    code = payload.get("code")
    credential = payload.get("credential") or payload.get("id_token")
    redirect_uri = payload.get("redirect_uri")
    email = str(payload.get("email", "")).lower().strip()
    name = str(payload.get("name", "")).strip()

    if code:
        # Standard OAuth 2.0 Authorization Code Flow
        try:
            eff_redirect = (settings.GOOGLE_REDIRECT_URI or redirect_uri or f"{settings.FRONTEND_URL}/login").rstrip("/")
            async with httpx.AsyncClient(timeout=15.0) as client:
                token_resp = await client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "code": code,
                        "client_id": settings.GOOGLE_CLIENT_ID,
                        "client_secret": settings.GOOGLE_CLIENT_SECRET,
                        "redirect_uri": eff_redirect,
                        "grant_type": "authorization_code",
                    }
                )
            if token_resp.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Google token exchange failed: {token_resp.text}"
                )
            token_data = token_resp.json()
            access_token = token_data.get("access_token")

            # Fetch user profile using access token
            async with httpx.AsyncClient(timeout=10.0) as client:
                userinfo_resp = await client.get(
                    "https://www.googleapis.com/oauth2/v3/userinfo",
                    headers={"Authorization": f"Bearer {access_token}"}
                )
            if userinfo_resp.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Failed to fetch Google profile: {userinfo_resp.text}"
                )
            user_info = userinfo_resp.json()
            email = str(user_info.get("email", "")).lower().strip()
            name = str(user_info.get("name", "")).strip() or name
            email_verified = user_info.get("email_verified")
            if not email or email_verified is False:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Google account email is not verified."
                )
            hd = user_info.get("hd")
            if email != settings.ROOT_ADMIN_EMAIL.lower() and settings.ALLOWED_EMAIL_DOMAIN:
                if hd and hd.lower() != settings.ALLOWED_EMAIL_DOMAIN.lower():
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Invalid Google Workspace organization '{hd}'. Institutional domain @{settings.ALLOWED_EMAIL_DOMAIN} required."
                    )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to exchange Google OAuth code: {str(e)}"
            )
    elif credential:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    "https://oauth2.googleapis.com/tokeninfo",
                    params={"id_token": credential}
                )
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=f"Google token verification failed: {resp.text}"
                )
            token_data = resp.json()
            email = str(token_data.get("email", "")).lower().strip()
            name = str(token_data.get("name", "")).strip() or name
            email_verified = token_data.get("email_verified")
            if not email or email_verified not in (True, "true"):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Google account email is not verified."
                )

            # Validate audience if client ID is configured
            if settings.GOOGLE_CLIENT_ID:
                aud = token_data.get("aud")
                if aud != settings.GOOGLE_CLIENT_ID:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Google OAuth Client ID mismatch."
                    )

            # Validate institutional hosted domain if not Root Admin
            if email != settings.ROOT_ADMIN_EMAIL.lower() and settings.ALLOWED_EMAIL_DOMAIN:
                hd = token_data.get("hd")
                if hd and hd.lower() != settings.ALLOWED_EMAIL_DOMAIN.lower():
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Invalid Google Workspace organization '{hd}'. Institutional domain @{settings.ALLOWED_EMAIL_DOMAIN} required."
                    )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to verify Google OAuth credential: {str(e)}"
            )
    elif settings.AUTH_MODE == "oauth":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google OAuth code or credential required for institutional authentication."
        )

    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Valid email required for OAuth authentication."
        )

    # Enforce institutional domain
    validate_email_domain(email)

    try:
        # 1. Check Admin
        admin_stmt = select(Admin).where(Admin.email == email)
        admin_res = await session.execute(admin_stmt)
        admin = admin_res.scalar_one_or_none()

        # If configured Root Admin logs in and record does not exist yet, auto-provision
        if not admin and email == settings.ROOT_ADMIN_EMAIL.lower().strip():
            admin = Admin(
                email=email,
                name=name or "Rehan Kurian",
                is_root=True
            )
            session.add(admin)
            await session.commit()
            await session.refresh(admin)

        if admin:
            await record_account_login(session, admin.email)
            token = create_access_token({
                "sub": admin.email,
                "uid": str(admin.id),
                "tv": getattr(admin, "token_version", 1),
                "role": "admin",
                "name": admin.name,
                "is_root": admin.is_root,
                "authorized_spaces": ["all"]
            })
            return {
                "status": "LOGGED_IN",
                "access_token": token,
                "token_type": "bearer",
                "role": "admin",
                "email": admin.email,
                "name": admin.name,
                "phone": None,
                "club_name": None,
                "is_root": admin.is_root,
                "authorized_spaces": ["all"],
                "account_tag": None,
                "college_year": "Not Applicable",
            }

        # 2. Check SuperUser
        su_stmt = select(SuperUser).where(SuperUser.email == email)
        su_res = await session.execute(su_stmt)
        su = su_res.scalar_one_or_none()
        if su:
            if not su.is_active:
                oauth_token = create_access_token(
                    {"sub": su.email, "name": su.name, "purpose": "oauth_registration"},
                    expires_delta=timedelta(minutes=20)
                )
                return {
                    "status": "NEEDS_REGISTRATION",
                    "email": su.email,
                    "name": su.name,
                    "oauth_registration_token": oauth_token,
                    "message": "SuperUser privileges are inactive. Please complete entrant registration.",
                }
            await record_account_login(session, su.email)
            su_club_name = None
            if su.club_id:
                c_res = await session.execute(select(Club.name).where(Club.id == su.club_id))
                su_club_name = c_res.scalar_one_or_none()
            token = create_access_token({
                "sub": su.email,
                "uid": str(su.id),
                "tv": getattr(su, "token_version", 1),
                "role": "superuser",
                "name": su.name,
                "is_root": False,
                "authorized_spaces": su.allowed_spaces or []
            })
            return {
                "status": "LOGGED_IN",
                "access_token": token,
                "token_type": "bearer",
                "role": "superuser",
                "email": su.email,
                "name": su.name,
                "phone": su.phone,
                "club_name": su_club_name,
                "is_root": False,
                "authorized_spaces": su.allowed_spaces or [],
                "account_tag": None,
                "college_year": getattr(su, "college_year", "Not Applicable"),
                "note": getattr(su, "note", None),
            }

        # 3. Check User
        user_stmt = select(User).where(User.email == email)
        user_res = await session.execute(user_stmt)
        user = user_res.scalar_one_or_none()
        if user:
            await record_account_login(session, user.email)
            user_club_name = None
            if user.club_id:
                c_res = await session.execute(select(Club.name).where(Club.id == user.club_id))
                user_club_name = c_res.scalar_one_or_none()
            tag = get_account_tag(user.created_at)
            token = create_access_token({
                "sub": user.email,
                "uid": str(user.id),
                "tv": getattr(user, "token_version", 1),
                "role": "user",
                "name": user.name,
                "is_root": False,
                "authorized_spaces": []
            })
            return {
                "status": "LOGGED_IN",
                "access_token": token,
                "token_type": "bearer",
                "role": "user",
                "email": user.email,
                "name": user.name,
                "phone": user.phone,
                "club_name": user_club_name,
                "is_root": False,
                "authorized_spaces": [],
                "account_tag": tag,
                "college_year": getattr(user, "college_year", "Not Applicable"),
                "note": getattr(user, "note", None),
            }

        # 4. New User -> Generate OAuth verification registration token
        oauth_token = create_access_token(
            {"sub": email, "name": name, "purpose": "oauth_registration"},
            expires_delta=timedelta(minutes=20)
        )
        return {
            "status": "NEEDS_REGISTRATION",
            "email": email,
            "name": name,
            "oauth_registration_token": oauth_token,
            "message": f"Campus Google account verified ({email}). Complete entrant registration below.",
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Authentication processing error: {str(e)}"
        )


async def record_account_login(session: AsyncSession, email: str) -> None:
    """Record login timestamp in system_settings for quick account ordering."""
    try:
        clean = email.lower().strip()
        key = f"last_login:{clean}"
        now_str = utc_now().isoformat()
        res = await session.execute(select(SystemSetting).where(SystemSetting.key == key))
        rec = res.scalar_one_or_none()
        if rec:
            rec.value = now_str
        else:
            session.add(SystemSetting(key=key, value=now_str))
        await session.commit()
    except Exception:
        pass


@router.post("/login", response_model=TokenResponse)
async def login_with_email(
    payload: EmailLoginRequest,
    session: AsyncSession = Depends(get_db)
) -> TokenResponse:
    """Authenticate via institutional email.

    1. Checks if email belongs to an Admin -> role 'admin'.
    2. Checks if email belongs to a SuperUser:
       - Active -> role 'superuser'.
       - Revoked (is_active=False) -> raises 403 to trigger fresh User Registration.
    3. Checks if email belongs to a registered User -> role 'user'.
    4. If not registered -> raises 404 to trigger fresh User Registration.
    """
    email_clean = payload.email.lower().strip()
    validate_email_domain(email_clean)

    # 1. Check Admin
    admin_stmt = select(Admin).where(Admin.email == email_clean)
    admin_res = await session.execute(admin_stmt)
    admin = admin_res.scalar_one_or_none()

    if admin:
        await record_account_login(session, admin.email)
        token = create_access_token({
            "sub": admin.email,
            "uid": str(admin.id),
            "tv": getattr(admin, "token_version", 1),
            "role": "admin",
            "name": admin.name,
            "is_root": admin.is_root,
            "authorized_spaces": ["all"]
        })
        return TokenResponse(
            access_token=token,
            role="admin",
            email=admin.email,
            name=admin.name,
            phone=None,
            club_name=None,
            is_root=admin.is_root,
            authorized_spaces=["all"],
            account_tag=None,
        )

    # 2. Check SuperUser
    su_stmt = select(SuperUser).where(SuperUser.email == email_clean)
    su_res = await session.execute(su_stmt)
    superuser = su_res.scalar_one_or_none()

    if superuser:
        if not superuser.is_active:
            # Revoked SuperUser routes directly to fresh User Registration
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="REVOKED_SUPERUSER_NEEDS_REGISTRATION"
            )

        # Ensure corresponding User record exists for SuperUser
        user_res = await session.execute(select(User).where(User.email == email_clean))
        existing_user = user_res.scalar_one_or_none()
        if not existing_user:
            synced_user = User(
                email=superuser.email,
                name=superuser.name,
                phone=superuser.phone or "0000000000",
                club_id=superuser.club_id
            )
            session.add(synced_user)
            await session.flush()
            existing_user = synced_user

        # Ensure UserSpaceAssignment exists for allowed spaces
        if existing_user and superuser.allowed_spaces:
            for s_slug in superuser.allowed_spaces:
                check_assign = await session.execute(
                    select(UserSpaceAssignment).where(
                        and_(
                            UserSpaceAssignment.user_id == existing_user.id,
                            UserSpaceAssignment.space_id == s_slug,
                        )
                    )
                )
                if not check_assign.scalar_one_or_none():
                    session.add(
                        UserSpaceAssignment(
                            user_id=existing_user.id,
                            space_id=s_slug,
                            superuser_id=superuser.id,
                        )
                    )
            await session.commit()

        tag = get_account_tag(superuser.created_at, updated_at=superuser.updated_at)
        su_club_name = None
        if superuser.club_id:
            c_res = await session.execute(select(Club.name).where(Club.id == superuser.club_id))
            su_club_name = c_res.scalar_one_or_none()
        await record_account_login(session, superuser.email)
        token = create_access_token({
            "sub": superuser.email,
            "uid": str(superuser.id),
            "tv": getattr(superuser, "token_version", 1),
            "role": "superuser",
            "name": superuser.name,
            "is_root": False,
            "authorized_spaces": superuser.allowed_spaces
        })
        return TokenResponse(
            access_token=token,
            role="superuser",
            email=superuser.email,
            name=superuser.name,
            phone=superuser.phone,
            club_name=su_club_name,
            is_root=False,
            authorized_spaces=superuser.allowed_spaces,
            account_tag=tag,
            college_year=getattr(superuser, "college_year", "Not Applicable"),
            note=getattr(superuser, "note", None),
        )

    # 3. Check User
    user_stmt = select(User).where(User.email == email_clean)
    user_res = await session.execute(user_stmt)
    user = user_res.scalar_one_or_none()

    if not user:
        # Unknown email routes directly to fresh User Registration
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="ACCOUNT_NOT_FOUND"
        )

    user_club_name = None
    if user.club_id:
        c_res = await session.execute(select(Club.name).where(Club.id == user.club_id))
        user_club_name = c_res.scalar_one_or_none()
    tag = get_account_tag(user.created_at)
    await record_account_login(session, user.email)
    token = create_access_token({
        "sub": user.email,
        "uid": str(user.id),
        "tv": getattr(user, "token_version", 1),
        "role": "user",
        "name": user.name,
        "is_root": False,
        "authorized_spaces": []
    })
    return TokenResponse(
        access_token=token,
        role="user",
        email=user.email,
        name=user.name,
        phone=user.phone,
        club_name=user_club_name,
        is_root=False,
        authorized_spaces=[],
        account_tag=tag,
        college_year=getattr(user, "college_year", "Not Applicable"),
        note=getattr(user, "note", None),
    )


@router.post("/register", response_model=TokenResponse)
async def register_user(
    payload: UserRegisterRequest,
    session: AsyncSession = Depends(get_db)
) -> TokenResponse:
    """Register a new student/user or re-register a revoked superuser as a regular entrant.

    Fields: Name, Phone Number, Club, ONE initial Facility Space, and Assigned SuperUser.
    """
    email_clean = payload.email.lower().strip()
    validate_email_domain(email_clean)

    # In OAuth mode, verify cryptographic Google OAuth registration token
    if settings.AUTH_MODE == "oauth":
        if not payload.oauth_registration_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Campus Google account verification required. Please sign in with Google before registering."
            )
        try:
            import jwt as pyjwt
            decoded = pyjwt.decode(
                payload.oauth_registration_token,
                settings.SECRET_KEY,
                algorithms=[settings.ALGORITHM]
            )
            is_valid_token = (
                decoded.get("purpose") == "oauth_registration" or
                decoded.get("role") in ["user", "superuser", "admin"]
            ) and decoded.get("sub", "").lower().strip() == email_clean

            if not is_valid_token:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid or expired Google account registration verification."
                )
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired Google account registration verification."
            )

    # Check if this email belongs to an active SuperUser (people are unique by email ID)
    su_check = await session.execute(
        select(SuperUser).where(
            SuperUser.email == email_clean,
            SuperUser.is_active.is_(True)
        )
    )
    if su_check.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This email belongs to an active SuperUser and cannot be registered as a student."
        )

    # Check if user record or inactive superuser already exists; delete old account and recreate
    existing_user_res = await session.execute(select(User).where(User.email == email_clean))
    existing_user = existing_user_res.scalar_one_or_none()
    existing_inactive_su = (await session.execute(
        select(SuperUser).where(SuperUser.email == email_clean, SuperUser.is_active.is_(False))
    )).scalar_one_or_none()

    if existing_user or existing_inactive_su:
        # Revoke any active hardware PINs before purging the old account
        if existing_user:
            now_ts = utc_now()
            old_pins = (await session.execute(
                select(ActivePin).where(
                    and_(
                        ActivePin.holder_user_id == existing_user.id,
                        ActivePin.revoked_at.is_(None),
                        ActivePin.expires_at > now_ts,
                    )
                )
            )).scalars().all()
            if old_pins:
                from backend.app.services.esp32_service import ESP32Service
                for op in old_pins:
                    await ws_manager.broadcast(f"esp32:{op.space_id}", {
                        "action": "REVOKE_PIN",
                        "space_id": op.space_id,
                        "pin": op.pin_code,
                    })
                    await ESP32Service.enqueue_command(
                        session=session,
                        space_id=op.space_id,
                        command_type="REVOKE_PIN",
                        payload={"pin": op.pin_code},
                    )
        await purge_person_by_identifier(session, email_clean)

    # 1. Handle Club (reuse existing or create new)
    club_id = None
    if payload.club_name and payload.club_name.strip():
        club_clean = payload.club_name.strip()[:25]
        club_res = await session.execute(select(Club).where(Club.name == club_clean))
        club = club_res.scalar_one_or_none()
        if not club:
            club = Club(name=club_clean)
            session.add(club)
            await session.flush()
        club_id = club.id

    note_val = payload.note.strip()[:255] if payload.note and payload.note.strip() else None

    # 2. Always create fresh User record
    new_user = User(
        email=email_clean,
        name=payload.name.strip()[:25],
        phone=payload.phone.strip()[:20],
        college_year=payload.college_year or "Not Applicable",
        club_id=club_id,
        note=note_val,
    )
    session.add(new_user)
    await session.flush()

    # 3. Create or update initial UserSpaceAssignment with PENDING status if a space was chosen
    if payload.space_id and payload.space_id.strip():
        space_slug = payload.space_id.strip().lower()
        assign_check = await session.execute(
            select(UserSpaceAssignment).where(
                and_(
                    UserSpaceAssignment.user_id == new_user.id,
                    UserSpaceAssignment.space_id == space_slug,
                )
            )
        )
        existing_assign = assign_check.scalar_one_or_none()
        if existing_assign:
            existing_assign.superuser_id = payload.assigned_superuser_id
            existing_assign.status = "PENDING"
        else:
            assignment = UserSpaceAssignment(
                user_id=new_user.id,
                space_id=space_slug,
                superuser_id=payload.assigned_superuser_id,
                status="PENDING",
            )
            session.add(assignment)

        # 4. Create an AccessRequest with request_type='REGISTRATION' for superuser adjudication in requests tab
        reg_req_check = await session.execute(
            select(AccessRequest).where(
                and_(
                    AccessRequest.requester_user_id == new_user.id,
                    AccessRequest.space_id == space_slug,
                    AccessRequest.request_type == "REGISTRATION",
                    AccessRequest.status == RequestStatus.PENDING,
                )
            )
        )
        reg_req = reg_req_check.scalar_one_or_none()
        if not reg_req:
            reg_req = AccessRequest(
                requester_user_id=new_user.id,
                space_id=space_slug,
                superuser_id=payload.assigned_superuser_id,
                justification=f"New Entrant Registration: {new_user.name} ({new_user.college_year})",
                request_type="REGISTRATION",
                status=RequestStatus.PENDING,
            )
            session.add(reg_req)
            await session.flush()

            # Broadcast live notification to designated SuperUser on WebSocket
            target_su_email = None
            if payload.assigned_superuser_id:
                su_em_row = (await session.execute(
                    select(SuperUser.email).where(SuperUser.id == payload.assigned_superuser_id)
                )).scalar_one_or_none()
                if su_em_row:
                    target_su_email = su_em_row.lower().strip()

            await ws_manager.broadcast_space_event(
                space_slug=space_slug,
                event_type="ACCESS_REQUEST_SUBMITTED",
                data={
                    "id": str(reg_req.id),
                    "space_id": space_slug,
                    "target_superuser_id": str(payload.assigned_superuser_id) if payload.assigned_superuser_id else None,
                    "target_superuser_email": target_su_email,
                    "requester_email": new_user.email,
                    "requester_name": new_user.name,
                    "justification": reg_req.justification,
                    "request_type": "REGISTRATION",
                    "created_at": reg_req.created_at.isoformat(),
                }
            )

            # Dispatch background Web Push notification to designated SuperUser
            try:
                await NotificationService.notify_superusers_new_request(
                    session=session,
                    space_id=space_slug,
                    requester_name=new_user.name,
                    justification=f"New Entrant Registration: {new_user.name} for {space_slug}",
                    target_su_id=payload.assigned_superuser_id,
                )
            except Exception:
                pass

    await session.commit()
    await session.refresh(new_user)

    tag = get_account_tag(new_user.created_at)
    token = create_access_token({
        "sub": new_user.email,
        "uid": str(new_user.id),
        "tv": getattr(new_user, "token_version", 1),
        "role": "user",
        "name": new_user.name,
        "is_root": False,
        "authorized_spaces": []
    })

    # Log out any previously logged-in session for this email
    if existing_user or existing_inactive_su:
        await ws_manager.broadcast("global", {
            "event_type": "FORCE_LOGOUT",
            "type": "FORCE_LOGOUT",
            "email": email_clean,
            "exclude_uid": str(new_user.id),
            "reason": "Account was re-registered.",
        })
    await ws_manager.broadcast("global", {
        "event_type": "USER_DIRECTORY_UPDATED",
        "type": "USER_DIRECTORY_UPDATED",
    })

    reg_club_name = None
    if new_user.club_id:
        c_res = await session.execute(select(Club.name).where(Club.id == new_user.club_id))
        reg_club_name = c_res.scalar_one_or_none()

    return TokenResponse(
        access_token=token,
        role="user",
        email=new_user.email,
        name=new_user.name,
        phone=new_user.phone,
        club_name=reg_club_name,
        is_root=False,
        authorized_spaces=[],
        account_tag=tag,
        college_year=new_user.college_year,
        note=new_user.note,
    )


@router.put("/profile", response_model=UserProfileResponse)
async def update_profile(
    payload: UserProfileUpdateRequest,
    actor: Dict[str, Any] = Depends(get_current_actor),
    session: AsyncSession = Depends(get_db)
) -> UserProfileResponse:
    """Update profile details for current entrant (Name, Phone, College Year, Club)."""
    email = actor["email"]
    role = actor["role"]

    if role == "admin":
        res = await session.execute(select(Admin).where(Admin.email == email))
        admin = res.scalar_one_or_none()
        if not admin:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin account not found.")
        if payload.name:
            admin.name = payload.name.strip()[:25]
        await session.commit()
        await session.refresh(admin)
        return UserProfileResponse(
            id=admin.id,
            email=admin.email,
            name=admin.name,
            phone=None,
            role="admin",
            is_root=admin.is_root,
            authorized_spaces=["all"],
            created_at=admin.created_at,
            account_tag=None,
            college_year="Not Applicable",
        )

    if role == "superuser":
        res = await session.execute(select(SuperUser).where(SuperUser.email == email))
        su = res.scalar_one_or_none()
        if not su:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SuperUser account not found.")
        if payload.name:
            su.name = payload.name.strip()[:25]
        if payload.phone:
            su.phone = payload.phone.strip()[:20]
        if payload.college_year:
            su.college_year = payload.college_year.strip()[:30]
        if payload.club_name is not None:
            if payload.club_name.strip():
                c_name = payload.club_name.strip()[:25]
                club_res = await session.execute(select(Club).where(Club.name == c_name))
                club = club_res.scalar_one_or_none()
                if not club:
                    club = Club(name=c_name)
                    session.add(club)
                    await session.flush()
                su.club_id = club.id
            else:
                su.club_id = None
        if payload.note is not None:
            su.note = payload.note.strip()[:255] if payload.note.strip() else None
        su.updated_at = utc_now()
        await session.commit()
        await session.refresh(su)
        club_name = None
        if su.club_id:
            c_res = await session.execute(select(Club).where(Club.id == su.club_id))
            c = c_res.scalar_one_or_none()
            club_name = c.name if c else None
        return UserProfileResponse(
            id=su.id,
            email=su.email,
            name=su.name,
            phone=su.phone,
            role="superuser",
            is_root=False,
            club_name=club_name,
            authorized_spaces=su.allowed_spaces or [],
            created_at=su.created_at,
            account_tag=get_account_tag(su.created_at, updated_at=su.updated_at),
            college_year=su.college_year,
            note=getattr(su, "note", None),
        )

    # Regular user
    user_res = await session.execute(select(User).where(User.email == email))
    user = user_res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User account not found.")

    if payload.name:
        user.name = payload.name.strip()[:25]
    if payload.phone:
        user.phone = payload.phone.strip()[:20]
    if payload.college_year:
        user.college_year = payload.college_year.strip()[:30]
    if payload.note is not None:
        user.note = payload.note.strip()[:255] if payload.note.strip() else None
    if payload.club_name is not None:
        if payload.club_name.strip():
            c_name = payload.club_name.strip()[:25]
            club_res = await session.execute(select(Club).where(Club.name == c_name))
            club = club_res.scalar_one_or_none()
            if not club:
                club = Club(name=c_name)
                session.add(club)
                await session.flush()
            user.club_id = club.id
        else:
            user.club_id = None

    await session.commit()
    await session.refresh(user)

    club_name = None
    if user.club_id:
        c_res = await session.execute(select(Club).where(Club.id == user.club_id))
        c = c_res.scalar_one_or_none()
        club_name = c.name if c else None

    return UserProfileResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        phone=user.phone,
        role="user",
        is_root=False,
        club_name=club_name,
        authorized_spaces=[],
        created_at=user.created_at,
        account_tag=get_account_tag(user.created_at),
        college_year=user.college_year,
        note=getattr(user, "note", None),
    )


@router.delete("/account")
async def delete_account(
    actor: Dict[str, Any] = Depends(get_current_actor),
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Allow any authenticated user, superuser, or non-source admin to self-delete their account.

    Source Administrator (rehankuriance@gmail.com) cannot be deleted.
    """
    email = actor["email"].lower().strip()
    role = actor.get("role", "user")

    if role == "admin":
        if email == settings.ROOT_ADMIN_EMAIL.lower().strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The Source Administrator account cannot be deleted."
            )
        adm_res = await session.execute(select(Admin).where(Admin.email == email))
        admin_rec = adm_res.scalar_one_or_none()
        if not admin_rec:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin account not found.")
        await session.delete(admin_rec)
        await session.execute(
            delete(SystemSetting).where(SystemSetting.key == f"last_login:{email}")
        )
        await session.commit()
        await ws_manager.broadcast("global", {
            "event_type": "FORCE_LOGOUT",
            "type": "FORCE_LOGOUT",
            "email": email,
            "reason": "Account was deleted.",
        })
        return {"status": "success", "message": "Admin account deleted successfully."}

    # For SuperUser or Student User: completely purge by email
    res_purge = await purge_person_by_identifier(session, email)
    await ws_manager.broadcast("global", {
        "event_type": "FORCE_LOGOUT",
        "type": "FORCE_LOGOUT",
        "email": email,
        "reason": "Account was deleted.",
    })
    await ws_manager.broadcast("global", {
        "event_type": "USER_DIRECTORY_UPDATED",
        "type": "USER_DIRECTORY_UPDATED",
    })
    return res_purge


@router.get("/superusers", response_model=List[SuperUserInfoResponse])
async def list_available_superusers(
    session: AsyncSession = Depends(get_db)
) -> List[SuperUserInfoResponse]:
    """Retrieve list of active SuperUsers for registration/assignment dropdowns."""
    stmt = (
        select(SuperUser, Club)
        .outerjoin(Club, Club.id == SuperUser.club_id)
        .where(SuperUser.is_active.is_(True))
        .order_by(SuperUser.name.asc())
    )
    res = await session.execute(stmt)
    records = res.all()

    return [
        SuperUserInfoResponse(
            id=su.id,
            name=su.name,
            email=su.email,
            phone=su.phone,
            club_name=club.name if club else None,
            allowed_spaces=su.allowed_spaces or [],
            college_year=getattr(su, "college_year", "Not Applicable"),
        )
        for su, club in records
    ]


@router.get("/clubs", response_model=List[ClubResponse])
async def list_clubs(
    session: AsyncSession = Depends(get_db)
) -> List[ClubResponse]:
    """Retrieve all student clubs/organizations for dropdown selector."""
    res = await session.execute(select(Club).order_by(Club.name.asc()))
    clubs = res.scalars().all()
    return [ClubResponse(id=c.id, name=c.name) for c in clubs]


@router.get("/me", response_model=UserProfileResponse)
async def get_current_user_profile(
    actor: Dict[str, Any] = Depends(get_current_actor),
    session: AsyncSession = Depends(get_db)
) -> UserProfileResponse:
    """Return profile details of current authenticated caller including New/Old cohort tag."""
    email = actor["email"]

    if actor["role"] == "admin":
        res = await session.execute(select(Admin).where(Admin.email == email))
        admin = res.scalar_one()
        return UserProfileResponse(
            id=admin.id,
            email=admin.email,
            name=admin.name,
            phone=None,
            role="admin",
            is_root=admin.is_root,
            authorized_spaces=["all"],
            created_at=admin.created_at,
            account_tag=None,
            college_year="Not Applicable",
            club_name=None,
        )

    if actor["role"] == "superuser":
        res = await session.execute(select(SuperUser).where(SuperUser.email == email))
        su = res.scalar_one()
        club_name = None
        if su.club_id:
            c_res = await session.execute(select(Club).where(Club.id == su.club_id))
            c = c_res.scalar_one_or_none()
            club_name = c.name if c else None
        return UserProfileResponse(
            id=su.id,
            email=su.email,
            name=su.name,
            phone=su.phone,
            role="superuser",
            is_root=False,
            club_name=club_name,
            authorized_spaces=su.allowed_spaces or [],
            created_at=su.created_at,
            account_tag=get_account_tag(su.created_at, updated_at=su.updated_at),
            college_year=getattr(su, "college_year", "Not Applicable"),
            note=getattr(su, "note", None),
        )

    res = await session.execute(select(User).where(User.email == email))
    user = res.scalar_one()
    club_name = None
    if user.club_id:
        c_res = await session.execute(select(Club).where(Club.id == user.club_id))
        c = c_res.scalar_one_or_none()
        club_name = c.name if c else None
    return UserProfileResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        phone=user.phone,
        role="user",
        is_root=False,
        club_name=club_name,
        authorized_spaces=[],
        created_at=user.created_at,
        account_tag=get_account_tag(user.created_at),
        college_year=getattr(user, "college_year", "Not Applicable"),
        note=getattr(user, "note", None),
    )


@router.get("/warning", response_model=PreResetWarningResponse)
async def get_reset_warning() -> PreResetWarningResponse:
    """Retrieve pre-reset warning banner status (active August 25 - August 31)."""
    warning_data = get_pre_reset_warning()
    return PreResetWarningResponse(
        is_warning_active=warning_data["is_warning_active"],
        warning_message=warning_data["warning_message"]
    )


@router.get("/quick-accounts")
async def get_quick_accounts(
    session: AsyncSession = Depends(get_db)
) -> List[Dict[str, Any]]:
    """Retrieve ordered accounts for the Quick Account Switcher dropdown.

    Ordering Rule:
    1. Source Administrator (rehankuriance@gmail.com) is always first.
    2. Then interleaved round-robin:
       - Latest logged in admin (root or normal)
       - Latest logged in superuser
       - Latest logged in user
       - And so on until lists exhaust.
    """
    # Fetch login tracking records from system_settings
    login_stmt = select(SystemSetting).where(SystemSetting.key.like("last_login:%"))
    login_res = await session.execute(login_stmt)
    last_logins: Dict[str, str] = {}
    for row in login_res.scalars().all():
        if "last_login:" in row.key:
            em = row.key.split("last_login:", 1)[1].lower().strip()
            last_logins[em] = str(row.value)

    source_email = settings.ROOT_ADMIN_EMAIL.lower().strip()

    # 1. Fetch Admins
    adm_stmt = select(Admin)
    adm_res = await session.execute(adm_stmt)
    admins = adm_res.scalars().all()

    source_admin_data = None
    other_admins_data = []

    for a in admins:
        em = a.email.lower().strip()
        ll = last_logins.get(em, a.created_at.isoformat() if a.created_at else "")
        acc_dict = {
            "email": a.email,
            "name": a.name,
            "role": "admin",
            "is_root": a.is_root,
            "badge": "Root" if a.is_root else "Admin",
            "subtitle": "Source Administrator" if em == source_email else ("Root Admin" if a.is_root else "System Admin"),
            "last_login": ll,
        }
        if em == source_email:
            source_admin_data = acc_dict
        else:
            other_admins_data.append(acc_dict)

    other_admins_data.sort(key=lambda x: x["last_login"], reverse=True)

    # 2. Fetch SuperUsers (active)
    su_stmt = select(SuperUser).where(SuperUser.is_active == True)
    su_res = await session.execute(su_stmt)
    all_superusers = su_res.scalars().all()
    superusers_data = []
    for su in all_superusers:
        em = su.email.lower().strip()
        ll = last_logins.get(
            em,
            su.updated_at.isoformat() if su.updated_at else (su.created_at.isoformat() if su.created_at else "")
        )
        spaces_str = ", ".join(su.allowed_spaces) if su.allowed_spaces else "Space Lead"
        superusers_data.append({
            "email": su.email,
            "name": su.name,
            "role": "superuser",
            "is_root": False,
            "badge": "SuperUser",
            "subtitle": f"Lead ({spaces_str})",
            "last_login": ll,
        })
    superusers_data.sort(key=lambda x: x["last_login"], reverse=True)

    # 3. Fetch Users (filter out emails that already belong to Admin or SuperUser)
    known_emails = {a.email.lower().strip() for a in admins} | {su.email.lower().strip() for su in all_superusers}
    u_stmt = select(User)
    u_res = await session.execute(u_stmt)
    users_data = []
    for u in u_res.scalars().all():
        em = u.email.lower().strip()
        if em in known_emails:
            continue
        ll = last_logins.get(em, u.created_at.isoformat() if u.created_at else "")
        users_data.append({
            "email": u.email,
            "name": u.name,
            "role": "user",
            "is_root": False,
            "badge": "Student",
            "subtitle": f"Student ({u.college_year or 'Entrant'})",
            "last_login": ll,
        })
    users_data.sort(key=lambda x: x["last_login"], reverse=True)

    # 4. Interleave: source admin first, then round-robin admin, superuser, user...
    result: List[Dict[str, Any]] = []
    if source_admin_data:
        result.append(source_admin_data)

    while other_admins_data or superusers_data or users_data:
        if other_admins_data:
            result.append(other_admins_data.pop(0))
        if superusers_data:
            result.append(superusers_data.pop(0))
        if users_data:
            result.append(users_data.pop(0))

    return result
