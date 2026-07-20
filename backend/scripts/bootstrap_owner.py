#!/usr/bin/env python3
import argparse
from datetime import datetime, timezone

from admin_auth import SessionLocal, normalize_email
from models import AdminUser
from sqlalchemy import select


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or restore the first application owner.")
    parser.add_argument("--email", required=True, help="Verified Google email for the owner.")
    args = parser.parse_args()
    email = normalize_email(args.email)
    if not email or "@" not in email:
        parser.error("A valid owner email is required.")

    with SessionLocal.begin() as session:
        existing_owner = session.scalar(select(AdminUser).where(AdminUser.role == "owner"))
        if existing_owner and existing_owner.normalized_email != email:
            parser.error(
                "An owner already exists. Change owner access through a reviewed database operation."
            )
        user = existing_owner or session.scalar(
            select(AdminUser).where(AdminUser.normalized_email == email)
        )
        if user is None:
            user = AdminUser(
                email=email,
                normalized_email=email,
                role="owner",
                status="invited",
                database_access_status="not_requested",
                repository_access_status="not_requested",
            )
            session.add(user)
        else:
            user.role = "owner"
            user.status = "active" if user.firebase_uid else "invited"
            user.revoked_at = None
            user.activated_at = user.activated_at or (
                datetime.now(timezone.utc) if user.firebase_uid else None
            )
        session.flush()
        print(f"Owner ready: {user.normalized_email} ({user.status})")


if __name__ == "__main__":
    main()
