"""Tests for the Telegram avisos job: A1-A3 (canal), B1-B4 (umbral propio) and S1-S5."""

import logging
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta

import pytest
from app.models import Base
from app.repositories.alturas import AlturaIn, upsert_alturas
from app.repositories.pronosticos import PronosticoIn, upsert_pronosticos
from app.repositories.telegram import (
    fijar_umbral,
    obtener_estado_canal,
    obtener_suscripcion,
    reservar_cupo_diario,
)
from jobs import telegram_avisos
from jobs.settings import get_settings
from jobs.telegram_client import TelegramError
from sqlalchemy import Engine, create_engine

TOKEN = "123456:FAKE-TEST-TOKEN-not-real"  # noqa: S105 - test fixture only
CANAL = "@RioUruguayNotificaTest"
GAUGE = "hybas_6121320620"  # GAUGE_GOOGLE_COLON

# 15:00 UTC == 12:00 America/Argentina/Buenos_Aires, same calendar day.
NOW = datetime(2026, 9, 22, 15, 0, tzinfo=UTC)
HOY = date(2026, 9, 22)


@pytest.fixture(autouse=True)
def _settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TOKEN)
    monkeypatch.setenv("TELEGRAM_CANAL_ID", CANAL)
    monkeypatch.setenv("TELEGRAM_PUBLICACION_ACTIVA", "true")
    monkeypatch.setenv("TELEGRAM_TOPE_MENSAJES_DIA", "100")
    monkeypatch.setenv("TELEGRAM_APP_URL", "")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def engine() -> Iterator[Engine]:
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def enviados(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str]]:
    """Replace `send_message` with a recorder; returns the list it appends (chat_id, texto)."""
    llamadas: list[tuple[str, str]] = []

    def _fake_send(client, token, chat_id, texto):  # noqa: ANN001 - test double
        assert token == TOKEN
        llamadas.append((str(chat_id), texto))
        return 1000 + len(llamadas)

    monkeypatch.setattr(telegram_avisos, "send_message", _fake_send)
    return llamadas


def _seed_pronostico(
    engine: Engine, caudal_m3s: float, *, emitido: datetime = NOW, lead_dias: int = 3
) -> None:
    # `emitido` distinto simula una nueva emisión llegando (spec 003): dos
    # llamadas con el mismo `emitido` para el mismo gauge/fecha se ignoran
    # (upsert_pronosticos), a propósito -- así se simula "la misma emisión
    # todavía vigente" entre corridas consecutivas del job.
    upsert_pronosticos(
        engine,
        [
            PronosticoIn(
                gauge_id=GAUGE,
                emitido=emitido,
                fecha=HOY,
                lead_dias=lead_dias,
                caudal_m3s=caudal_m3s,
            )
        ],
    )


def _seed_altura(engine: Engine, altura_m: float = 4.0, *, fecha_hora: datetime = NOW) -> None:
    # Igual que arriba: una `fecha_hora` distinta simula una lectura nueva.
    upsert_alturas(engine, [AlturaIn(fecha_hora=fecha_hora, altura_m=altura_m, fuente="ina")])


class _FakeClient:
    """`httpx.Client`-shaped stand-in; `send_message` is monkeypatched so this is never used."""


# --- S4: interruptor de corte ------------------------------------------------


def test_s4_interruptor_apagado_no_publica_nada(
    engine: Engine, enviados: list, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TELEGRAM_PUBLICACION_ACTIVA", "false")
    get_settings.cache_clear()
    _seed_altura(engine)
    _seed_pronostico(engine, 9_600)  # atencion

    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)
    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)

    assert enviados == []


# --- Sin token: el worker arranca igual y no publica ------------------------


def test_sin_token_no_publica_y_no_falla(
    engine: Engine, enviados: list, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "")
    get_settings.cache_clear()
    _seed_altura(engine)
    _seed_pronostico(engine, 9_600)

    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)

    assert enviados == []


