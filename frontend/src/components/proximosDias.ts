import type { FetchResult } from "../api/client";
import type { DiaPronostico, NivelAviso, Pronostico } from "../api/types";
import { describeAnclaje } from "../domain/anclaje";
import { describeAviso } from "../domain/aviso";
import {
  calcularTendencia,
  formatDiaCorto,
  formatDiaSemanaFecha,
  formatMetros,
  formatRangoMetros,
  type Tendencia,
} from "../format";
import { renderCardError, renderCardSkeleton } from "./card";

export type ProximosDiasState = { kind: "loading" } | FetchResult<Pronostico>;

export interface DiaMiniView {
  dia: string;
  /** Rango anclado. Null sólo en la fila de hoy CUANDO hay medición real. */
  rango: string | null;
  /**
   * Sólo en la fila de hoy y sólo si el anclaje se aplicó: ahí la altura
   * anclada coincide con la real medida (C2). Sin anclaje esto va en null y
   * la fila muestra rango como cualquier otro día — rotular "medido" una
   * estimación sería presentar un pronóstico como una medición.
   */
  medido: string | null;
  tendencia: Tendencia | null;
  extrapolado: boolean;
}

function fechaISOLocal(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type ProximosDiasView =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error" }
  | {
      kind: "ready";
      avisoLabel: string;
      nivelAviso: NivelAviso;
      frase: string;
      fraseExtrapolada: boolean;
      anclajeTexto: string | null;
      dias: DiaMiniView[];
      hayExtrapolados: boolean;
    };

/** El día usado para la frase: el de mayor altura (anclada) máxima entre los próximos (lead >= 1). */
function elegirDiaMaximo(dias: readonly DiaPronostico[]): DiaPronostico | undefined {
  const candidatos = dias.filter((d) => d.lead_dias >= 1);
  const pool = candidatos.length > 0 ? candidatos : dias;
  return pool.reduce<DiaPronostico | undefined>(
    (max, dia) => (max === undefined || dia.altura_anclada_max_m > max.altura_anclada_max_m ? dia : max),
    undefined,
  );
}

function construirDiasMini(
  dias: readonly DiaPronostico[],
  hoyIso: string,
  anclajeAplicado: boolean,
): DiaMiniView[] {
  return dias.map((dia, index) => {
    const anterior = dias[index - 1];
    const delta = anterior ? dia.altura_anclada_m - anterior.altura_anclada_m : null;
    // C3 filtra por `fecha` (zona America/Argentina/Buenos_Aires), no por
    // `lead_dias`: cuando la última emisión de Google es de ayer, el día de
    // hoy sobrevive con `lead_dias 1` (el de `lead_dias 0` cae ayer y queda
    // filtrado) — comparar por `lead_dias === 0` detectaba mal "hoy" en ese
    // caso real (visto al verificar contra la API real). Spec 007 ítem 5:
    // mostrar el valor medido en vez de rango — la altura anclada de hoy es
    // ~igual a la real (C2).
    const esHoy = dia.fecha === hoyIso;
    // "Medido" sólo si de verdad hay una medición detrás. Cuando el anclaje no
    // se aplicó (visto con datos reales: el worker no trajo la altura de hoy,
    // `anclaje.motivo = "No hay altura real disponible para hoy"`), la altura
    // anclada ES la estimación pura, y llamarla "medido" es mentir.
    const hoyMedido = esHoy && anclajeAplicado;
    return {
      dia: esHoy ? "Hoy" : formatDiaCorto(dia.fecha),
      rango: hoyMedido ? null : formatRangoMetros(dia.altura_anclada_min_m, dia.altura_anclada_max_m),
      medido: hoyMedido ? formatMetros(dia.altura_anclada_m) : null,
      tendencia: calcularTendencia(delta),
      extrapolado: dia.extrapolado,
    };
  });
}

/** Pure derivation: state -> what the card should show. Never a bare number for a forecast day, always a range. No DOM. */
export function deriveProximosDiasView(state: ProximosDiasState, ahora: Date): ProximosDiasView {
  if (state.kind === "loading") return { kind: "loading" };
  if (state.kind === "unavailable") return { kind: "unavailable" };
  if (state.kind !== "ok") return { kind: "error" };

  const { data } = state;
  const diaMaximo = elegirDiaMaximo(data.dias);

  const frase =
    diaMaximo === undefined
      ? "Todavía no hay pronóstico para los próximos días."
      : `El río podría llegar a ${formatRangoMetros(diaMaximo.altura_anclada_min_m, diaMaximo.altura_anclada_max_m)} el ${formatDiaSemanaFecha(diaMaximo.fecha)}.`;

  return {
    kind: "ready",
    avisoLabel: describeAviso(data.aviso.nivel),
    nivelAviso: data.aviso.nivel,
    frase,
    fraseExtrapolada: diaMaximo?.extrapolado ?? false,
    anclajeTexto: describeAnclaje(data.anclaje),
    dias: construirDiasMini(data.dias, fechaISOLocal(ahora), data.anclaje.aplicado),
    hayExtrapolados: data.dias.some((d) => d.extrapolado),
  };
}

const TITULO = "Próximos días";
const FLECHAS: Record<Tendencia, string> = { sube: "▲", baja: "▼", estable: "→" };
const FLECHAS_ALT: Record<Tendencia, string> = { sube: "sube", baja: "baja", estable: "estable" };
/** CLAUDE.md §7: visible en toda pantalla con pronóstico, no solo en el pie. */
const DISCLAIMER_CORTO = "Orientativo. No reemplaza a Prefectura ni a Defensa Civil.";

export function renderProximosDias(container: HTMLElement, view: ProximosDiasView): void {
  if (view.kind === "loading") {
    renderCardSkeleton(container, TITULO);
    return;
  }
  if (view.kind === "unavailable") {
    container.innerHTML = `
      <h2>${TITULO}</h2>
      <p class="card-info" role="status">Pronóstico no disponible por el momento.</p>
      <p class="disclaimer-corta">${DISCLAIMER_CORTO}</p>
    `;
    return;
  }
  if (view.kind === "error") {
    renderCardError(container, TITULO, "No pudimos obtener el pronóstico. Reintentá en unos minutos.");
    return;
  }

  const itemsMini = view.dias
    .map((dia) => {
      const flecha = dia.tendencia ? FLECHAS[dia.tendencia] : "–";
      const flechaAlt = dia.tendencia ? FLECHAS_ALT[dia.tendencia] : "sin datos previos";
      const caveat = dia.extrapolado
        ? ` <span class="caveat" title="Estimación menos confiable: el río podría estar más alto de lo que podemos calcular con precisión">*</span>`
        : "";
      const valor = dia.medido ? `${dia.medido} medido` : dia.rango;
      return `
        <li${dia.medido ? ' class="dia-mini--hoy"' : ""}>
          <span class="dia-mini-fecha">${dia.dia}</span>
          <span class="dia-mini-flecha" aria-label="Tendencia: ${flechaAlt}">${flecha}</span>
          <span class="dia-mini-rango">${valor}${caveat}</span>
        </li>
      `;
    })
    .join("");

  // Ítem 8/9: "Sin aviso" duplicaba el vocabulario del badge "Normal" de la
  // tarjeta "Hoy"; cuando no hay aviso se dice en una frase llana en vez de
  // repetir la etiqueta técnica del nivel.
  const avisoTexto =
    view.nivelAviso === "sin_aviso" ? "Hoy no hay alerta." : `Nivel de aviso: <strong>${view.avisoLabel}</strong>.`;

  // Menor (revisión de diseño): "Hoy no hay alerta." como primer renglón de
  // una tarjeta que habla del futuro confundía; la frase sobre lo que viene
  // ahora va primero, el aviso vigente después.
  container.innerHTML = `
    <h2>${TITULO}</h2>
    <p class="frase-pronostico">
      ${view.frase}${view.fraseExtrapolada ? ' <span class="caveat">Este día el pronóstico es menos confiable: el río podría estar más alto de lo que podemos calcular con precisión.</span>' : ""}
    </p>
    <p class="aviso-nivel">${avisoTexto}</p>
    ${view.anclajeTexto ? `<p class="anclaje-nota">${view.anclajeTexto}</p>` : ""}
    <ul class="dias-mini">${itemsMini}</ul>
    ${view.hayExtrapolados ? '<p class="caveat-nota">* Estimación menos confiable: el río podría estar más alto de lo que podemos calcular con precisión.</p>' : ""}
    <p class="disclaimer-corta">${DISCLAIMER_CORTO}</p>
  `;
}
