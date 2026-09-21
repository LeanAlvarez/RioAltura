import type { FetchResult } from "../api/client";
import { getEstadisticas } from "../api/estadisticas";
import type { Estadisticas, MismoDiaAnio } from "../api/types";
import { formatMetros } from "../format";
import { renderCardError, renderCardSkeleton } from "./card";

export type ContextoState = { kind: "loading" } | FetchResult<Estadisticas>;

export interface ComparacionAnioView {
  anio: string;
  altura: string;
  porcentaje: number;
}

export type ContextoView =
  | { kind: "loading" }
  | { kind: "error" }
  | {
      kind: "ready";
      fraseAmpliada: string | null;
      comparaciones: ComparacionAnioView[];
      hoy: ComparacionAnioView | null;
    };

const enteroFormatter = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

/** "8 de cada 10 días del último año" — traducción a lenguaje llano del percentil (siempre entero, nunca decimales). */
function describePercentil(percentil: number): string {
  const redondeado = Math.round(percentil);
  return `Hoy el río está más alto que el ${enteroFormatter.format(redondeado)} % de los días del último año.`;
}

/** Pure: normaliza alturas a un [0,100] relativo para barras horizontales, sin depender del DOM. */
function construirComparaciones(mismoDia: readonly MismoDiaAnio[], hoyAltura: number | null): ComparacionAnioView[] {
  const todas = hoyAltura === null ? mismoDia.map((m) => m.altura_m) : [...mismoDia.map((m) => m.altura_m), hoyAltura];
  const max = todas.length > 0 ? Math.max(...todas, 0.01) : 1;
  return mismoDia.map((m) => ({
    anio: String(m.anio),
    altura: formatMetros(m.altura_m),
    porcentaje: Math.round((m.altura_m / max) * 100),
  }));
}

/** Pure derivation: `/estadisticas` -> qué mostrar en la tarjeta "Contexto" (spec 007 T6). No DOM. */
export function deriveContextoView(state: ContextoState): ContextoView {
  if (state.kind === "loading") return { kind: "loading" };
  if (state.kind !== "ok") return { kind: "error" };

  const { data } = state;
  const fraseAmpliada = data.percentil_hoy ? describePercentil(data.percentil_hoy.percentil) : null;
  const hoyAltura = data.percentil_hoy?.altura_m ?? null;
  const comparaciones = construirComparaciones(data.mismo_dia_otros_anios, hoyAltura);

  const todas = [...data.mismo_dia_otros_anios.map((m) => m.altura_m), ...(hoyAltura !== null ? [hoyAltura] : [])];
  const max = todas.length > 0 ? Math.max(...todas, 0.01) : 1;
  const hoy: ComparacionAnioView | null =
    hoyAltura === null ? null : { anio: "Hoy", altura: formatMetros(hoyAltura), porcentaje: Math.round((hoyAltura / max) * 100) };

  return { kind: "ready", fraseAmpliada, comparaciones, hoy };
}

const TITULO = "Contexto";

export function renderContexto(container: HTMLElement, view: ContextoView): void {
  if (view.kind === "loading") {
    renderCardSkeleton(container, TITULO);
    return;
  }
  if (view.kind === "error") {
    renderCardError(container, TITULO, "No pudimos calcular el contexto histórico.");
    return;
  }

  const filas = [...(view.hoy ? [view.hoy] : []), ...view.comparaciones]
    .map(
      (fila) => `
        <li class="contexto-fila${fila.anio === "Hoy" ? " contexto-fila--hoy" : ""}">
          <span class="contexto-anio">${fila.anio}</span>
          <span class="contexto-barra-pista"><span class="contexto-barra" style="width:${String(fila.porcentaje)}%"></span></span>
          <span class="contexto-altura">${fila.altura}</span>
        </li>
      `,
    )
    .join("");

  container.innerHTML = `
    <h2>${TITULO}</h2>
    ${view.fraseAmpliada ? `<p class="frase-pronostico">${view.fraseAmpliada}</p>` : '<p class="card-info">Todavía no hay suficiente altura real de hoy para calcular el percentil.</p>'}
    ${filas ? `<p class="card-subtitulo">Este mismo día, otros años:</p><ul class="contexto-filas">${filas}</ul>` : ""}
  `;
}

export interface ContextoDeps {
  getEstadisticas: typeof getEstadisticas;
}

const defaultDeps: ContextoDeps = { getEstadisticas };

export function mountContexto(container: HTMLElement, deps: ContextoDeps = defaultDeps): void {
  renderContexto(container, deriveContextoView({ kind: "loading" }));
  void deps.getEstadisticas().then((result) => {
    renderContexto(container, deriveContextoView(result));
  });
}
