import type { FetchResult } from "../api/client";
import { getSaltoGrande } from "../api/saltoGrande";
import type { LluviaSubcuenca, SaltoGrande } from "../api/types";
import { formatCaudal, formatDiaSemanaFecha, formatMilimetros, parseFechaLocal, type Tendencia } from "../format";
import { renderCardError, renderCardSkeleton } from "./card";

export type SaltoGrandeState = { kind: "loading" } | FetchResult<SaltoGrande>;

export interface ComunicadoView {
  fechaTexto: string;
  evacuadoFrase: string;
  evacuadoDetalle: string;
  tendencia: Tendencia | null;
  vertederoTexto: string;
  vertederoAbierto: boolean;
  proyeccionTexto: string;
}

export type SaltoGrandeView =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error" }
  | {
      kind: "ready";
      comunicado: ComunicadoView | null;
      lluviaFrase: string | null;
      pronosticoLluviaFrase: string | null;
    };

// Solo se cuenta un evento de lluvia (u un pronóstico) si supera este piso:
// evita frases como "Llovió 1 mm río arriba" que no explican nada del río.
const LLUVIA_SIGNIFICATIVA_MM = 5;

const FRASES_TENDENCIA_EVACUADO: Record<Tendencia, string> = {
  sube: "La represa de Salto Grande está soltando más agua que ayer.",
  baja: "La represa de Salto Grande está soltando menos agua que ayer.",
  estable: "La represa de Salto Grande está soltando la misma cantidad de agua que ayer.",
};

/**
 * Tendencia día a día del caudal evacuado. Los valores están en miles de
 * m³/s, así que un umbral fijo pensado para alturas (`calcularTendencia`,
 * en metros) no sirve acá: se usa un umbral relativo (3 % de ayer) para no
 * marcar "sube"/"baja" por ruido normal de la operación de la represa.
 */
export function tendenciaCaudal(hoyM3s: number, ayerM3s: number): Tendencia {
  if (ayerM3s === 0) return hoyM3s === 0 ? "estable" : "sube";
  const deltaRelativo = (hoyM3s - ayerM3s) / Math.abs(ayerM3s);
  if (Math.abs(deltaRelativo) < 0.03) return "estable";
  return deltaRelativo > 0 ? "sube" : "baja";
}

/** "Cerrado" → false, cualquier otra cosa ("Abierto", "Parcialmente abierto", ...) → true. */
export function esVertederoAbierto(estadoVertedero: string): boolean {
  return !/cerrado/i.test(estadoVertedero);
}

/**
 * Diferencia en días de calendario entre `fecha` y `ahora`, ignorando la
 * hora de ambas (`fecha` es siempre medianoche local, ver `parseFechaLocal`;
 * `ahora` no lo es). `formatHaceTiempo` no sirve acá: está pensado para
 * comparar dos instantes reales ("hace 15 minutos"), y aplicado a una fecha
 * sin hora redondearía mal según a qué hora del día se lo llame (por
 * ejemplo, un evento de "hace 2 días" calendario podía salir como "hace 3
 * días" a la tarde).
 */
function diasCalendarioDesde(fecha: Date, ahora: Date): number {
  const inicioFecha = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  const inicioAhora = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  return Math.round((inicioAhora.getTime() - inicioFecha.getTime()) / 86_400_000);
}

function fraseHaceDias(dias: number): string {
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  return `hace ${String(dias)} días`;
}

/**
 * Pure: el evento de lluvia más fuerte de la ventana observada, como
 * "Llovió 58 mm río arriba hace 2 días" — no el último día, sino el que
 * mejor explica una eventual subida del río (spec 012). `null` si no hay
 * datos o si nada superó `LLUVIA_SIGNIFICATIVA_MM`.
 */
export function construirFraseLluviaObservada(
  lluvia: readonly LluviaSubcuenca[],
  ahora: Date,
): string | null {
  if (lluvia.length === 0) return null;
  const maxima = lluvia.reduce((max, actual) => (actual.lluvia_mm > max.lluvia_mm ? actual : max));
  if (maxima.lluvia_mm < LLUVIA_SIGNIFICATIVA_MM) return null;
  const cuando = fraseHaceDias(diasCalendarioDesde(parseFechaLocal(maxima.fecha), ahora));
  return `Llovió ${formatMilimetros(maxima.lluvia_mm)} río arriba ${cuando}.`;
}

