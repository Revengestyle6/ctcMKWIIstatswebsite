import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import wraps

from database import app_environment, get_session_factory
from flask import g, has_request_context, jsonify, request
from models import AdminAuditLog, AdminUser
from sqlalchemy import select

SessionLocal = get_session_factory()


class AuthenticationError(ValueError):
    pass


class AuthorizationError(ValueError):
    pass


@dataclass(frozen=True)
class AdminActor:
    admin_user_id: int
    firebase_uid: str
    email: str
    role: str

    @property
    def is_owner(self) -> bool:
        return self.role == "owner"


def normalize_email(email: str) -> str:
    return email.strip().casefold()


def _bearer_token() -> str:
    authorization = request.headers.get("Authorization", "")
    return (
        authorization.removeprefix("Bearer ").strip() if authorization.startswith("Bearer ") else ""
    )


def _verified_identity() -> tuple[str, str] | None:
    environment = app_environment()
    allow_dev_auth = os.environ.get("ALLOW_DEV_AUTH", "false").strip().lower() == "true"
    if environment in {"local", "test"} and allow_dev_auth:
        email = normalize_email(request.headers.get("X-Dev-Admin-Email", ""))
        if email:
            uid = request.headers.get("X-Dev-Admin-Uid", "").strip() or f"local:{email}"
            return uid, email

    token = _bearer_token()
    if not token:
        return None
    project_id = (
        os.environ.get("FIREBASE_PROJECT_ID") or os.environ.get("GOOGLE_CLOUD_PROJECT") or ""
    ).strip()
    if not project_id:
        raise AuthenticationError("Firebase authentication is not configured.")

    try:
        from google.auth.transport.requests import Request as GoogleRequest
        from google.oauth2.id_token import verify_firebase_token

        claims = verify_firebase_token(token, GoogleRequest(), audience=project_id)
    except Exception as error:
        raise AuthenticationError("The Firebase ID token is invalid or expired.") from error
    if not claims:
        raise AuthenticationError("The Firebase ID token is invalid or expired.")
    uid = str(claims.get("sub") or claims.get("uid") or "").strip()
    email = normalize_email(str(claims.get("email") or ""))
    if not uid or not email or claims.get("email_verified") is not True:
        raise AuthenticationError("A verified Google email is required.")
    return uid, email


def record_audit(
    session,
    actor: AdminActor | None,
    action: str,
    *,
    target_type: str | None = None,
    target_id: str | int | None = None,
    details: dict | None = None,
) -> AdminAuditLog:
    log = AdminAuditLog(
        admin_user_id=actor.admin_user_id if actor else None,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        request_id=getattr(g, "request_id", "system") if has_request_context() else "system",
        details_json=json.dumps(details or {}, ensure_ascii=False, separators=(",", ":")),
    )
    session.add(log)
    return log


def authenticate_admin(session) -> AdminActor | None:
    identity = _verified_identity()
    if identity is None:
        return None
    uid, email = identity
    local_development_identity = (
        app_environment() in {"local", "test"}
        and os.environ.get("ALLOW_DEV_AUTH", "false").strip().lower() == "true"
        and uid == f"local:{email}"
    )
    user = session.scalar(select(AdminUser).where(AdminUser.normalized_email == email))
    if user is None:
        raise AuthorizationError("This Google account is not an authorized administrator.")
    if user.status == "revoked":
        raise AuthorizationError("Administrator access has been revoked.")
    if user.firebase_uid and user.firebase_uid != uid and not local_development_identity:
        raise AuthorizationError("This administrator email is bound to another Firebase identity.")

    now = datetime.now(timezone.utc)
    first_activation = user.status == "invited" or (
        not user.firebase_uid and not local_development_identity
    )
    if not local_development_identity:
        user.firebase_uid = uid
    user.email = email
    user.normalized_email = email
    user.status = "active"
    user.activated_at = user.activated_at or now
    user.last_login_at = now
    session.flush()
    actor = AdminActor(user.admin_user_id, uid, user.email, user.role)
    if first_activation:
        record_audit(
            session,
            actor,
            "admin.activated",
            target_type="admin_user",
            target_id=user.admin_user_id,
        )
    return actor


def require_admin(view=None, *, owner=False):
    def decorator(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            try:
                with SessionLocal.begin() as session:
                    actor = authenticate_admin(session)
                    if actor is None:
                        return jsonify({"error": "Administrator sign-in is required."}), 401
                    if owner and not actor.is_owner:
                        return jsonify({"error": "Owner access is required."}), 403
                g.admin_actor = actor
                return function(*args, **kwargs)
            except AuthenticationError as error:
                return jsonify({"error": str(error)}), 401
            except AuthorizationError as error:
                return jsonify({"error": str(error)}), 403

        return wrapped

    return decorator(view) if view is not None else decorator
