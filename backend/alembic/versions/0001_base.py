"""base

Revision ID: 0001
Revises:
Create Date: 2026-09-21 00:00:00+00:00

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Empty base revision: business tables arrive in later specs.
    pass


def downgrade() -> None:
    pass
