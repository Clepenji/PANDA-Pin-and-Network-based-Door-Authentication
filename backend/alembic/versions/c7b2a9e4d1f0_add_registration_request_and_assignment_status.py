"""add_registration_request_and_assignment_status

Revision ID: c7b2a9e4d1f0
Revises: fd1a032161e9
Create Date: 2026-11-18 03:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c7b2a9e4d1f0'
down_revision: Union[str, Sequence[str], None] = 'fd1a032161e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade database schema with request_type on access_requests and status on user_space_assignments."""
    op.add_column(
        'access_requests',
        sa.Column('request_type', sa.String(length=30), nullable=False, server_default='ACCESS')
    )
    op.add_column(
        'user_space_assignments',
        sa.Column('status', sa.String(length=20), nullable=False, server_default='APPROVED')
    )


def downgrade() -> None:
    """Revert additions."""
    op.drop_column('user_space_assignments', 'status')
    op.drop_column('access_requests', 'request_type')
