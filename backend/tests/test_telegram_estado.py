"""S1 (antirebote): unit tests for `evaluar_transicion`, including a synthetic series.

Acceptance criterion (spec 011): "Un nivel que oscila alrededor del umbral
no dispara un mensaje por cruce (S1), verificado con una serie sintética."
"""

from app.services.telegram_estado import evaluar_transicion


def _simular(serie: list[str | bool], min_corridas: int = 2) -> list[str | bool]:
    """Run `serie` through the same loop a job would: return every value actually published."""
    publicado: str | bool | None = None
    candidato: str | bool | None = None
    corridas = 0
    publicaciones: list[str | bool] = []

    for observado in serie:
        transicion = evaluar_transicion(publicado, candidato, corridas, observado, min_corridas)
        candidato, corridas = transicion.nivel_candidato, transicion.corridas_candidato
        if transicion.debe_publicar:
            publicaciones.append(observado)
            publicado = observado
            candidato, corridas = None, 0

    return publicaciones


def test_valor_que_se_sostiene_publica_una_sola_vez() -> None:
    serie = ["sin_aviso", "atencion", "atencion", "atencion", "atencion"]

    assert _simular(serie) == ["atencion"]


def test_serie_oscilante_alrededor_del_umbral_no_publica_nada() -> None:
    # Va y viene cada corrida: nunca llega a sostenerse min_corridas veces seguidas.
    serie = ["sin_aviso", "atencion", "sin_aviso", "atencion", "sin_aviso", "atencion"]

    assert _simular(serie) == []


def test_serie_oscilante_que_despues_se_sostiene_publica_una_vez_al_sostenerse() -> None:
    serie = [
        "sin_aviso",
        "atencion",
        "sin_aviso",  # bounce: el candidato "atencion" se descarta
        "atencion",
        "atencion",  # recién acá se sostiene 2 corridas seguidas
        "atencion",
        "atencion",
    ]

    assert _simular(serie) == ["atencion"]


def test_transicion_completa_ida_y_vuelta_publica_los_dos_cambios_sostenidos() -> None:
    serie = [
        "atencion",
        "atencion",  # confirma atencion
        "alerta_probable",
        "sin_aviso",  # bounce, no cuenta para alerta_probable
        "sin_aviso",
        "sin_aviso",  # confirma la vuelta a sin_aviso (A3)
    ]

    assert _simular(serie) == ["atencion", "sin_aviso"]


def test_min_corridas_configurable() -> None:
    serie = ["atencion", "atencion", "atencion"]

    assert _simular(serie, min_corridas=3) == ["atencion"]
    assert _simular(serie, min_corridas=4) == []


def test_valor_igual_al_publicado_no_hace_nada_y_resetea_candidato() -> None:
    transicion = evaluar_transicion("atencion", "alerta_probable", 1, "atencion")

    assert transicion.debe_publicar is False
    assert transicion.nivel_candidato is None
    assert transicion.corridas_candidato == 0


def test_funciona_igual_con_booleanos_para_el_umbral_de_un_suscriptor() -> None:
    # sobre_umbral: False -> True sostenido dos corridas -> True publica (B1)
    serie = [False, True, True]

    assert _simular(serie) == [True]
