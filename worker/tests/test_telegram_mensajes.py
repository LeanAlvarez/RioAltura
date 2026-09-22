"""Tests for message text (spec 014): M1 (estado diario), M3 (cambio de nivel corto) y
M4 (disciplina de emojis: cada emoji siempre acompañado de su texto).
"""

from datetime import UTC, date, datetime

from jobs.telegram_mensajes import (
    DiaResumen,
    calcular_tendencia_simple,
    mensaje_cambio_nivel,
    mensaje_estado_diario,
)

# Mismo calendario que usa el ejemplo literal de la spec 014 (2026-09-22 es
# martes; verificado con `date(2026, 9, 22).weekday()`).
HOY = date(2026, 9, 22)
AHORA = datetime(2026, 9, 22, 11, 0, tzinfo=UTC)  # 08:00 America/Argentina/Buenos_Aires
FECHA_DATO_HOY_00 = datetime(2026, 9, 22, 3, 0, tzinfo=UTC)  # 00:00 America/Argentina/Buenos_Aires

_DIAS_PRONOSTICO_EJEMPLO = [
    DiaResumen(date(2026, 9, 23), "sube", 2.9, 4.9),
    DiaResumen(date(2026, 9, 24), "sube", 3.3, 5.3),
    DiaResumen(date(2026, 9, 25), "sube", 3.8, 5.8),
]


# --- M1: estado diario ----------------------------------------------------------


def test_m1_estado_diario_reproduce_el_formato_exacto_de_la_spec() -> None:
    """Reproduce, campo a campo, el ejemplo literal de la sección M1 de la spec 014."""
    texto = mensaje_estado_diario(
        HOY,
        AHORA,
        4.29,
        "normal",
        0.02,  # < 5 cm: "estable"
        6.80,  # EVACUACION_EN_SECO_M
        _DIAS_PRONOSTICO_EJEMPLO,
        "sin_aviso",
        FECHA_DATO_HOY_00,
        "caru",
    )

    esperado = (
        "🌊 Río Uruguay en Colón — martes 22\n"
        "\n"
        "📏 Hoy: 4,29 m · Normal\n"
        "➡️ No subió ni bajó en el último día\n"
        "📉 Faltan 2,51 m para los 6,80 m\n"
        "\n"
        "🔮 Próximos días\n"
        "  mié 23  🔼  entre 2,9 y 4,9 m\n"
        "  jue 24  🔼  entre 3,3 y 5,3 m\n"
        "  vie 25  🔼  entre 3,8 y 5,8 m\n"
        "🟢 Hoy no hay alerta\n"
        "\n"
        "📅 Medición del puerto: hoy 00:00 (CARU)\n"
        "⚠️ Orientativo. No reemplaza a Prefectura ni a Defensa Civil."
    )
    assert texto == esperado


def test_m1_sin_proximo_umbral_omite_la_linea_de_falta() -> None:
    """Por encima de todos los umbrales (`proximo_umbral_m=None`) no hay "Faltan ...m"."""
    texto = mensaje_estado_diario(
        HOY, AHORA, 8.5, "evacuacion", 0.10, None, [], "alerta_probable", FECHA_DATO_HOY_00, "ina"
    )
    assert "Faltan" not in texto


def test_m1_sube_y_baja_muestran_centimetros() -> None:
    subio = mensaje_estado_diario(
        HOY, AHORA, 4.5, "normal", 0.12, None, [], "sin_aviso", FECHA_DATO_HOY_00, "ina"
    )
    assert "🔼 Subió 12 cm en el último día" in subio

    bajo = mensaje_estado_diario(
        HOY, AHORA, 4.5, "normal", -0.08, None, [], "sin_aviso", FECHA_DATO_HOY_00, "ina"
    )
    assert "🔽 Bajó 8 cm en el último día" in bajo


def test_m1_sin_dias_de_pronostico_igual_muestra_el_nivel_de_aviso() -> None:
    texto = mensaje_estado_diario(
        HOY, AHORA, 4.5, "normal", None, None, [], "atencion", FECHA_DATO_HOY_00, "ina"
    )
    assert "🔮 Próximos días" not in texto
    assert "🟡 Nivel de aviso: Atención" in texto


