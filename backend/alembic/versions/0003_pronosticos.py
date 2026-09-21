"""pronosticos

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-21 00:00:00+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "pronosticos",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("gauge_id", sa.String(length=64), nullable=False),
        sa.Column("emitido", sa.DateTime(timezone=True), nullable=False),
        sa.Column("fecha", sa.Date(), nullable=False),
        sa.Column("lead_dias", sa.Integer(), nullable=False),
        sa.Column("caudal_m3s", sa.Float(), nullable=False),
        sa.Column(
            "creado_en",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "gauge_id", "emitido", "fecha", name="uq_pronosticos_gauge_emitido_fecha"
        ),
    )
    op.create_index("ix_pronosticos_gauge_emitido", "pronosticos", ["gauge_id", "emitido"])


def downgrade() -> None:
    op.drop_index("ix_pronosticos_gauge_emitido", table_name="pronosticos")
    op.drop_table("pronosticos")
