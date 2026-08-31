"""Add match labels to review submissions.

Revision ID: 20260830_0014
Revises: 20260830_0013
"""

import sqlalchemy as sa
from alembic import op

revision = "20260830_0014"
down_revision = "20260830_0013"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("review_submissions", sa.Column("match_label", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("review_submissions", "match_label")