def test_m1_bloque_rio_arriba_se_inserta_cuando_se_pasa() -> None:
    bloque = "🏞️ Río arriba\n🚧 Salto Grande suelta 7.821 m³/s (vertedero cerrado)"
    texto = mensaje_estado_diario(
        HOY,
        AHORA,
        4.29,
        "normal",
        0.0,
        6.80,
        _DIAS_PRONOSTICO_EJEMPLO,
        "sin_aviso",
        FECHA_DATO_HOY_00,
        "caru",
        bloque,
    )
    assert bloque in texto
    # Va después del bloque de pronóstico/aviso y antes del pie.
    assert texto.index("🟢 Hoy no hay alerta") < texto.index("🏞️ Río arriba") < texto.index("📅")


def test_m1_sin_bloque_rio_arriba_no_aparece_la_seccion() -> None:
    texto = mensaje_estado_diario(
        HOY,
        AHORA,
        4.29,
        "normal",
        0.0,
        6.80,
        _DIAS_PRONOSTICO_EJEMPLO,
        "sin_aviso",
        FECHA_DATO_HOY_00,
        "caru",
        None,
    )
    assert "Río arriba" not in texto


# --- M3: cambio de nivel corto ---------------------------------------------------


def test_m3_cambio_de_nivel_reproduce_el_formato_exacto_de_la_spec() -> None:
    """Reproduce el ejemplo literal de la sección M3 de la spec 014."""
    texto = mensaje_cambio_nivel("atencion", 4.29, date(2026, 9, 28), 4.6, 6.6)

    esperado = (
        "🟡 ATENCIÓN — Río Uruguay en Colón\n"
        "\n"
        "El río podría llegar a entre 4,6 y 6,6 m el lunes 28.\n"
        "Hoy está en 4,29 m.\n"
        "\n"
        "⚠️ Orientativo. No reemplaza a Prefectura ni a Defensa Civil.\n"
        "Seguí los avisos de Prefectura y Defensa Civil."
    )
    assert texto == esperado


def test_m3_no_lleva_el_resumen_completo_de_m1() -> None:
    """Criterio de aceptación: el mensaje de cambio de nivel es corto, sin el resumen de M1."""
    texto = mensaje_cambio_nivel("alerta_probable", 7.2, date(2026, 9, 28), 7.5, 9.5)
    for fragmento_m1 in ("📏 Hoy:", "🔮 Próximos días", "📅 Medición del puerto"):
        assert fragmento_m1 not in texto


def test_m3_sin_aviso_no_proyecta_un_cruce() -> None:
    texto = mensaje_cambio_nivel("sin_aviso", 4.29)
    assert "🟢 SIN AVISO — Río Uruguay en Colón" in texto
    assert "volvió a la normalidad" in texto
    assert "Hoy está en 4,29 m." in texto


def test_m3_sin_altura_de_hoy_no_rompe() -> None:
    texto = mensaje_cambio_nivel("atencion", None, date(2026, 9, 28), 4.6, 6.6)
    assert "Todavía no hay una medición de hoy." in texto


# --- M4: disciplina de emojis -----------------------------------------------------


def test_m4_emoji_de_nivel_de_aviso_siempre_lleva_su_palabra() -> None:
    for nivel, palabra in (
        ("sin_aviso", "no hay alerta"),
        ("atencion", "Atención"),
        ("alerta_probable", "Alerta probable"),
    ):
        texto = mensaje_estado_diario(
            HOY, AHORA, 4.5, "normal", None, None, [], nivel, FECHA_DATO_HOY_00, "ina"
        )
        assert palabra in texto


def test_m4_emoji_de_tendencia_siempre_lleva_su_palabra() -> None:
    assert calcular_tendencia_simple(0.2) == "sube"
    assert calcular_tendencia_simple(-0.2) == "baja"
    assert calcular_tendencia_simple(0.01) == "estable"
    assert calcular_tendencia_simple(None) is None

    for delta, palabra in ((0.2, "Subió"), (-0.2, "Bajó"), (0.01, "No subió ni bajó")):
        texto = mensaje_estado_diario(
            HOY, AHORA, 4.5, "normal", delta, None, [], "sin_aviso", FECHA_DATO_HOY_00, "ina"
        )
        assert palabra in texto
