from datetime import date
from pathlib import Path

import httpx
import pytest
from app.repositories.salto_grande import (
    list_lluvia,
    list_ultimos_caudales_cascada,
    list_ultimos_comunicados,
)
from jobs import salto_grande
from jobs.http import FuenteError

FIXTURES = Path(__file__).parent / "fixtures"


def _fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


# --- parse_comunicado ---


def test_parse_comunicado_lee_los_campos_principales() -> None:
    comunicado = salto_grande.parse_comunicado(_fixture_bytes("sg_Comunicado.pdf"))

    assert comunicado.fecha == date(2026, 9, 22)
    assert comunicado.aporte_m3s == pytest.approx(7553)
    assert comunicado.evacuado_m3s == pytest.approx(7821)
    assert comunicado.nivel_embalse_m == pytest.approx(34.81)
    assert comunicado.estado_vertedero == "Cerrado"


def test_parse_comunicado_incluye_el_texto_de_proyeccion_citado() -> None:
    comunicado = salto_grande.parse_comunicado(_fixture_bytes("sg_Comunicado.pdf"))

    assert "variará entre 8.000 y 7.000 m³/s" in comunicado.texto_proyeccion
    assert "puerto de Concordia" in comunicado.texto_proyeccion
    assert "puerto de Salto" in comunicado.texto_proyeccion
    assert "El nivel del embalse tenderá a 34,50 m" in comunicado.texto_proyeccion
    # Nunca contiene "Vertedero": ese campo se guarda aparte.
    assert "Vertedero" not in comunicado.texto_proyeccion


def test_parse_comunicado_pdf_irreconocible_lanza_fuente_error() -> None:
    with pytest.raises(FuenteError):
        salto_grande.parse_comunicado(b"not a pdf")


# --- parse_caudales_cascada ---


def test_parse_caudales_cascada_lee_las_nueve_estaciones() -> None:
    filas = salto_grande.parse_caudales_cascada(_fixture_bytes("sg_CaudalesNiveles.pdf"))

    estaciones = {fila.estacion for fila in filas}
    assert estaciones == set(salto_grande.SALTO_GRANDE_ESTACIONES_CASCADA)
    # 9 estaciones documentadas en la spec, 4 fechas cada una.
    assert len(filas) == 9 * 4


def test_parse_caudales_cascada_valores_del_ultimo_dia() -> None:
    filas = salto_grande.parse_caudales_cascada(_fixture_bytes("sg_CaudalesNiveles.pdf"))

    por_estacion_fecha = {(f.estacion, f.fecha): f.caudal_m3s for f in filas}
    assert por_estacion_fecha[("Machadinho", date(2026, 9, 22))] == pytest.approx(2441)
    assert por_estacion_fecha[("Itá", date(2026, 9, 22))] == pytest.approx(2586)
    assert por_estacion_fecha[("Foz de Chapecó", date(2026, 9, 22))] == pytest.approx(3408)
    assert por_estacion_fecha[("El Soberbio", date(2026, 9, 19))] == pytest.approx(2477)
    assert por_estacion_fecha[("Paso de los Libres", date(2026, 9, 22))] == pytest.approx(7720)
    # "Aporte" es un total, no una estación: no debe aparecer.
    assert not any(f.estacion == "Aporte" for f in filas)


def test_parse_caudales_cascada_pdf_irreconocible_lanza_fuente_error() -> None:
    with pytest.raises(FuenteError):
        salto_grande.parse_caudales_cascada(b"not a pdf")


# --- parse_precipitaciones / parse_pronostico_precipitaciones ---


def test_parse_precipitaciones_lee_las_siete_subcuencas() -> None:
    filas = salto_grande.parse_precipitaciones(_fixture_bytes("sg_Precipitaciones.pdf"))

    assert len(filas) == 7 * 8  # 7 subcuencas, 8 días en el fixture
    assert all(f.tipo == salto_grande.TIPO_LLUVIA_OBSERVADA for f in filas)


def test_parse_precipitaciones_el_soberbio_20_09_es_58mm() -> None:
    filas = salto_grande.parse_precipitaciones(_fixture_bytes("sg_Precipitaciones.pdf"))

    fila = next(f for f in filas if f.subcuenca == "El Soberbio" and f.fecha == date(2026, 9, 20))
    assert fila.lluvia_mm == pytest.approx(58)


