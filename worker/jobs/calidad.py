"""Apply the quality rules to already-stored readings (spec 020 D4).

Nothing is deleted: §9 keeps the history as the input for recalibration.
Suspect readings are marked, and every app query filters them out.

Run it after a deploy that adds the rules, and any time a source turns out
to have published a bad value:

    python -m jobs.calidad revisar            # dry run: says what it would mark
    python -m jobs.calidad revisar --aplicar  # marks it
"""

import argparse
import logging
from collections import defaultdict
from datetime import date, timedelta
from zoneinfo import ZoneInfo

from app.repositories.alturas import listar_para_calidad, marcar_sospechosas
from app.repositories.db import get_engine
from app.services.calidad_alturas import (
    LecturaDiaria,
    fechas_pico,
    sospechosas_por_desacuerdo,
)
from sqlalchemy import Engine

logger = logging.getLogger(__name__)

BUENOS_AIRES = ZoneInfo("America/Argentina/Buenos_Aires")

MOTIVO_DESACUERDO = "desacuerdo"
MOTIVO_PICO = "pico"


def _promedio(valores: list[float]) -> float:
    return sum(valores) / len(valores)


def revisar(engine: Engine) -> dict[str, list[int]]:
    """Return the row ids to quarantine, by reason. Does not write."""
    filas = listar_para_calidad(engine)

    # Una fila por (día local, fuente): las fuentes publican varias veces al
    # día y lo que se compara entre ellas es el valor del día.
    por_dia_fuente: dict[tuple[date, str], list[tuple[int, float]]] = defaultdict(list)
    for id_, fecha_hora, altura_m, fuente, _sospechosa in filas:
        dia = fecha_hora.astimezone(BUENOS_AIRES).date()
        por_dia_fuente[(dia, fuente)].append((id_, altura_m))

    dias = sorted({dia for dia, _ in por_dia_fuente})
    a_marcar: dict[str, list[int]] = {MOTIVO_DESACUERDO: [], MOTIVO_PICO: []}

    # --- D2: desacuerdo entre fuentes -----------------------------------
    # La referencia es el promedio del día anterior, que es lo que el río
    # estaba haciendo de verdad antes de la lectura en discusión.
    confirmado: dict[date, float] = {}
    for dia in dias:
        fuentes = {
            fuente: _promedio([a for _, a in por_dia_fuente[(dia, fuente)]])
            for (d, fuente) in por_dia_fuente
            if d == dia
        }
        referencia = confirmado.get(dia - timedelta(days=1))
        lecturas = [LecturaDiaria(dia, f, h) for f, h in fuentes.items()]
        sospechosas = sospechosas_por_desacuerdo(lecturas, referencia)
        nombres = {s.fuente for s in sospechosas}

        for fuente in nombres:
            a_marcar[MOTIVO_DESACUERDO].extend(id_ for id_, _ in por_dia_fuente[(dia, fuente)])

        buenas = [h for f, h in fuentes.items() if f not in nombres]
        if buenas:
            confirmado[dia] = _promedio(buenas)

    # --- D3: picos, sobre la serie ya depurada de desacuerdos -----------
    serie = [(dia, valor) for dia, valor in sorted(confirmado.items())]
    for dia in fechas_pico(serie):
        for (d, _fuente), filas_dia in por_dia_fuente.items():
            if d == dia:
                a_marcar[MOTIVO_PICO].extend(id_ for id_, _ in filas_dia)

    # Un día ya marcado por desacuerdo no se cuenta dos veces.
    ya = set(a_marcar[MOTIVO_DESACUERDO])
    a_marcar[MOTIVO_PICO] = [i for i in a_marcar[MOTIVO_PICO] if i not in ya]
    return a_marcar


def aplicar(engine: Engine) -> dict[str, int]:
    marcados: dict[str, int] = {}
    for motivo, ids in revisar(engine).items():
        marcados[motivo] = marcar_sospechosas(engine, ids, motivo)
    return marcados


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="jobs.calidad")
    sub = parser.add_subparsers(dest="command", required=True)
    revisar_parser = sub.add_parser("revisar", help="Revisar las alturas ya guardadas")
    revisar_parser.add_argument(
        "--aplicar",
        action="store_true",
        help="Marcar de verdad (sin esto sólo informa qué marcaría)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    args = _parse_args(argv)
    engine = get_engine()
    if args.aplicar:
        for motivo, n in aplicar(engine).items():
            logger.info("calidad: marcadas %s filas por %s", n, motivo)
        return
    for motivo, ids in revisar(engine).items():
        logger.info("calidad: marcaría %s filas por %s (simulación)", len(ids), motivo)


if __name__ == "__main__":
    main()
