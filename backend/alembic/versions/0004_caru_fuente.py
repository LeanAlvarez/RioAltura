"""caru como tercera fuente de altura

Amplía el check de `alturas.fuente` para aceptar 'caru' (spec 009). La
restricción de unicidad ya es sobre (fecha_hora, fuente), así que dos fuentes
pueden convivir en el mismo instante sin tocarla.

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-22 00:00:00+00:00

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CONSTRAINT = "ck_alturas_fuente"


def upgrade() -> None:
    # SQLite no sabe alterar un CHECK en su lugar; `batch_alter_table` recrea
    # la tabla de forma transparente y en Postgres hace el DROP/ADD directo.
    with op.batch_alter_table("alturas") as batch:
        batch.drop_constraint(_CONSTRAINT, type_="check")
        batch.create_check_constraint(_CONSTRAINT, "fuente IN ('ina', 'prefectura', 'caru')")


def downgrade() -> None:
    # Volver atrás dejaría filas de CARU violando el check: se borran primero.
    # Son datos de respaldo reconstruibles desde la fuente, no historia única.
    op.execute("DELETE FROM alturas WHERE fuente = 'caru'")
    with op.batch_alter_table("alturas") as batch:
        batch.drop_constraint(_CONSTRAINT, type_="check")
        batch.create_check_constraint(_CONSTRAINT, "fuente IN ('ina', 'prefectura')")
