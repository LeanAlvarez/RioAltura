import type { FetchResult } from "../api/client";
import { getPronosticoAguasArriba } from "../api/pronostico";
import type { DiaPronostico, PronosticoAguasArriba } from "../api/types";
import { calcularTendencia, formatDiaSemanaFecha, formatRangoMetros, type Tendencia } from "../format";
import { renderCardError, renderCardSkeleton } from "./card";

export type AguasArribaState = { kind: "loading" } | FetchResult<PronosticoAguasArriba>;

export type AguasArribaView =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error" }
  | { kind: "ready"; frase: string; tendencia: Tendencia | null };

/** Pure derivation: pronóstico del gauge aguas arriba -> qué mostrar (spec 007 T5). No DOM. */
export function deriveAguasArribaView(state: AguasArribaState): AguasArribaView {
  if (state.kind === "loading") return { kind: "loading" };
  if (state.kind === "unavailable") return { kind: "unavailable" };
  if (state.kind !== "ok") return { kind: "error" };

  const dias: readonly DiaPronostico[] = state.data.dias;
  const primero = dias[0];
  const ultimo = dias[dias.length - 1];
  if (!primero || !ultimo) {
    return { kind: "ready", frase: "Todavía no hay pronóstico aguas arriba.", tendencia: null };
  }

  const tendencia = calcularTendencia(ultimo.altura_anclada_m - primero.altura_anclada_m);
  const frase = `Aguas arriba (zona Concordia / Salto Grande), el río podría estar ${formatRangoMetros(
    ultimo.altura_anclada_min_m,
    ultimo.altura_anclada_max_m,
  )} el ${formatDiaSemanaFecha(ultimo.fecha)}. Lo que pasa allá llega a Colón unos días después.`;

  return { kind: "ready", frase, tendencia };
}

const TITULO = "Aguas arriba";
const FLECHAS: Record<Tendencia, string> = { sube: "▲", baja: "▼", estable: "→" };
const FLECHAS_TEXTO: Record<Tendencia, string> = { sube: "Sube", baja: "Baja", estable: "Estable" };

export function renderAguasArriba(container: HTMLElement, view: AguasArribaView): void {
  if (view.kind === "loading") {
    renderCardSkeleton(container, TITULO);
    return;
  }
  if (view.kind === "unavailable") {
    container.innerHTML = `
      <h2>${TITULO}</h2>
      <p class="card-info" role="status">Pronóstico aguas arriba no disponible por el momento.</p>
    `;
    return;
  }
  if (view.kind === "error") {
    renderCardError(container, TITULO, "No pudimos obtener el pronóstico aguas arriba.");
    return;
  }

  const tendenciaHtml = view.tendencia
    ? `<p class="tendencia">${FLECHAS[view.tendencia]} ${FLECHAS_TEXTO[view.tendencia]} en los próximos días</p>`
    : "";

  container.innerHTML = `
    <h2>${TITULO}</h2>
    <p class="frase-pronostico">${view.frase}</p>
    ${tendenciaHtml}
  `;
}

export interface AguasArribaDeps {
  getPronosticoAguasArriba: typeof getPronosticoAguasArriba;
}

const defaultDeps: AguasArribaDeps = { getPronosticoAguasArriba };

export function mountAguasArriba(container: HTMLElement, deps: AguasArribaDeps = defaultDeps): void {
  renderAguasArriba(container, deriveAguasArribaView({ kind: "loading" }));
  void deps.getPronosticoAguasArriba().then((result) => {
    renderAguasArriba(container, deriveAguasArribaView(result));
  });
}