# --- S3: tope diario ----------------------------------------------------------


def test_s3_tope_diario_alcanzado_no_publica_mas(
    engine: Engine,
    enviados: list,
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services.alturas import hoy_buenos_aires

    monkeypatch.setenv("TELEGRAM_TOPE_MENSAJES_DIA", "1")
    get_settings.cache_clear()
    assert reservar_cupo_diario(engine, hoy_buenos_aires(NOW), tope=1) is True  # ya "lleno"
    _seed_altura(engine)
    _seed_pronostico(engine, 9_600)

    with caplog.at_level(logging.WARNING, logger="jobs.telegram_avisos"):
        telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)

    assert enviados == []
    assert any("tope diario" in r.getMessage() for r in caplog.records)


# --- S5: Telegram caído no rompe el job --------------------------------------


def test_s5_fallo_de_telegram_se_registra_y_no_rompe(
    engine: Engine, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def _boom(client, token, chat_id, texto):
        raise TelegramError("boom (redacted)")

    monkeypatch.setattr(telegram_avisos, "send_message", _boom)
    _seed_altura(engine)
    _seed_pronostico(engine, 9_600)

    with caplog.at_level(logging.WARNING, logger="jobs.telegram_avisos"):
        # No debe lanzar, ni acá ni en el punto de entrada del scheduler.
        telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)
    assert any("fallo al enviar" in r.getMessage() for r in caplog.records)

    monkeypatch.setattr(telegram_avisos, "get_engine", lambda: engine)
    telegram_avisos.job_publicar_avisos_telegram()  # must not raise


# --- A1/A3 + S1 (antirebote) + S2 (dedup persistido) -------------------------


def test_a1_no_publica_hasta_sostenerse_dos_corridas(engine: Engine, enviados: list) -> None:
    _seed_altura(engine)
    _seed_pronostico(engine, 9_600)  # atencion

    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)  # 1ra corrida: candidato

    mensajes_nivel = [t for chat, t in enviados if chat == CANAL and "Nuevo nivel" in t]
    assert mensajes_nivel == []
    estado = obtener_estado_canal(engine)
    assert estado.nivel_candidato == "atencion"
    assert estado.corridas_candidato == 1
    assert estado.nivel_publicado is None


def test_a1_publica_al_sostenerse_y_s2_no_reenvia_en_corridas_siguientes(
    engine: Engine, enviados: list
) -> None:
    _seed_altura(engine)
    _seed_pronostico(engine, 9_600)  # atencion

    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)  # candidato
    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)  # confirma, publica

    mensajes_canal = [t for chat, t in enviados if chat == CANAL and "Nuevo nivel" in t]
    assert len(mensajes_canal) == 1
    assert "Atención" in mensajes_canal[0]

    estado = obtener_estado_canal(engine)
    assert estado.nivel_publicado == "atencion"

    # S2: una tercera corrida con el mismo nivel (equivalente a "reiniciar el
    # worker" y volver a evaluar) no manda un segundo aviso.
    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)
    mensajes_canal = [t for chat, t in enviados if chat == CANAL and "Nuevo nivel" in t]
    assert len(mensajes_canal) == 1


def test_s1_serie_oscilante_no_dispara_nada(engine: Engine, enviados: list) -> None:
    _seed_altura(engine)

    for i, caudal in enumerate((9_600, 4_000, 9_600, 4_000, 9_600)):
        _seed_pronostico(engine, caudal, emitido=NOW + timedelta(hours=i))
        telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)

    mensajes_nivel = [
        t for chat, t in enviados if chat == CANAL and ("Nuevo nivel" in t or "normalidad" in t)
    ]
    assert mensajes_nivel == []


