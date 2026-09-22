"""Antirebote (S1) transition logic shared by the channel and every subscriber.

Pure and DB-agnostic on purpose: it is the same state machine for "the
channel's aviso level" (a `str`) and "whether a subscriber is over their own
threshold" (a `bool`), so it is written once, generically, and unit-tested
directly with a synthetic series (spec 011 acceptance criteria).
"""

__all__ = ["MIN_CORRIDAS_SOSTENIDAS", "Transicion", "evaluar_transicion"]

# A newly observed value has to repeat this many consecutive runs before it
# gets published: a value oscillating around a threshold must not trigger a
# message per crossing (spec 011, S1).
MIN_CORRIDAS_SOSTENIDAS = 2


class Transicion:
    """Result of one antirebote evaluation.

    `nivel_candidato`/`corridas_candidato` are the *new* bookkeeping to
    persist regardless of `debe_publicar`; `debe_publicar` tells the caller
    whether to actually publish `valor_observado` this run (and, if it does
    and the publish succeeds, to persist `valor_observado` as the new
    published value and reset the candidate to `None`/`0`).
    """

    __slots__ = ("nivel_candidato", "corridas_candidato", "debe_publicar")

    def __init__(self, nivel_candidato: object, corridas_candidato: int, debe_publicar: bool):
        self.nivel_candidato = nivel_candidato
        self.corridas_candidato = corridas_candidato
        self.debe_publicar = debe_publicar

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Transicion):
            return NotImplemented
        return (
            self.nivel_candidato == other.nivel_candidato
            and self.corridas_candidato == other.corridas_candidato
            and self.debe_publicar == other.debe_publicar
        )

    def __repr__(self) -> str:
        return (
            f"Transicion(nivel_candidato={self.nivel_candidato!r}, "
            f"corridas_candidato={self.corridas_candidato!r}, debe_publicar={self.debe_publicar!r})"
        )


def evaluar_transicion[T](
    valor_publicado: T | None,
    valor_candidato: T | None,
    corridas_candidato: int,
    valor_observado: T,
    min_corridas: int = MIN_CORRIDAS_SOSTENIDAS,
) -> Transicion:
    """One antirebote step: should `valor_observado` be published this run?

    - If it matches what is already published, there is nothing new: the
      candidate resets (a value that bounced back before being confirmed
      never counted).
    - If it matches the current candidate, its run count goes up by one.
    - Otherwise it becomes the new candidate, with a run count of 1.

    `debe_publicar` is True once the run count reaches `min_corridas` *and*
    the value still differs from what is published -- so a caller can keep
    calling this every run without special-casing "already published".
    """
    if valor_observado == valor_publicado:
        return Transicion(None, 0, False)

    corridas = corridas_candidato + 1 if valor_observado == valor_candidato else 1
    return Transicion(valor_observado, corridas, corridas >= min_corridas)