/** Pure: total pronosticado (todas las subcuencas, 7 días) como una sola frase, o `null` si es despreciable. */
export function construirFrasePronosticoLluvia(lluvia: readonly LluviaSubcuenca[]): string | null {
  if (lluvia.length === 0) return null;
  const total = lluvia.reduce((suma, fila) => suma + fila.lluvia_mm, 0);
  if (total < LLUVIA_SIGNIFICATIVA_MM) return null;
  return `Se espera otros ${formatMilimetros(Math.round(total))} de lluvia en la cuenca en los próximos días.`;
}

/** Pure derivation: `/salto-grande` -> qué mostrar en la tarjeta (spec 012). No DOM. */
export function deriveSaltoGrandeView(state: SaltoGrandeState, ahora: Date): SaltoGrandeView {
  if (state.kind === "loading") return { kind: "loading" };
  if (state.kind === "unavailable") return { kind: "unavailable" };
  if (state.kind !== "ok") return { kind: "error" };

  const { data } = state;

  const comunicado: ComunicadoView | null = data.comunicado
    ? {
        fechaTexto: formatDiaSemanaFecha(data.comunicado.fecha),
        evacuadoFrase: data.comunicado_anterior
          ? FRASES_TENDENCIA_EVACUADO[
              tendenciaCaudal(data.comunicado.evacuado_m3s, data.comunicado_anterior.evacuado_m3s)
            ]
          : "La represa de Salto Grande está evacuando agua.",
        evacuadoDetalle: `${formatCaudal(data.comunicado.evacuado_m3s)} evacuados`,
        tendencia: data.comunicado_anterior
          ? tendenciaCaudal(data.comunicado.evacuado_m3s, data.comunicado_anterior.evacuado_m3s)
          : null,
        vertederoTexto: data.comunicado.estado_vertedero,
        vertederoAbierto: esVertederoAbierto(data.comunicado.estado_vertedero),
        proyeccionTexto: data.comunicado.texto_proyeccion,
      }
    : null;

  return {
    kind: "ready",
    comunicado,
    lluviaFrase: construirFraseLluviaObservada(data.lluvia_observada, ahora),
    pronosticoLluviaFrase: construirFrasePronosticoLluvia(data.lluvia_pronostico),
  };
}

const TITULO = "Salto Grande";

export function renderSaltoGrande(container: HTMLElement, view: SaltoGrandeView): void {
  if (view.kind === "loading") {
    renderCardSkeleton(container, TITULO);
    return;
  }
  if (view.kind === "unavailable") {
    container.innerHTML = `
      <h2>${TITULO}</h2>
      <p class="card-info" role="status">Datos de la represa de Salto Grande no disponibles por el momento.</p>
    `;
    return;
  }
  if (view.kind === "error") {
    renderCardError(container, TITULO, "No pudimos obtener los datos de Salto Grande.");
    return;
  }

  const comunicadoHtml = view.comunicado
    ? `
      <p class="frase-pronostico">${view.comunicado.evacuadoFrase}</p>
      <p class="card-subtitulo">${view.comunicado.evacuadoDetalle}</p>
      <p class="badge" data-tono="${view.comunicado.vertederoAbierto ? "warn" : "ok"}">Vertedero ${view.comunicado.vertederoTexto}</p>
      <blockquote class="salto-grande-proyeccion">
        <p>${view.comunicado.proyeccionTexto}</p>
        <cite>Proyección de CTM Salto Grande, ${view.comunicado.fechaTexto}</cite>
      </blockquote>
    `
    : `<p class="card-info">Todavía no hay comunicado de hoy de la represa.</p>`;

  const lluviaHtml = [view.lluviaFrase, view.pronosticoLluviaFrase]
    .filter((frase): frase is string => frase !== null)
    .map((frase) => `<p class="salto-grande-lluvia">${frase}</p>`)
    .join("");

  container.innerHTML = `
    <h2>${TITULO}</h2>
    ${comunicadoHtml}
    ${lluviaHtml}
    <p class="disclaimer-corta">Datos de CTM Salto Grande. Nunca se deriva de acá una altura para Colón.</p>
  `;
}

export interface SaltoGrandeDeps {
  getSaltoGrande: typeof getSaltoGrande;
}

const defaultDeps: SaltoGrandeDeps = { getSaltoGrande };

export function mountSaltoGrande(container: HTMLElement, deps: SaltoGrandeDeps = defaultDeps): void {
  renderSaltoGrande(container, deriveSaltoGrandeView({ kind: "loading" }, new Date()));
  void deps.getSaltoGrande().then((result) => {
    renderSaltoGrande(container, deriveSaltoGrandeView(result, new Date()));
  });
}