def test_a3_vuelta_a_la_normalidad_tras_confirmar_atencion(engine: Engine, enviados: list) -> None:
    _seed_altura(engine)
    _seed_pronostico(engine, 9_600)  # atencion
    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)
    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)  # confirma atencion
    enviados.clear()

    _seed_pronostico(engine, 100, emitido=NOW + timedelta(hours=1))  # sin_aviso
    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)  # candidato
    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)  # confirma

    mensajes = [t for chat, t in enviados if chat == CANAL and "normalidad" in t]
    assert len(mensajes) == 1
    assert "Sin aviso" in mensajes[0]


def test_sin_canal_id_no_publica_en_el_canal_pero_no_falla(
    engine: Engine, enviados: list, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TELEGRAM_CANAL_ID", "")
    get_settings.cache_clear()
    _seed_altura(engine)
    _seed_pronostico(engine, 9_600)

    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)
    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)

    assert enviados == []


# --- A2: estado diario --------------------------------------------------------


def test_a2_estado_diario_se_manda_una_vez_por_dia(engine: Engine, enviados: list) -> None:
    _seed_altura(engine)

    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)
    mensajes_estado = [t for chat, t in enviados if chat == CANAL and "Estado de hoy" in t]
    assert len(mensajes_estado) == 1

    # Misma corrida del día: no se repite.
    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)
    mensajes_estado = [t for chat, t in enviados if chat == CANAL and "Estado de hoy" in t]
    assert len(mensajes_estado) == 1

    # Al día siguiente sí se vuelve a mandar.
    manana = NOW.replace(day=23)
    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=manana)
    mensajes_estado = [t for chat, t in enviados if chat == CANAL and "Estado de hoy" in t]
    assert len(mensajes_estado) == 2


# --- B1/B2/B4: umbral propio ---------------------------------------------------


def test_b1_avisa_al_cruzar_el_umbral_propio_sostenido(engine: Engine, enviados: list) -> None:
    fijar_umbral(engine, chat_id=555, umbral_m=3.5)
    _seed_altura(engine, altura_m=4.0)  # ya está por encima de 3.5

    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)  # candidato (1 corrida)
    mensajes = [t for chat, t in enviados if chat == "555"]
    assert mensajes == []

    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)  # confirma (2 corridas)
    mensajes = [t for chat, t in enviados if chat == "555"]
    assert len(mensajes) == 1
    assert "superó" in mensajes[0]

    suscripcion = obtener_suscripcion(engine, 555)
    assert suscripcion is not None
    assert suscripcion.sobre_umbral is True


def test_b4_un_aviso_por_cruce_no_por_corrida(engine: Engine, enviados: list) -> None:
    fijar_umbral(engine, chat_id=555, umbral_m=3.5)
    _seed_altura(engine, altura_m=4.0)

    for _ in range(5):
        telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)

    mensajes = [t for chat, t in enviados if chat == "555"]
    assert len(mensajes) == 1  # no uno por cada una de las 5 corridas


def test_b2_avisa_al_bajar_del_umbral_propio(engine: Engine, enviados: list) -> None:
    fijar_umbral(engine, chat_id=555, umbral_m=3.5)
    _seed_altura(engine, altura_m=4.0)
    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)
    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)  # confirma "sobre"
    enviados.clear()

    _seed_altura(engine, altura_m=3.0, fecha_hora=NOW + timedelta(hours=1))  # baja del umbral
    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)
    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)  # confirma "bajo"

    mensajes = [t for chat, t in enviados if chat == "555"]
    assert len(mensajes) == 1
    assert "bajó" in mensajes[0]


def test_umbrales_propios_no_dependen_del_canal_configurado(
    engine: Engine, enviados: list, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TELEGRAM_CANAL_ID", "")
    get_settings.cache_clear()
    fijar_umbral(engine, chat_id=555, umbral_m=3.5)
    _seed_altura(engine, altura_m=4.0)

    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)
    telegram_avisos.publicar_avisos(engine, _FakeClient(), now=NOW)

    mensajes = [t for chat, t in enviados if chat == "555"]
    assert len(mensajes) == 1