def test_parse_pronostico_precipitaciones_lee_siete_dias() -> None:
    filas = salto_grande.parse_pronostico_precipitaciones(_fixture_bytes("sg_PronosticosP.pdf"))

    assert len(filas) == 7 * 7  # 7 subcuencas, 7 días de pronóstico
    assert all(f.tipo == salto_grande.TIPO_LLUVIA_PRONOSTICO for f in filas)
    # La fila "Total" no debe colarse como una fecha.
    assert all(f.fecha != date(2026, 9, 22) for f in filas)  # esa fecha no está en el pronóstico


def test_parse_pronostico_precipitaciones_pdf_irreconocible_lanza_fuente_error() -> None:
    with pytest.raises(FuenteError):
        salto_grande.parse_pronostico_precipitaciones(b"not a pdf")


# --- validación de rangos ---


def test_validar_rango_descarta_valores_fuera_de_rango(caplog) -> None:
    with caplog.at_level("WARNING"):
        assert salto_grande._validar_rango(-5, 0, 100, "x", "fuente") is None
        assert salto_grande._validar_rango(500_000, 0, 100, "x", "fuente") is None
        assert salto_grande._validar_rango(50, 0, 100, "x", "fuente") == 50


# --- fetch_* (transporte HTTP, con MockTransport) ---


def _handler_para(pdf_bytes: bytes):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=pdf_bytes)

    return handler


def test_fetch_comunicado_usa_el_cliente_http() -> None:
    handler = _handler_para(_fixture_bytes("sg_Comunicado.pdf"))
    client = httpx.Client(transport=httpx.MockTransport(handler))

    comunicado = salto_grande.fetch_comunicado(client)

    assert comunicado.fecha == date(2026, 9, 22)


def test_fetch_comunicado_envuelve_fallas_http_en_fuente_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    client = httpx.Client(transport=httpx.MockTransport(handler))

    with pytest.raises(FuenteError):
        salto_grande.fetch_comunicado(client)


# --- actualizar_salto_grande: orquestación, aislamiento entre fuentes ---


@pytest.fixture
def engine():
    from app.models import Base
    from sqlalchemy import create_engine

    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


def _client_multi(rutas: dict[str, bytes | int]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        for fragmento, contenido in rutas.items():
            if fragmento in str(request.url):
                if isinstance(contenido, int):
                    return httpx.Response(contenido)
                return httpx.Response(200, content=contenido)
        return httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_actualizar_salto_grande_guarda_las_cuatro_fuentes(engine) -> None:
    client = _client_multi(
        {
            "Comunicado.pdf": _fixture_bytes("sg_Comunicado.pdf"),
            "CaudalesNiveles.pdf": _fixture_bytes("sg_CaudalesNiveles.pdf"),
            "PronosticosP.pdf": _fixture_bytes("sg_PronosticosP.pdf"),
            "Precipitaciones.pdf": _fixture_bytes("sg_Precipitaciones.pdf"),
        }
    )

    resumen = salto_grande.actualizar_salto_grande(engine, client)

    assert resumen["comunicado"]["ok"] is True
    assert resumen["caudales_cascada"]["ok"] is True
    assert resumen["precipitaciones"]["ok"] is True
    assert resumen["pronosticos_precipitaciones"]["ok"] is True
    assert len(list_ultimos_comunicados(engine)) == 1
    assert len(list_ultimos_caudales_cascada(engine)) == 9
    assert len(list_lluvia(engine, "observada", date(2000, 1, 1))) == 7 * 8
    assert len(list_lluvia(engine, "pronostico", date(2000, 1, 1))) == 7 * 7


def test_actualizar_salto_grande_una_fuente_falla_las_otras_tres_siguen(engine) -> None:
    client = _client_multi(
        {
            "Comunicado.pdf": 500,
            "CaudalesNiveles.pdf": _fixture_bytes("sg_CaudalesNiveles.pdf"),
            "PronosticosP.pdf": _fixture_bytes("sg_PronosticosP.pdf"),
            "Precipitaciones.pdf": _fixture_bytes("sg_Precipitaciones.pdf"),
        }
    )

    resumen = salto_grande.actualizar_salto_grande(engine, client)

    assert resumen["comunicado"]["ok"] is False
    assert resumen["caudales_cascada"]["ok"] is True
    assert resumen["precipitaciones"]["ok"] is True
    assert resumen["pronosticos_precipitaciones"]["ok"] is True
    assert list_ultimos_comunicados(engine) == []
    assert len(list_ultimos_caudales_cascada(engine)) == 9


def test_job_actualizar_salto_grande_nunca_lanza(monkeypatch) -> None:
    def explota() -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(salto_grande, "get_engine", explota)

    salto_grande.job_actualizar_salto_grande()  # no debe lanzar
