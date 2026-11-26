"""add_reg_accepted_and_pin_revoked_enum_values

Revision ID: b1c4e7f8a9d0
Revises: e8c3b1a7d2e9
Create Date: 2026-11-24 18:45:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b1c4e7f8a9d0'
down_revision: Union[str, Sequence[str], None] = 'e8c3b1a7d2e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add REG_ACCEPTED and PIN_REVOKED to entry_event_type_enum."""
    op.execute("ALTER TYPE entry_event_type_enum ADD VALUE IF NOT EXISTS 'REG_ACCEPTED';")
    op.execute("ALTER TYPE entry_event_type_enum ADD VALUE IF NOT EXISTS 'PIN_REVOKED';")


def downgrade() -> None:
    """Downgrade schema - PostgreSQL enums cannot easily drop values without recreating."""
    pass
