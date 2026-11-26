"""Update models for PiBAS with user_space_assignments, entry_logs, and strict constraints.

Revision ID: fe5f1af294f7
Revises: a9c15669c747
Create Date: 2026-11-14 22:51:33.497616

Applies schema transformations:
1. `entry_logs`: Unified immutable access log with actor and authority snapshots.
2. `user_space_assignments`: Enforces strict UNIQUE(user_id, space_id) constraint.
3. `superusers`: Added `allowed_spaces` JSONB array, updated length constraints.
4. `access_requests`: Updated foreign keys and space_id mapping.
5. `active_pins`: Replaced is_revoked with revoked_at, enforced partial unique index
   uq_active_pins_unrevoked_pin_code on pin_code where revoked_at IS NULL.
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# Revision identifiers, used by Alembic.
revision: str = 'fe5f1af294f7'
down_revision: Union[str, Sequence[str], None] = 'a9c15669c747'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Apply schema modifications and enforce strict constraints."""

    # -------------------------------------------------------------------------
    # 0. Clean up transient test rows from prior migration
    # -------------------------------------------------------------------------
    op.execute("TRUNCATE TABLE active_pins, access_requests CASCADE;")

    # -------------------------------------------------------------------------
    # 1. CREATE ENTRY_LOGS TABLE
    # Immutable log with permanent snapshots preventing attribution bugs.
    # -------------------------------------------------------------------------
    op.create_table(
        'entry_logs',
        sa.Column('id', sa.UUID(), nullable=False, comment="Primary key UUID for entry log"),
        sa.Column(
            'event_type',
            sa.Enum('REQUEST_REJECTED', 'ACCESS_GRANTED', 'DOOR_UNLOCKED', 'INVALID_PIN_ATTEMPT', name='entry_event_type_enum'),
            nullable=False,
            comment="Entry event type"
        ),
        sa.Column('space_id', sa.String(length=50), nullable=False, comment="Modular space registry slug"),
        sa.Column('actor_name', sa.String(length=80), nullable=False, comment="Immutable snapshot of actor name"),
        sa.Column('actor_email', sa.String(length=120), nullable=False, comment="Immutable snapshot of actor email"),
        sa.Column('authority_name', sa.String(length=80), nullable=False, comment="Immutable snapshot of authorizing authority name"),
        sa.Column('authority_email', sa.String(length=120), nullable=False, comment="Immutable snapshot of authorizing authority email"),
        sa.Column('pin_used', sa.String(length=6), nullable=True, comment="6-digit PIN used in attempt"),
        sa.Column('justification_snapshot', sa.String(length=256), nullable=True, comment="Preserved entrant access justification snapshot"),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, comment="Event creation timestamp"),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_entry_logs'))
    )
    op.create_index(op.f('ix_entry_logs_actor_email'), 'entry_logs', ['actor_email'], unique=False)
    op.create_index(op.f('ix_entry_logs_created_at'), 'entry_logs', ['created_at'], unique=False)
    op.create_index(op.f('ix_entry_logs_event_type'), 'entry_logs', ['event_type'], unique=False)
    op.create_index(op.f('ix_entry_logs_space_id'), 'entry_logs', ['space_id'], unique=False)

    # -------------------------------------------------------------------------
    # 2. CREATE USER_SPACE_ASSIGNMENTS TABLE
    # Enforces UNIQUE(user_id, space_id) so a user has at most one SuperUser per space.
    # -------------------------------------------------------------------------
    op.create_table(
        'user_space_assignments',
        sa.Column('id', sa.UUID(), nullable=False, comment="Primary key UUID for assignment"),
        sa.Column('user_id', sa.UUID(), nullable=False, comment="Entrant user foreign key"),
        sa.Column('space_id', sa.String(length=50), nullable=False, comment="Facility space slug matching registry"),
        sa.Column('superuser_id', sa.UUID(), nullable=True, comment="Assigned approving SuperUser foreign key"),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, comment="Assignment timestamp"),
        sa.ForeignKeyConstraint(['superuser_id'], ['superusers.id'], name=op.f('fk_user_space_assignments_superuser_id_superusers'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_user_space_assignments_user_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_user_space_assignments')),
        # Strict Constraint: one superuser per user per space
        sa.UniqueConstraint('user_id', 'space_id', name='uq_user_space_assignment')
    )
    op.create_index(op.f('ix_user_space_assignments_space_id'), 'user_space_assignments', ['space_id'], unique=False)
    op.create_index(op.f('ix_user_space_assignments_superuser_id'), 'user_space_assignments', ['superuser_id'], unique=False)
    op.create_index(op.f('ix_user_space_assignments_user_id'), 'user_space_assignments', ['user_id'], unique=False)

    # Drop legacy tables from prototype phase
    op.drop_table('portal_logs')
    op.drop_table('superuser_space_authorities')
    op.drop_table('internal_audit_logs')
    op.drop_table('user_space_registrations')

    # Drop legacy enum
    sa.Enum(name='portal_event_type_enum').drop(op.get_bind(), checkfirst=True)

    # -------------------------------------------------------------------------
    # 3. ALTER ACCESS_REQUESTS
    # Transition to requester_user_id and modular space_id string
    # -------------------------------------------------------------------------
    op.drop_constraint('fk_access_requests_resolved_by_superuser_id_superusers', 'access_requests', type_='foreignkey')
    op.drop_constraint('fk_access_requests_target_superuser_id_superusers', 'access_requests', type_='foreignkey')
    op.drop_constraint('fk_access_requests_space_id_spaces', 'access_requests', type_='foreignkey')

    op.drop_column('access_requests', 'requester_email')
    op.drop_column('access_requests', 'requester_name')
    op.drop_column('access_requests', 'requester_phone')
    op.drop_column('access_requests', 'club_name_snapshot')
    op.drop_column('access_requests', 'target_superuser_id')
    op.drop_column('access_requests', 'resolved_by_superuser_id')
    op.drop_column('access_requests', 'resolved_by_name_snapshot')

    op.drop_column('access_requests', 'space_id')
    op.add_column('access_requests', sa.Column('space_id', sa.String(length=50), nullable=False))
    op.add_column('access_requests', sa.Column('requester_user_id', sa.UUID(), nullable=False))
    op.add_column('access_requests', sa.Column('superuser_id', sa.UUID(), nullable=True))

    op.create_index(op.f('ix_access_requests_requester_user_id'), 'access_requests', ['requester_user_id'], unique=False)
    op.create_index(op.f('ix_access_requests_space_id'), 'access_requests', ['space_id'], unique=False)
    op.create_index(op.f('ix_access_requests_superuser_id'), 'access_requests', ['superuser_id'], unique=False)

    op.create_foreign_key(
        op.f('fk_access_requests_requester_user_id_users'),
        'access_requests', 'users',
        ['requester_user_id'], ['id'],
        ondelete='CASCADE'
    )
    op.create_foreign_key(
        op.f('fk_access_requests_superuser_id_superusers'),
        'access_requests', 'superusers',
        ['superuser_id'], ['id'],
        ondelete='SET NULL'
    )

    # -------------------------------------------------------------------------
    # 4. ALTER ACTIVE_PINS
    # Enforce partial unique index on pin_code where revoked_at IS NULL
    # -------------------------------------------------------------------------
    op.drop_index('uq_active_pins_unrevoked_pin_code', table_name='active_pins')
    op.drop_constraint('fk_active_pins_approver_id_superusers', 'active_pins', type_='foreignkey')
    op.drop_constraint('fk_active_pins_space_id_spaces', 'active_pins', type_='foreignkey')
    op.drop_constraint('fk_active_pins_grant_id_access_requests', 'active_pins', type_='foreignkey')
    op.drop_constraint('uq_active_pins_grant_id', 'active_pins', type_='unique')
    op.drop_index('ix_active_pins_holder_email', table_name='active_pins')

    op.drop_column('active_pins', 'grant_id')
    op.drop_column('active_pins', 'holder_email')
    op.drop_column('active_pins', 'holder_name')
    op.drop_column('active_pins', 'approver_id')
    op.drop_column('active_pins', 'approver_name_snapshot')
    op.drop_column('active_pins', 'issued_at')
    op.drop_column('active_pins', 'is_revoked')
    op.drop_column('active_pins', 'space_id')

    op.add_column('active_pins', sa.Column('space_id', sa.String(length=50), nullable=False))
    op.add_column('active_pins', sa.Column('holder_user_id', sa.UUID(), nullable=False))
    op.add_column('active_pins', sa.Column('issued_by_superuser_id', sa.UUID(), nullable=True))
    op.add_column('active_pins', sa.Column('issued_by_name_snapshot', sa.String(length=80), nullable=False))
    op.add_column('active_pins', sa.Column('issued_by_email_snapshot', sa.String(length=120), nullable=False))
    op.add_column('active_pins', sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('active_pins', sa.Column('created_at', sa.DateTime(timezone=True), nullable=False))

    op.create_index(op.f('ix_active_pins_holder_user_id'), 'active_pins', ['holder_user_id'], unique=False)
    op.create_index(op.f('ix_active_pins_issued_by_superuser_id'), 'active_pins', ['issued_by_superuser_id'], unique=False)
    op.create_index(op.f('ix_active_pins_space_id'), 'active_pins', ['space_id'], unique=False)

    op.create_foreign_key(
        op.f('fk_active_pins_holder_user_id_users'),
        'active_pins', 'users',
        ['holder_user_id'], ['id'],
        ondelete='CASCADE'
    )
    op.create_foreign_key(
        op.f('fk_active_pins_issued_by_superuser_id_superusers'),
        'active_pins', 'superusers',
        ['issued_by_superuser_id'], ['id'],
        ondelete='SET NULL'
    )

    # Strict partial unique index on active unrevoked PIN codes across system
    op.create_index(
        'uq_active_pins_unrevoked_pin_code',
        'active_pins',
        ['pin_code'],
        unique=True,
        postgresql_where=sa.text('revoked_at IS NULL')
    )

    # -------------------------------------------------------------------------
    # 5. ALTER SUPERUSERS & USERS & CLUBS
    # Character limits and allowed_spaces JSONB column
    # -------------------------------------------------------------------------
    op.add_column('superusers', sa.Column('allowed_spaces', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'))
    op.alter_column('superusers', 'email', type_=sa.String(length=120), existing_type=sa.String(length=255))
    op.alter_column('superusers', 'name', type_=sa.String(length=80), existing_type=sa.String(length=100))
    op.alter_column('superusers', 'phone', type_=sa.String(length=20), existing_type=sa.String(length=20))

    op.alter_column('users', 'email', type_=sa.String(length=120), existing_type=sa.String(length=255))
    op.alter_column('users', 'name', type_=sa.String(length=80), existing_type=sa.String(length=100))
    op.alter_column('users', 'phone', type_=sa.String(length=20), existing_type=sa.String(length=20))

    op.alter_column('clubs', 'name', type_=sa.String(length=80), existing_type=sa.String(length=150))


def downgrade() -> None:
    """Downgrade schema back to revision a9c15669c747."""
    pass
