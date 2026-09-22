"""salto_grande

Tres tablas nuevas para los datos hidrológicos de Salto Grande (spec 012):
comunicado diario (caudal aportado/evacuado, nivel de embalse, vertedero,
texto de proyección de CTM), caudal de la cascada aguas arriba por estación
y fecha, y lluvia observada/pronosticada por subcuenca y fecha.

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-22 00:00:00+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "salto_grande_comunicado",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("fecha", sa.Date(), nullable=False),
        sa.Column("aporte_m3s", sa.Float(), nullable=False),
        sa.Column("evacuado_m3s", sa.Float(), nullable=False),
        sa.Column("nivel_embalse_m", sa.Float(), nullable=False),
        sa.Column("estado_vertedero", sa.String(length=64), nullable=False),
        sa.Column("texto_proyeccion", sa.Text(), nullable=False),
        sa.Column(
            "creado_en",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("fecha", name="uq_salto_grande_comunicado_fecha"),
    )

    op.create_table(
        "salto_grande_caudal_cascada",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("estacion", sa.String(length=64), nullable=False),
        sa.Column("fecha", sa.Date(), nullable=False),
        sa.Column("caudal_m3s", sa.Float(), nullable=False),
        sa.Column(
            "creado_en",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "estacion", "fecha", name="uq_salto_grande_caudal_cascada_estacion_fecha"
        ),
    )
    op.create_index(
        "ix_salto_grande_caudal_cascada_fecha", "salto_grande_caudal_cascada", ["fecha"]
    )

    op.create_table(
        "salto_grande_lluvia",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("subcuenca", sa.String(length=64), nullable=False),
        sa.Column("fecha", sa.Date(), nullable=False),
        sa.Column("tipo", sa.String(length=16), nullable=False),
        sa.Column("lluvia_mm", sa.Float(), nullable=False),
        sa.Column(
            "creado_en",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "tipo IN ('observada', 'pronostico')", name="ck_salto_grande_lluvia_tipo"
        ),
        sa.UniqueConstraint(
            "subcuenca", "fecha", "tipo", name="uq_salto_grande_lluvia_subcuenca_fecha_tipo"
        ),
    )
    op.create_index("ix_salto_grande_lluvia_tipo_fecha", "salto_grande_lluvia", ["tipo", "fecha"])


def downgrade() -> None:
    op.drop_index("ix_salto_grande_lluvia_tipo_fecha", table_name="salto_grande_lluvia")
    op.drop_table("salto_grande_lluvia")
    op.drop_index("ix_salto_grande_caudal_cascada_fecha", table_name="salto_grande_caudal_cascada")
    op.drop_table("salto_grande_caudal_cascada")
    op.drop_table("salto_grande_comunicado")
