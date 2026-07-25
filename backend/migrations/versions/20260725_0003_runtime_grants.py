"""Grant environment-scoped runtime and reader access.

Revision ID: 20260725_0003
Revises: 20260719_0002
Create Date: 2026-07-25
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260725_0003"
down_revision: str | None = "20260719_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        DO $policy$
        DECLARE
            runtime_role text;
            object_creator text := current_user;
        BEGIN
            runtime_role := CASE current_database()
                WHEN 'ctc_staging' THEN 'ctc_app_staging'
                WHEN 'ctc_prod' THEN 'ctc_app_prod'
                ELSE NULL
            END;

            -- Local and ephemeral test databases do not use cloud runtime roles.
            IF runtime_role IS NULL THEN
                RETURN;
            END IF;

            EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', runtime_role);
            EXECUTE format(
                'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',
                runtime_role
            );
            EXECUTE format(
                'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I',
                runtime_role
            );
            EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', 'ctc_readonly');
            EXECUTE format(
                'GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I',
                'ctc_readonly'
            );
            EXECUTE format(
                'GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO %I',
                'ctc_readonly'
            );

            -- PostgreSQL default privileges belong to the role that actually
            -- creates an object. Alembic connects as ctc_migration_job, so use
            -- current_user rather than the inherited ctc_migrator group role.
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
                'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
                object_creator,
                runtime_role
            );
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
                'GRANT USAGE, SELECT ON SEQUENCES TO %I',
                object_creator,
                runtime_role
            );
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
                'GRANT SELECT ON TABLES TO %I',
                object_creator,
                'ctc_readonly'
            );
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
                'GRANT SELECT ON SEQUENCES TO %I',
                object_creator,
                'ctc_readonly'
            );
        END
        $policy$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $policy$
        DECLARE
            runtime_role text;
            object_creator text := current_user;
        BEGIN
            runtime_role := CASE current_database()
                WHEN 'ctc_staging' THEN 'ctc_app_staging'
                WHEN 'ctc_prod' THEN 'ctc_app_prod'
                ELSE NULL
            END;

            IF runtime_role IS NULL THEN
                RETURN;
            END IF;

            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
                'REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM %I',
                object_creator,
                runtime_role
            );
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
                'REVOKE USAGE, SELECT ON SEQUENCES FROM %I',
                object_creator,
                runtime_role
            );
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
                'REVOKE SELECT ON TABLES FROM %I',
                object_creator,
                'ctc_readonly'
            );
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
                'REVOKE SELECT ON SEQUENCES FROM %I',
                object_creator,
                'ctc_readonly'
            );
            EXECUTE format(
                'REVOKE SELECT, INSERT, UPDATE, DELETE '
                'ON ALL TABLES IN SCHEMA public FROM %I',
                runtime_role
            );
            EXECUTE format(
                'REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public FROM %I',
                runtime_role
            );
            EXECUTE format(
                'REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM %I',
                'ctc_readonly'
            );
            EXECUTE format(
                'REVOKE SELECT ON ALL SEQUENCES IN SCHEMA public FROM %I',
                'ctc_readonly'
            );
        END
        $policy$;
        """
    )
