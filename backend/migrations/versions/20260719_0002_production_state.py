"""Add durable administration, review queue, and archive state.

Revision ID: 20260719_0002
Revises: 20260719_0001
Create Date: 2026-07-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260719_0002"
down_revision: str | None = "20260719_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "admin_users",
        sa.Column("admin_user_id", sa.Integer(), primary_key=True),
        sa.Column("firebase_uid", sa.Text()),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("normalized_email", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("github_username", sa.Text()),
        sa.Column("database_access_status", sa.Text(), nullable=False),
        sa.Column("repository_access_status", sa.Text(), nullable=False),
        sa.Column("created_by_admin_user_id", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("last_login_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("role IN ('owner', 'admin')", name="ck_admin_user_role"),
        sa.CheckConstraint(
            "status IN ('invited', 'active', 'revoked')", name="ck_admin_user_status"
        ),
        sa.CheckConstraint(
            "database_access_status IN ('not_requested', 'provisioned', 'revoked')",
            name="ck_admin_user_database_access",
        ),
        sa.CheckConstraint(
            "repository_access_status IN ('not_requested', 'provisioned', 'revoked')",
            name="ck_admin_user_repository_access",
        ),
        sa.ForeignKeyConstraint(["created_by_admin_user_id"], ["admin_users.admin_user_id"]),
        sa.UniqueConstraint("firebase_uid"),
        sa.UniqueConstraint("normalized_email"),
    )
    op.create_table(
        "review_submissions",
        sa.Column("submission_id", sa.Text(), primary_key=True),
        sa.Column("fingerprint", sa.Text(), nullable=False),
        sa.Column("queue_object_key", sa.Text(), nullable=False),
        sa.Column("original_filename", sa.Text(), nullable=False),
        sa.Column("content_length", sa.Integer(), nullable=False),
        sa.Column("validation_version", sa.Text(), nullable=False),
        sa.Column("warnings_json", sa.Text(), nullable=False),
        sa.Column("warnings_acknowledged", sa.Boolean(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("claimed_by_admin_user_id", sa.Integer()),
        sa.Column("claimed_at", sa.DateTime(timezone=True)),
        sa.Column("reviewed_by_admin_user_id", sa.Integer()),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("decision_note", sa.Text()),
        sa.Column("accepted_match_id", sa.Integer()),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'in_review', 'accepted', 'rejected', 'expired', 'failed')",
            name="ck_review_submission_status",
        ),
        sa.ForeignKeyConstraint(["claimed_by_admin_user_id"], ["admin_users.admin_user_id"]),
        sa.ForeignKeyConstraint(["reviewed_by_admin_user_id"], ["admin_users.admin_user_id"]),
        sa.ForeignKeyConstraint(
            ["accepted_match_id"],
            ["matches.match_id"],
            name="fk_review_submissions_accepted_match_id",
            use_alter=True,
        ),
        sa.UniqueConstraint("queue_object_key"),
    )
    op.create_index(
        "ix_review_submissions_status_submitted",
        "review_submissions",
        ["status", "submitted_at"],
    )
    op.create_index("ix_review_submissions_fingerprint", "review_submissions", ["fingerprint"])
    op.create_index(
        "uq_review_submissions_active_fingerprint",
        "review_submissions",
        ["fingerprint"],
        unique=True,
        postgresql_where=sa.text("status IN ('pending', 'in_review')"),
        sqlite_where=sa.text("status IN ('pending', 'in_review')"),
    )
    op.create_table(
        "submission_rate_limits",
        sa.Column("network_key", sa.Text(), primary_key=True),
        sa.Column("window_started_at", sa.DateTime(timezone=True), primary_key=True),
        sa.Column("request_count", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_submission_rate_limits_expires_at",
        "submission_rate_limits",
        ["expires_at"],
    )
    op.create_table(
        "health_issue_reviews",
        sa.Column("issue_key", sa.Text(), primary_key=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("reviewed_by_admin_user_id", sa.Integer(), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('open', 'dismissed')", name="ck_health_issue_review_status"),
        sa.ForeignKeyConstraint(["reviewed_by_admin_user_id"], ["admin_users.admin_user_id"]),
    )
    op.create_table(
        "admin_audit_logs",
        sa.Column("admin_audit_log_id", sa.Integer(), primary_key=True),
        sa.Column("admin_user_id", sa.Integer()),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("target_type", sa.Text()),
        sa.Column("target_id", sa.Text()),
        sa.Column("request_id", sa.Text(), nullable=False),
        sa.Column("details_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["admin_user_id"], ["admin_users.admin_user_id"]),
    )
    op.create_index("ix_admin_audit_logs_action", "admin_audit_logs", ["action"])
    op.create_index("ix_admin_audit_logs_request_id", "admin_audit_logs", ["request_id"])
    op.create_index("ix_admin_audit_logs_created_at", "admin_audit_logs", ["created_at"])

    with op.batch_alter_table("source_files") as batch_op:
        batch_op.add_column(
            sa.Column("storage_provider", sa.Text(), nullable=False, server_default="local")
        )
        batch_op.add_column(sa.Column("storage_object_key", sa.Text()))
        batch_op.add_column(
            sa.Column("archive_status", sa.Text(), nullable=False, server_default="complete")
        )
        batch_op.add_column(sa.Column("storage_generation", sa.Text()))
        batch_op.add_column(sa.Column("accepted_by_admin_user_id", sa.Integer()))
        batch_op.add_column(sa.Column("review_submission_id", sa.Text()))
        batch_op.add_column(sa.Column("archived_at", sa.DateTime(timezone=True)))
        batch_op.add_column(
            sa.Column("archive_attempts", sa.Integer(), nullable=False, server_default="0")
        )
        batch_op.add_column(sa.Column("last_archive_error_code", sa.Text()))
        batch_op.create_check_constraint(
            "ck_source_file_storage_provider", "storage_provider IN ('local', 'gcs')"
        )
        batch_op.create_check_constraint(
            "ck_source_file_archive_status",
            "archive_status IN ('pending', 'complete', 'repair_required')",
        )
        batch_op.create_foreign_key(
            "fk_source_files_accepted_by_admin_user_id",
            "admin_users",
            ["accepted_by_admin_user_id"],
            ["admin_user_id"],
        )
        batch_op.create_foreign_key(
            "fk_source_files_review_submission_id",
            "review_submissions",
            ["review_submission_id"],
            ["submission_id"],
        )

    # ``use_alter`` preserves the SQLite create-table path while breaking the
    # review_submissions -> matches -> source_files cycle on PostgreSQL.
    if op.get_bind().dialect.name != "sqlite":
        op.create_foreign_key(
            "fk_review_submissions_accepted_match_id",
            "review_submissions",
            "matches",
            ["accepted_match_id"],
            ["match_id"],
        )

    op.execute(
        sa.text(
            "UPDATE source_files SET storage_object_key = source_path, archived_at = imported_at "
            "WHERE storage_object_key IS NULL"
        )
    )


def downgrade() -> None:
    with op.batch_alter_table("source_files") as batch_op:
        batch_op.drop_constraint("fk_source_files_review_submission_id", type_="foreignkey")
        batch_op.drop_constraint("fk_source_files_accepted_by_admin_user_id", type_="foreignkey")
        batch_op.drop_constraint("ck_source_file_archive_status", type_="check")
        batch_op.drop_constraint("ck_source_file_storage_provider", type_="check")
        batch_op.drop_column("last_archive_error_code")
        batch_op.drop_column("archive_attempts")
        batch_op.drop_column("archived_at")
        batch_op.drop_column("review_submission_id")
        batch_op.drop_column("accepted_by_admin_user_id")
        batch_op.drop_column("storage_generation")
        batch_op.drop_column("archive_status")
        batch_op.drop_column("storage_object_key")
        batch_op.drop_column("storage_provider")

    op.drop_index("ix_admin_audit_logs_created_at", table_name="admin_audit_logs")
    op.drop_index("ix_admin_audit_logs_request_id", table_name="admin_audit_logs")
    op.drop_index("ix_admin_audit_logs_action", table_name="admin_audit_logs")
    op.drop_table("admin_audit_logs")
    op.drop_table("health_issue_reviews")
    op.drop_index("ix_submission_rate_limits_expires_at", table_name="submission_rate_limits")
    op.drop_table("submission_rate_limits")
    op.drop_index("uq_review_submissions_active_fingerprint", table_name="review_submissions")
    op.drop_index("ix_review_submissions_fingerprint", table_name="review_submissions")
    op.drop_index("ix_review_submissions_status_submitted", table_name="review_submissions")
    op.drop_table("review_submissions")
    op.drop_table("admin_users")
