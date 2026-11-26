"""add_college_year_and_updated_at

Revision ID: e8c3b1a7d2e9
Revises: c7b2a9e4d1f0
Create Date: 2026-11-24 01:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'e8c3b1a7d2e9'
down_revision: Union[str, Sequence[str], None] = 'c7b2a9e4d1f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add college_year to users/superusers and updated_at to superusers."""
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS college_year VARCHAR(30) NOT NULL DEFAULT 'Not Applicable';")
    op.execute("ALTER TABLE superusers ADD COLUMN IF NOT EXISTS college_year VARCHAR(30) NOT NULL DEFAULT 'Not Applicable';")
    op.execute("ALTER TABLE superusers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();")


def downgrade() -> None:
    """Revert additions."""
    op.drop_column('superusers', 'updated_at')
    op.drop_column('superusers', 'college_year')
    op.drop_column('users', 'college_year')
