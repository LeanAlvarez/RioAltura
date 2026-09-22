"""CARU parser tests (spec 009). Never hits the real source: fixture only."""

from datetime import UTC, datetime
from pathlib import Path

import pytest
from jobs.caru import FUENTE, parse_alturas
from jobs.http import FuenteError

FIXTURE = Path(__file__).parent / "fixtures" / "caru_colon.html"


@pytest.fixture
def html() -> str:
    return FIXTURE.read_text(encoding="utf-8", errors="replace")


def test_parsea_las_lecturas_reales_de_colon(html: str) -> None:
    rows = parse_alturas(html)
    assert len(rows) >= 10, "la página trae una semana de historial, dos por día"
    assert {row.fuente for row in rows} == {FUENTE}


def test_la_lectura_mas_nueva_es_la_del_22_de_septiembre(html: str) -> None:
    rows = parse_alturas(html)
    mas_nueva = max(rows, key=lambda r: r.fecha_hora)
    # 22/09/2026 00:00 en Buenos Aires == 03:00 UTC.
    assert mas_nueva.fecha_hora == datetime(2026, 9, 22, 3, 0, tzinfo=UTC)
    assert mas_nueva.altura_m == pytest.approx(4.29)


def test_todas_las_fechas_quedan_en_utc_con_zona(html: str) -> None:
    for row in parse_alturas(html):
        assert row.fecha_hora.tzinfo is not None
        assert row.fecha_hora.utcoffset() == UTC.utcoffset(None)


def test_la_altura_coincide_con_el_ina_mismo_cero_de_hidrometro(html: str) -> None:
    # El 22/09/2026 el INA daba 4,29 m para el mismo día. Que CARU publique el
    # mismo valor es lo que confirma que no hay que convertir nada (spec 009).
    rows = parse_alturas(html)
    del_22 = [r for r in rows if r.fecha_hora == datetime(2026, 9, 22, 3, 0, tzinfo=UTC)]
    assert del_22 and del_22[0].altura_m == pytest.approx(4.29)


def test_si_cambia_la_estructura_avisa_en_vez_de_inventar() -> None:
    # El caso que importa de una fuente scrapeada: la página cambia. Tiene que
    # fallar con FuenteError para que el llamador conserve el último dato
    # conocido, nunca devolver una lista vacía como si no hubiera crecida.
    with pytest.raises(FuenteError):
        parse_alturas("<html><body><p>Sitio en mantenimiento</p></body></html>")


def test_descarta_filas_con_altura_fuera_de_rango_fisico() -> None:
    # Una página cambiada puede poner cualquier cosa en la columna del valor.
    html = """
      <table><tr><td>Colón</td><td>22/09/2026 - 00:00</td><td>4.29</td></tr>
             <tr><td>Colón</td><td>21/09/2026 - 12:00</td><td>9999</td></tr></table>
    """
    rows = parse_alturas(html)
    assert len(rows) == 1
    assert rows[0].altura_m == pytest.approx(4.29)


def test_descarta_filas_con_fecha_ilegible() -> None:
    html = """
      <table><tr><td>Colón</td><td>22/09/2026 - 00:00</td><td>4.29</td></tr>
             <tr><td>Colón</td><td>no es una fecha</td><td>4.30</td></tr></table>
    """
    assert len(parse_alturas(html)) == 1


def test_acepta_altura_con_coma_decimal() -> None:
    # CARU publica con punto, pero si algún día cambia a coma no queremos
    # perder la lectura por eso.
    html = "<table><tr><td>Colón</td><td>22/09/2026 - 00:00</td><td>4,29</td></tr></table>"
    assert parse_alturas(html)[0].altura_m == pytest.approx(4.29)
