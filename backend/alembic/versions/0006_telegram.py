"""canal de telegram y avisos por umbral propio

Tres tablas nuevas, sin tocar ninguna existente (spec 011, CLAUDE.md §2):

- `telegram_estado_canal`: fila única (id=1) con el último nivel de aviso
  publicado en el canal, su antirebote/dedup (S1/S2), el gate diario de A2 y
  el offset de `getUpdates` para el bot.
- `telegram_envios_dia`: contador de mensajes por día local, tope duro (S3).
- `telegram_suscripciones`: un umbral propio por `chat_id` (spec 011, nivel
  2), con su propio antirebote/dedup.

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-22 00:00:00+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "telegram_estado_canal",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("nivel_publicado", sa.String(length=32), nullable=True),
        sa.Column("nivel_candidato", sa.String(length=32), nullable=True),
        sa.Column("corridas_candidato", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("publicado_en", sa.DateTime(timezone=True), nullable=True),
        sa.Column("mensaje_id", sa.BigInteger(), nullable=True),
        sa.Column("estado_diario_fecha", sa.Date(), nullable=True),
        sa.Column("ultimo_update_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "actualizado_en",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_table(
        "telegram_envios_dia",
        sa.Column("fecha", sa.Date(), primary_key=True),
        sa.Column("contador", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "telegram_suscripciones",
        sa.Column("chat_id", sa.BigInteger(), primary_key=True),
        sa.Column("umbral_m", sa.Float(), nullable=False),
        sa.Column("sobre_umbral", sa.Boolean(), nullable=True),
        sa.Column("candidato_sobre_umbral", sa.Boolean(), nullable=True),
        sa.Column("corridas_candidato", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "creado_en",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table("telegram_suscripciones")
    op.drop_table("telegram_envios_dia")
    op.drop_table("telegram_estado_canal")
