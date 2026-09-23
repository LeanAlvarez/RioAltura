"""calidad de alturas: cuarentena de lecturas sospechosas

Spec 020. No se borra nada (CLAUDE.md §9: los históricos son el insumo para
recalibrar): las lecturas dudosas se MARCAN y las lecturas de la app las
excluyen.

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "alturas",
        sa.Column(
            "sospechosa",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    # Por qué quedó en cuarentena, para poder auditarlo después sin
    # adivinar: "desacuerdo" o "pico".
    op.add_column("alturas", sa.Column("motivo_sospecha", sa.String(32), nullable=True))
    # Las consultas de la app filtran por esto en cada lectura.
    op.create_index("ix_alturas_sospechosa", "alturas", ["sospechosa"])


def downgrade() -> None:
    op.drop_index("ix_alturas_sospechosa", table_name="alturas")
    op.drop_column("alturas", "motivo_sospecha")
    op.drop_column("alturas", "sospechosa")
