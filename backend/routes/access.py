import os

from admin_auth import (
    AuthenticationError,
    AuthorizationError,
    SessionLocal,
    authenticate_admin,
    normalize_email,
    record_audit,
    require_admin,
)
from flask import Blueprint, g, jsonify, request
from models import AdminUser
from sqlalchemy import func, select

access_api = Blueprint("access_api", __name__)


def _serialize_user(user: AdminUser) -> dict:
    return {
        "admin_user_id": user.admin_user_id,
        "email": user.email,
        "role": user.role,
        "status": user.status,
        "github_username": user.github_username,
        "database_access_status": user.database_access_status,
        "repository_access_status": user.repository_access_status,
        "created_at": user.created_at.isoformat(),
        "activated_at": user.activated_at.isoformat() if user.activated_at else None,
        "revoked_at": user.revoked_at.isoformat() if user.revoked_at else None,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
    }


@access_api.get("/api/auth/session")
def auth_session():
    try:
        with SessionLocal.begin() as session:
            actor = authenticate_admin(session)
        if actor is None:
            return jsonify({"authenticated": False})
        return jsonify(
            {
                "authenticated": True,
                "admin": {
                    "admin_user_id": actor.admin_user_id,
                    "email": actor.email,
                    "role": actor.role,
                },
            }
        )
    except AuthenticationError as error:
        return jsonify({"authenticated": False, "error": str(error)}), 401
    except AuthorizationError as error:
        return jsonify({"authenticated": False, "error": str(error)}), 403


@access_api.get("/api/admin/users")
@require_admin(owner=True)
def list_admin_users():
    with SessionLocal() as session:
        users = session.scalars(select(AdminUser).order_by(AdminUser.normalized_email)).all()
        return jsonify([_serialize_user(user) for user in users])


@access_api.post("/api/admin/users")
@require_admin(owner=True)
def invite_admin_user():
    payload = request.get_json(silent=True) or {}
    email = normalize_email(str(payload.get("email") or ""))
    if not email or "@" not in email:
        return jsonify({"error": "A valid Google email is required."}), 400
    role = payload.get("role", "admin")
    if role not in {"admin", "owner"}:
        return jsonify({"error": "Role must be admin or owner."}), 400
    with SessionLocal.begin() as session:
        if session.scalar(select(AdminUser).where(AdminUser.normalized_email == email)):
            return jsonify({"error": "That email is already configured."}), 409
        user = AdminUser(
            email=email,
            normalized_email=email,
            role=role,
            status="invited",
            github_username=(str(payload.get("github_username") or "").strip() or None),
            database_access_status="not_requested",
            repository_access_status="not_requested",
            created_by_admin_user_id=g.admin_actor.admin_user_id,
        )
        session.add(user)
        session.flush()
        record_audit(
            session,
            g.admin_actor,
            "admin.invite",
            target_type="admin_user",
            target_id=user.admin_user_id,
            details={"email": email, "role": role},
        )
        result = _serialize_user(user)
    return jsonify(result), 201


@access_api.patch("/api/admin/users/<int:admin_user_id>")
@require_admin(owner=True)
def update_admin_user(admin_user_id):
    payload = request.get_json(silent=True) or {}
    allowed_statuses = {"invited", "active", "revoked"}
    access_statuses = {"not_requested", "provisioned", "revoked"}
    with SessionLocal.begin() as session:
        user = session.get(AdminUser, admin_user_id)
        if user is None:
            return jsonify({"error": "Administrator was not found."}), 404
        status = payload.get("status", user.status)
        if status not in allowed_statuses:
            return jsonify({"error": "Invalid administrator status."}), 400
        if user.role == "owner" and status == "revoked":
            owner_count = session.scalar(
                select(func.count())
                .select_from(AdminUser)
                .where(AdminUser.role == "owner", AdminUser.status != "revoked")
            )
            if owner_count <= 1:
                return jsonify({"error": "The last active owner cannot be revoked."}), 409
        for field in ("database_access_status", "repository_access_status"):
            value = payload.get(field, getattr(user, field))
            if value not in access_statuses:
                return jsonify({"error": f"Invalid {field.replace('_', ' ')}."}), 400
            setattr(user, field, value)
        user.status = status
        user.github_username = (
            str(payload.get("github_username", user.github_username or "")).strip() or None
        )
        if status == "revoked":
            from datetime import datetime, timezone

            user.revoked_at = datetime.now(timezone.utc)
        else:
            user.revoked_at = None
        record_audit(
            session,
            g.admin_actor,
            "admin.update",
            target_type="admin_user",
            target_id=user.admin_user_id,
            details={
                "status": user.status,
                "database_access_status": user.database_access_status,
                "repository_access_status": user.repository_access_status,
            },
        )
        result = _serialize_user(user)
    return jsonify(result)


@access_api.get("/api/admin/access-instructions")
@require_admin
def access_instructions():
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "<project-id>")
    instance = os.environ.get("CLOUD_SQL_INSTANCE", "<instance-name>")
    connection = os.environ.get("CLOUD_SQL_CONNECTION_NAME", "<connection-name>")
    repository = os.environ.get("GITHUB_REPOSITORY", "Revengestyle6/ctcMKWIIstatswebsite")
    return jsonify(
        {
            "database": {
                "summary": "Read-only access uses IAM authentication through Cloud SQL Auth Proxy.",
                "commands": [
                    "gcloud auth login",
                    f"gcloud config set project {project}",
                    f"cloud-sql-proxy {connection} --port 5433",
                    "psql 'host=127.0.0.1 port=5433 dbname=ctc_prod user=<your-email> sslmode=disable'",
                ],
                "instance": instance,
            },
            "repository": {
                "summary": "Use a feature branch and open a pull request; protected branches require approval.",
                "commands": [
                    f"git clone git@github.com:{repository}.git",
                    "git switch -c <your-feature-branch>",
                    "git push -u origin <your-feature-branch>",
                ],
            },
        }
    )
