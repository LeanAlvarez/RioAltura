"""Spec 020: the rules are tested against the real incident and the real floods.

Every number here comes from the production series, not from an invented
scenario: a rule that only works on made-up data is not a rule.
"""

from datetime import date

from app.config.dominio import DESACUERDO_MAX_FUENTES_M, DESVIO_PICO_MAX_M
from app.services.calidad_alturas import (
    LecturaDiaria,
    desacuerdo,
    desvio_contra_vecinos,
    fechas_pico,
    sospechosas_por_desacuerdo,
)

# --- El incidente real del 2026-09-23 -----------------------------------

INCIDENTE = [
    LecturaDiaria(date(2026, 9, 23), "ina", 6.24),
    LecturaDiaria(date(2026, 9, 23), "caru", 3.98),
]
# Los tres días anteriores el río estuvo en 4,29.
REFERENCIA_PREVIA = 4.29


def test_el_incidente_real_se_detecta() -> None:
    assert desacuerdo(INCIDENTE) > DESACUERDO_MAX_FUENTES_M


def test_el_incidente_real_pone_en_cuarentena_al_ina_y_no_a_caru() -> None:
    """CARU (3,98) sigue la realidad; el INA (6,24) se va 2,26 m."""
    sospechosas = sospechosas_por_desacuerdo(INCIDENTE, REFERENCIA_PREVIA)
    assert [lectura.fuente for lectura in sospechosas] == ["ina"]


def test_sin_referencia_no_se_marca_nada() -> None:
    """Marcar sobre ninguna evidencia es peor que mostrar el dato con su fecha."""
    assert sospechosas_por_desacuerdo(INCIDENTE, None) == []


def test_el_desacuerdo_historico_maximo_no_dispara() -> None:
    """En 367 días dos fuentes nunca discreparon más de 0,335 m."""
    normales = [
        LecturaDiaria(date(2026, 5, 1), "ina", 4.00),
        LecturaDiaria(date(2026, 5, 1), "caru", 4.335),
    ]
    assert sospechosas_por_desacuerdo(normales, 4.10) == []


def test_una_sola_fuente_nunca_es_sospechosa_por_desacuerdo() -> None:
    una = [LecturaDiaria(date(2026, 9, 23), "ina", 6.24)]
    assert desacuerdo(una) == 0.0
    assert sospechosas_por_desacuerdo(una, REFERENCIA_PREVIA) == []


# --- Picos retrospectivos, contra la serie real -------------------------

# Los tres picos inequívocos de la serie: suben y vuelven.
PICO_2025_03 = [
    (date(2025, 3, 19), 0.83),
    (date(2025, 3, 20), 1.25),
    (date(2025, 3, 21), 3.82),
    (date(2025, 3, 22), 0.90),
    (date(2025, 3, 23), 0.96),
]
# Crecidas REALES: suben y siguen subiendo. No deben marcarse.
CRECIDA_2023_09 = [
    (date(2023, 9, 7), 2.60),
    (date(2023, 9, 8), 3.15),
    (date(2023, 9, 9), 4.68),
    (date(2023, 9, 10), 5.38),
    (date(2023, 9, 11), 5.90),
]
CRECIDA_2025_05 = [
    (date(2025, 5, 27), 2.80),
    (date(2025, 5, 28), 3.17),
    (date(2025, 5, 29), 4.35),
    (date(2025, 5, 30), 4.94),
    (date(2025, 5, 31), 5.20),
]


def test_marca_el_pico_real_de_marzo_2025() -> None:
    assert fechas_pico(PICO_2025_03) == [date(2025, 3, 21)]


def test_no_marca_los_hombros_del_pico() -> None:
    """El 20 y el 22 se desvían SÓLO por culpa del pico del 21.

    Por eso el algoritmo es iterativo: saca el peor, recalcula, y los
    vecinos vuelven a la normalidad.
    """
    marcadas = fechas_pico(PICO_2025_03)
    assert date(2025, 3, 20) not in marcadas
    assert date(2025, 3, 22) not in marcadas


def test_no_marca_crecidas_reales() -> None:
    assert fechas_pico(CRECIDA_2023_09) == []
    assert fechas_pico(CRECIDA_2025_05) == []


def test_el_caso_real_mas_exigente_no_se_marca() -> None:
    """2024-04-16: la subida real que más se acerca al umbral.

    Desvío medido: 0,93 m, contra un umbral de 1,00. Es el caso que fija el
    margen, así que va con los valores reales de la serie y no con un
    ejemplo inventado -- un primer intento usó datos imaginarios más
    abruptos que nada que haya ocurrido, y "falló" contra una regla sana.
    """
    real = [
        (date(2024, 4, 15), 4.50),
        (date(2024, 4, 16), 5.85),
        (date(2024, 4, 17), 5.34),
    ]
    assert fechas_pico(real) == []
    assert desvio_contra_vecinos(4.50, 5.85, 5.34) < DESVIO_PICO_MAX_M


def test_un_hueco_de_fechas_no_se_evalua() -> None:
    con_hueco = [
        (date(2026, 1, 1), 3.00),
        (date(2026, 1, 5), 6.00),
        (date(2026, 1, 6), 3.10),
    ]
    assert fechas_pico(con_hueco) == []


def test_desvio_contra_vecinos_es_simetrico() -> None:
    assert desvio_contra_vecinos(1.0, 3.0, 1.0) == 2.0
    assert desvio_contra_vecinos(3.0, 1.0, 3.0) == 2.0
    # Una recta no se desvía de sí misma.
    assert desvio_contra_vecinos(1.0, 2.0, 3.0) == 0.0


def test_los_umbrales_son_los_medidos() -> None:
    """Si alguien los cambia sin volver a medir, este test lo dice."""
    assert DESACUERDO_MAX_FUENTES_M == 0.60
    assert DESVIO_PICO_MAX_M == 1.00
