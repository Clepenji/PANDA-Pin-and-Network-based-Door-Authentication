"""Initial PiBAS Normalized PostgreSQL Schema Migration.

Revision ID: a9c15669c747
Revises: None
Create Date: 2026-11-14 22:31:31.448793

This migration establishes the complete normalized database schema for PiBAS:
1. `admins`: Administrators including Root Admin with master privileges.
2. `clubs`: Campus clubs and student organizations.
3. `spaces`: Secured physical facility spaces linked to IoT door controllers (ESP32).
4. `superusers`: Delegated authorities who review and approve access requests.
5. `superuser_space_authorities`: Composite-key junction table granting SuperUsers approval jurisdiction.
6. `users`: Regular facility entrants petitioning for access.
7. `user_space_registrations`: Maps an entrant to an assigned SuperUser per Facility Space (enforces unique (user_email, space_id)).
8. `access_requests`: Formal access requests with justifications and status tracking.
9. `active_pins`: Ephemeral 6-digit access PINs with a partial unique index guaranteeing global uniqueness across unrevoked PINs.
10. `portal_logs`: User-facing audit feed strictly restricted to 3 event types (ACCESS_GRANTED, ACCESS_REJECTED, DOOR_OPENED).
11. `internal_audit_logs`: Detailed internal audit log including raw PIN codes, keypad attempts, and cohort purges for CSV export.
12. `push_subscriptions`: Web Push notification client endpoints and encryption keys.
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# Revision identifiers, used by Alembic.
revision: str = 'a9c15669c747'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Apply schema migrations to upgrade PostgreSQL database to revision a9c15669c747."""

    # -------------------------------------------------------------------------
    # 1. ADMINS TABLE
    # Stores administrative accounts. Seeded with root admin 'rehankuriance@gmail.com'.
    # -------------------------------------------------------------------------
    op.create_table(
        'admins',
        sa.Column('id', sa.UUID(), nullable=False, comment="Primary key UUID for administrator"),
        sa.Column('email', sa.String(length=255), nullable=False, comment="Unique admin email address"),
        sa.Column('name', sa.String(length=255), nullable=False, comment="Full name of administrator"),
        sa.Column('is_root', sa.Boolean(), nullable=False, default=False, comment="Indicates Root Administrator with master permissions"),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, comment="Account establishment timestamp with timezone"),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_admins'))
    )
    # Unique index on admin email for O(1) authentication lookups
    op.create_index(op.f('ix_admins_email'), 'admins', ['email'], unique=True)

    # -------------------------------------------------------------------------
    # 2. CLUBS TABLE
    # Student organizations and campus clubs for categorizing facility users.
    # -------------------------------------------------------------------------
    op.create_table(
        'clubs',
        sa.Column('id', sa.UUID(), nullable=False, comment="Primary key UUID for club entity"),
        sa.Column('name', sa.String(length=150), nullable=False, comment="Unique title of the campus organization"),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, comment="Registration timestamp with timezone"),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_clubs'))
    )
    # Unique index on club name to avoid duplicates
    op.create_index(op.f('ix_clubs_name'), 'clubs', ['name'], unique=True)

    # -------------------------------------------------------------------------
    # 3. INTERNAL AUDIT LOGS TABLE
    # High-security system event log storing raw PINs, valid/invalid keypad attempts,
    # resets, and cohort purges for administrative CSV export.
    # -------------------------------------------------------------------------
    op.create_table(
        'internal_audit_logs',
        sa.Column('id', sa.UUID(), nullable=False, comment="Primary key UUID for audit log entry"),
        sa.Column('event_type', sa.String(length=50), nullable=False, comment="Audit action: PIN_ISSUED, PIN_REVOKED, KEYPAD_VALID, KEYPAD_INVALID, SYSTEM_RESET, COHORT_PURGE"),
        sa.Column('pin_code', sa.String(length=6), nullable=True, comment="6-digit PIN code involved in the event"),
        sa.Column('user_email', sa.String(length=255), nullable=True, comment="Associated user email"),
        sa.Column('user_name', sa.String(length=100), nullable=True, comment="Associated user display name"),
        sa.Column('authority_name', sa.String(length=100), nullable=True, comment="Authorizing superuser/admin display name"),
        sa.Column('space_id', sa.UUID(), nullable=True, comment="Facility space UUID where event occurred"),
        sa.Column('details', postgresql.JSONB(astext_type=sa.Text()), nullable=False, comment="Structured JSON metadata, network IP, failure reason"),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, comment="Timestamp of event occurrence"),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_internal_audit_logs'))
    )
    # Chronological index for fast audit trail filtering and pagination
    op.create_index(op.f('ix_internal_audit_logs_created_at'), 'internal_audit_logs', ['created_at'], unique=False)

    # -------------------------------------------------------------------------
    # 4. PUSH SUBSCRIPTIONS TABLE
    # Browser client subscriptions for PWA Web Push notification delivery.
    # -------------------------------------------------------------------------
    op.create_table(
        'push_subscriptions',
        sa.Column('id', sa.UUID(), nullable=False, comment="Primary key UUID for subscription"),
        sa.Column('user_email', sa.String(length=255), nullable=False, comment="Subscribed user email"),
        sa.Column('endpoint', sa.Text(), nullable=False, comment="Unique browser push gateway endpoint URL"),
        sa.Column('p256dh', sa.Text(), nullable=False, comment="P-256 client public encryption key"),
        sa.Column('auth', sa.Text(), nullable=False, comment="Client authentication secret token"),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, comment="Timestamp subscription was recorded"),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_push_subscriptions')),
        sa.UniqueConstraint('endpoint', name=op.f('uq_push_subscriptions_endpoint'))
    )
    # Index on user email to easily dispatch notifications to all devices of a user
    op.create_index(op.f('ix_push_subscriptions_user_email'), 'push_subscriptions', ['user_email'], unique=False)

    # -------------------------------------------------------------------------
    # 5. SPACES TABLE
    # Physical secured zones ('Facility Spaces'). Modularized and seeded with SandBoxx 0 and 1.
    # -------------------------------------------------------------------------
    op.create_table(
        'spaces',
        sa.Column('id', sa.UUID(), nullable=False, comment="Primary key UUID for facility space"),
        sa.Column('slug', sa.String(length=50), nullable=False, comment="Unique alphanumeric slug identifier (e.g. sandboxx_0)"),
        sa.Column('name', sa.String(length=100), nullable=False, comment="Display name (e.g. SandBoxx 0)"),
        sa.Column('esp32_device_id', sa.String(length=100), nullable=False, comment="Hardware IoT controller identifier for the lock"),
        sa.Column('is_active', sa.Boolean(), nullable=False, default=True, comment="Operational state of facility space"),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_spaces'))
    )
    # Unique indices ensuring hardware controllers and slugs are strictly 1:1
    op.create_index(op.f('ix_spaces_esp32_device_id'), 'spaces', ['esp32_device_id'], unique=True)
    op.create_index(op.f('ix_spaces_slug'), 'spaces', ['slug'], unique=True)

    # -------------------------------------------------------------------------
    # 6. PORTAL LOGS TABLE
    # User-visible access log displaying strictly 3 event types in the UI dashboard.
    # -------------------------------------------------------------------------
    op.create_table(
        'portal_logs',
        sa.Column('id', sa.UUID(), nullable=False, comment="Primary key UUID for portal log"),
        sa.Column('event_type', sa.Enum('ACCESS_GRANTED', 'ACCESS_REJECTED', 'DOOR_OPENED', name='portal_event_type_enum'), nullable=False, comment="Strictly: ACCESS_GRANTED, ACCESS_REJECTED, DOOR_OPENED"),
        sa.Column('actor_email', sa.String(length=255), nullable=False, comment="Email of actor/entrant"),
        sa.Column('actor_name', sa.String(length=100), nullable=False, comment="Snapshot of entrant name"),
        sa.Column('club_name', sa.String(length=150), nullable=True, comment="Snapshot of entrant club"),
        sa.Column('space_id', sa.UUID(), nullable=False, comment="Target facility space foreign key"),
        sa.Column('space_name_snapshot', sa.String(length=100), nullable=False, comment="Preserved snapshot of space display name"),
        sa.Column('authority_name_snapshot', sa.String(length=100), nullable=False, comment="Authorizing SuperUser display name snapshot"),
        sa.Column('justification_snapshot', sa.String(length=256), nullable=True, comment="Preserved entrant access justification snapshot"),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, comment="Event creation timestamp"),
        sa.ForeignKeyConstraint(['space_id'], ['spaces.id'], name=op.f('fk_portal_logs_space_id_spaces'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_portal_logs'))
    )
    # Reverse-chronological index for efficient UI feed rendering
    op.create_index(op.f('ix_portal_logs_created_at'), 'portal_logs', ['created_at'], unique=False)

    # -------------------------------------------------------------------------
    # 7. SUPERUSERS TABLE
    # Delegated authority profiles capable of reviewing access requests and issuing PINs.
    # -------------------------------------------------------------------------
    op.create_table(
        'superusers',
        sa.Column('id', sa.UUID(), nullable=False, comment="Primary key UUID for superuser"),
        sa.Column('email', sa.String(length=255), nullable=False, comment="Unique institutional email address"),
        sa.Column('name', sa.String(length=100), nullable=False, comment="Full legal name (max 100 characters)"),
        sa.Column('phone', sa.String(length=20), nullable=False, comment="Mobile phone number (max 20 characters)"),
        sa.Column('club_id', sa.UUID(), nullable=True, comment="Associated club foreign key"),
        sa.Column('is_active', sa.Boolean(), nullable=False, default=True, comment="Operational status allowing reviews"),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, comment="Timestamp critical for July 15 annual cohort tracking"),
        sa.ForeignKeyConstraint(['club_id'], ['clubs.id'], name=op.f('fk_superusers_club_id_clubs'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_superusers'))
    )
    # Unique index for superuser authentication
    op.create_index(op.f('ix_superusers_email'), 'superusers', ['email'], unique=True)

    # -------------------------------------------------------------------------
    # 8. USERS TABLE
    # Standard facility entrants submitting access requests.
    # -------------------------------------------------------------------------
    op.create_table(
        'users',
        sa.Column('id', sa.UUID(), nullable=False, comment="Primary key UUID for user"),
        sa.Column('email', sa.String(length=255), nullable=False, comment="Unique institutional email address"),
        sa.Column('name', sa.String(length=100), nullable=False, comment="Full legal name (max 100 characters)"),
        sa.Column('phone', sa.String(length=20), nullable=False, comment="Mobile phone number (max 20 characters)"),
        sa.Column('club_id', sa.UUID(), nullable=True, comment="Associated club foreign key"),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, comment="Timestamp critical for July 15 annual cohort tracking"),
        sa.ForeignKeyConstraint(['club_id'], ['clubs.id'], name=op.f('fk_users_club_id_clubs'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_users'))
    )
    # Unique index for user authentication
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)

    # -------------------------------------------------------------------------
    # 9. ACCESS REQUESTS TABLE
    # Formal requests for PIN generation submitted by entrants to assigned superusers.
    # -------------------------------------------------------------------------
    op.create_table(
        'access_requests',
        sa.Column('id', sa.UUID(), nullable=False, comment="Primary key UUID for access request"),
        sa.Column('requester_email', sa.String(length=255), nullable=False, comment="Institutional email of entrant petitioner"),
        sa.Column('requester_name', sa.String(length=100), nullable=False, comment="Snapshot of requester name"),
        sa.Column('requester_phone', sa.String(length=20), nullable=False, comment="Snapshot of requester contact phone"),
        sa.Column('club_name_snapshot', sa.String(length=150), nullable=True, comment="Snapshot of club name at submission time"),
        sa.Column('space_id', sa.UUID(), nullable=False, comment="Target facility space foreign key"),
        sa.Column('target_superuser_id', sa.UUID(), nullable=True, comment="Target assigned superuser responsible for review"),
        sa.Column('justification', sa.String(length=256), nullable=False, comment="Non-empty access justification (max 256 characters)"),
        sa.Column('status', sa.Enum('PENDING', 'APPROVED', 'REJECTED', name='request_status_enum'), nullable=False, comment="Current request status"),
        sa.Column('resolved_by_superuser_id', sa.UUID(), nullable=True, comment="Foreign key of adjudicating superuser"),
        sa.Column('resolved_by_name_snapshot', sa.String(length=100), nullable=True, comment="Preserved display name of adjudicating superuser"),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, comment="Request submission timestamp"),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True, comment="Request resolution timestamp"),
        sa.ForeignKeyConstraint(['resolved_by_superuser_id'], ['superusers.id'], name=op.f('fk_access_requests_resolved_by_superuser_id_superusers'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['space_id'], ['spaces.id'], name=op.f('fk_access_requests_space_id_spaces'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['target_superuser_id'], ['superusers.id'], name=op.f('fk_access_requests_target_superuser_id_superusers'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_access_requests'))
    )
    # Index on requester email to query personal access request history
    op.create_index(op.f('ix_access_requests_requester_email'), 'access_requests', ['requester_email'], unique=False)

    # -------------------------------------------------------------------------
    # 10. SUPERUSER SPACE AUTHORITIES TABLE
    # Composite primary key junction mapping SuperUsers to Facility Spaces they govern.
    # -------------------------------------------------------------------------
    op.create_table(
        'superuser_space_authorities',
        sa.Column('superuser_id', sa.UUID(), nullable=False, comment="Superuser holding approval jurisdiction"),
        sa.Column('space_id', sa.UUID(), nullable=False, comment="Facility space governed by this superuser"),
        sa.ForeignKeyConstraint(['space_id'], ['spaces.id'], name=op.f('fk_superuser_space_authorities_space_id_spaces'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['superuser_id'], ['superusers.id'], name=op.f('fk_superuser_space_authorities_superuser_id_superusers'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('superuser_id', 'space_id', name=op.f('pk_superuser_space_authorities'))
    )

    # -------------------------------------------------------------------------
    # 11. USER SPACE REGISTRATIONS TABLE
    # Enforces 1:1 mapping of an entrant email to a single assigned SuperUser per Facility Space.
    # -------------------------------------------------------------------------
    op.create_table(
        'user_space_registrations',
        sa.Column('id', sa.UUID(), nullable=False, comment="Primary key UUID for registration record"),
        sa.Column('user_email', sa.String(length=255), nullable=False, comment="Entrant institutional email (allows regular users & off-jurisdiction superusers)"),
        sa.Column('space_id', sa.UUID(), nullable=False, comment="Facility space foreign key"),
        sa.Column('assigned_superuser_id', sa.UUID(), nullable=True, comment="Designated approving superuser for this entrant and space"),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, comment="Registration creation timestamp"),
        sa.ForeignKeyConstraint(['assigned_superuser_id'], ['superusers.id'], name=op.f('fk_user_space_registrations_assigned_superuser_id_superusers'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['space_id'], ['spaces.id'], name=op.f('fk_user_space_registrations_space_id_spaces'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_user_space_registrations')),
        # Enforces that a person has at most ONE registration and assigned SuperUser per Facility Space
        sa.UniqueConstraint('user_email', 'space_id', name='uq_user_space_registration')
    )
    # Index on user email for quick entrant registration lookups across spaces
    op.create_index(op.f('ix_user_space_registrations_user_email'), 'user_space_registrations', ['user_email'], unique=False)

    # -------------------------------------------------------------------------
    # 12. ACTIVE PINS TABLE
    # Approved 6-digit access PINs. Partial unique index guarantees global uniqueness across unrevoked PINs.
    # -------------------------------------------------------------------------
    op.create_table(
        'active_pins',
        sa.Column('id', sa.UUID(), nullable=False, comment="Primary key UUID for active PIN"),
        sa.Column('pin_code', sa.String(length=6), nullable=False, comment="6-digit numeric PIN code string"),
        sa.Column('grant_id', sa.UUID(), nullable=False, comment="Unique grant identifier linking to originating access request"),
        sa.Column('holder_email', sa.String(length=255), nullable=False, comment="Institutional email of authorized entrant"),
        sa.Column('holder_name', sa.String(length=100), nullable=False, comment="Snapshot name of authorized entrant"),
        sa.Column('space_id', sa.UUID(), nullable=False, comment="Target facility space foreign key"),
        sa.Column('approver_id', sa.UUID(), nullable=True, comment="Authorizing superuser foreign key"),
        sa.Column('approver_name_snapshot', sa.String(length=100), nullable=False, comment="Preserved display name of authorizing superuser"),
        sa.Column('issued_at', sa.DateTime(timezone=True), nullable=False, comment="PIN generation timestamp"),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False, comment="PIN expiration timestamp (issued_at + PIN_TTL_MINUTES)"),
        sa.Column('is_revoked', sa.Boolean(), nullable=False, default=False, comment="Revocation flag (premature deactivation)"),
        sa.ForeignKeyConstraint(['approver_id'], ['superusers.id'], name=op.f('fk_active_pins_approver_id_superusers'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['grant_id'], ['access_requests.id'], name=op.f('fk_active_pins_grant_id_access_requests'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['space_id'], ['spaces.id'], name=op.f('fk_active_pins_space_id_spaces'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_active_pins')),
        sa.UniqueConstraint('grant_id', name=op.f('uq_active_pins_grant_id'))
    )
    # Index on holder email for active access credential retrieval
    op.create_index(op.f('ix_active_pins_holder_email'), 'active_pins', ['holder_email'], unique=False)
    # Non-unique index on pin_code for general querying
    op.create_index(op.f('ix_active_pins_pin_code'), 'active_pins', ['pin_code'], unique=False)
    # Partial unique index ensuring that all active, unrevoked PIN codes are globally unique across all spaces.
    # Guarantees that a 6-digit keypad entry unambiguously identifies entrant and target space without collision.
    op.create_index(
        'uq_active_pins_unrevoked_pin_code',
        'active_pins',
        ['pin_code'],
        unique=True,
        postgresql_where=sa.text('is_revoked = FALSE')
    )


def downgrade() -> None:
    """Revert schema migrations by dropping all tables and types in reverse dependency order."""
    op.drop_index('uq_active_pins_unrevoked_pin_code', table_name='active_pins', postgresql_where=sa.text('is_revoked = FALSE'))
    op.drop_index(op.f('ix_active_pins_pin_code'), table_name='active_pins')
    op.drop_index(op.f('ix_active_pins_holder_email'), table_name='active_pins')
    op.drop_table('active_pins')

    op.drop_index(op.f('ix_user_space_registrations_user_email'), table_name='user_space_registrations')
    op.drop_table('user_space_registrations')

    op.drop_table('superuser_space_authorities')

    op.drop_index(op.f('ix_access_requests_requester_email'), table_name='access_requests')
    op.drop_table('access_requests')

    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')

    op.drop_index(op.f('ix_superusers_email'), table_name='superusers')
    op.drop_table('superusers')

    op.drop_index(op.f('ix_portal_logs_created_at'), table_name='portal_logs')
    op.drop_table('portal_logs')

    op.drop_index(op.f('ix_spaces_slug'), table_name='spaces')
    op.drop_index(op.f('ix_spaces_esp32_device_id'), table_name='spaces')
    op.drop_table('spaces')

    op.drop_index(op.f('ix_push_subscriptions_user_email'), table_name='push_subscriptions')
    op.drop_table('push_subscriptions')

    op.drop_index(op.f('ix_internal_audit_logs_created_at'), table_name='internal_audit_logs')
    op.drop_table('internal_audit_logs')

    op.drop_index(op.f('ix_clubs_name'), table_name='clubs')
    op.drop_table('clubs')

    op.drop_index(op.f('ix_admins_email'), table_name='admins')
    op.drop_table('admins')

    # Drop custom PostgreSQL Enums
    sa.Enum(name='portal_event_type_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='request_status_enum').drop(op.get_bind(), checkfirst=True)
