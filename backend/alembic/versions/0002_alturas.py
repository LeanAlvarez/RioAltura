"""alturas

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-21 00:00:00+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "alturas",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("fecha_hora", sa.DateTime(timezone=True), nullable=False),
        sa.Column("altura_m", sa.Float(), nullable=False),
        sa.Column("fuente", sa.String(length=16), nullable=False),
        sa.Column(
            "creado_en",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint("fuente IN ('ina', 'prefectura')", name="ck_alturas_fuente"),
        sa.UniqueConstraint("fecha_hora", "fuente", name="uq_alturas_fecha_hora_fuente"),
    )
    op.create_index("ix_alturas_fecha_hora", "alturas", ["fecha_hora"])


def downgrade() -> None:
    op.drop_index("ix_alturas_fecha_hora", table_name="alturas")
    op.drop_table("alturas")
