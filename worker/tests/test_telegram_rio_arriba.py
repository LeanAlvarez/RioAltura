"""Tests for the M2 (spec 014) "Río arriba" block: appears only when it adds something."""

from datetime import UTC, date, datetime

from app.schemas.salto_grande import ComunicadoSaltoGrande, LluviaSubcuenca, SaltoGrande
from jobs.telegram_rio_arriba import construir_bloque_rio_arriba

AHORA = datetime(2026, 9, 22, 15, 0, tzinfo=UTC)


def _comunicado(evacuado_m3s: float, estado_vertedero: str = "Cerrado") -> ComunicadoSaltoGrande:
    return ComunicadoSaltoGrande(
        fecha=date(2026, 9, 22),
        aporte_m3s=evacuado_m3s,
        evacuado_m3s=evacuado_m3s,
        nivel_embalse_m=34.81,
        estado_vertedero=estado_vertedero,
        texto_proyeccion="texto de proyección de CTM",
    )


def _sg(
    comunicado: ComunicadoSaltoGrande | None = None,
    comunicado_anterior: ComunicadoSaltoGrande | None = None,
    lluvia_observada: list[LluviaSubcuenca] | None = None,
) -> SaltoGrande:
    return SaltoGrande(
        comunicado=comunicado,
        comunicado_anterior=comunicado_anterior,
        caudales_cascada=[],
        lluvia_observada=lluvia_observada or [],
        lluvia_pronostico=[],
    )


def test_dia_tranquilo_no_aparece_el_bloque() -> None:
    """Vertedero cerrado, sin lluvia fuerte, caudal estable: el bloque no aparece."""
    sg = _sg(
        comunicado=_comunicado(7_821, "Cerrado"),
        comunicado_anterior=_comunicado(7_800, "Cerrado"),
        lluvia_observada=[
            LluviaSubcuenca(subcuenca="El Soberbio", fecha=date(2026, 9, 20), lluvia_mm=1)
        ],
    )
    assert construir_bloque_rio_arriba(sg, AHORA) is None


def test_vertedero_abierto_dispara_el_bloque() -> None:
    sg = _sg(comunicado=_comunicado(7_821, "Abierto"))
    bloque = construir_bloque_rio_arriba(sg, AHORA)
    assert bloque is not None
    assert "🏞️ Río arriba" in bloque
    assert "vertedero abierto" in bloque


def test_lluvia_fuerte_dispara_el_bloque_y_muestra_la_frase() -> None:
    sg = _sg(
        comunicado=_comunicado(7_821, "Cerrado"),
        lluvia_observada=[
            LluviaSubcuenca(subcuenca="El Soberbio", fecha=date(2026, 9, 20), lluvia_mm=58),
        ],
    )
    bloque = construir_bloque_rio_arriba(sg, AHORA)
    assert bloque is not None
    assert "🌧️ Llovió 58 mm hace 2 días" in bloque
    assert "🚧 Salto Grande suelta 7.821 m³/s (vertedero cerrado)" in bloque


def test_lluvia_por_debajo_del_piso_no_dispara_el_bloque() -> None:
    sg = _sg(
        comunicado=_comunicado(7_821, "Cerrado"),
        comunicado_anterior=_comunicado(7_800, "Cerrado"),
        lluvia_observada=[
            LluviaSubcuenca(subcuenca="El Soberbio", fecha=date(2026, 9, 20), lluvia_mm=29.9),
        ],
    )
    assert construir_bloque_rio_arriba(sg, AHORA) is None


def test_subida_marcada_del_caudal_dispara_el_bloque() -> None:
    sg = _sg(
        comunicado=_comunicado(9_000, "Cerrado"), comunicado_anterior=_comunicado(7_800, "Cerrado")
    )
    bloque = construir_bloque_rio_arriba(sg, AHORA)
    assert bloque is not None
    assert "9.000 m³/s" in bloque


def test_subida_leve_del_caudal_no_dispara_el_bloque() -> None:
    # +5 %: por debajo del piso de "subida marcada" (15 %), aunque sea más que ayer.
    sg = _sg(
        comunicado=_comunicado(8_190, "Cerrado"), comunicado_anterior=_comunicado(7_800, "Cerrado")
    )
    assert construir_bloque_rio_arriba(sg, AHORA) is None


def test_sin_comunicado_pero_con_lluvia_fuerte_muestra_solo_la_lluvia() -> None:
    sg = _sg(
        comunicado=None,
        lluvia_observada=[
            LluviaSubcuenca(subcuenca="El Soberbio", fecha=date(2026, 9, 22), lluvia_mm=40),
        ],
    )
    bloque = construir_bloque_rio_arriba(sg, AHORA)
    assert bloque is not None
    assert "🌧️ Llovió 40 mm hoy" in bloque
    assert "Salto Grande suelta" not in bloque


def test_sin_datos_no_aparece_el_bloque() -> None:
    assert construir_bloque_rio_arriba(_sg(), AHORA) is None
