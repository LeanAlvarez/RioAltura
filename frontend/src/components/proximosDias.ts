import type { FetchResult } from "../api/client";
import type { DiaPronostico, Pronostico } from "../api/types";
import { describeAviso } from "../domain/aviso";
import { calcularTendencia, formatDiaCorto, formatDiaSemanaFecha, formatRangoMetros, type Tendencia } from "../format";
import { renderCardError, renderCardSkeleton } from "./card";

export type ProximosDiasState = { kind: "loading" } | FetchResult<Pronostico>;

export interface DiaMiniView {
  dia: string;
  rango: string;
  tendencia: Tendencia | null;
  extrapolado: boolean;
}

export type ProximosDiasView =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error" }
  | {
      kind: "ready";
      avisoLabel: string;
      frase: string;
      fraseExtrapolada: boolean;
      dias: DiaMiniView[];
      hayExtrapolados: boolean;
    };

/** El día usado para la frase: el de mayor altura estimada entre los próximos (lead >= 1). */
function elegirDiaMaximo(dias: readonly DiaPronostico[]): DiaPronostico | undefined {
  const candidatos = dias.filter((d) => d.lead_dias >= 1);
  const pool = candidatos.length > 0 ? candidatos : dias;
  return pool.reduce<DiaPronostico | undefined>(
    (max, dia) => (max === undefined || dia.altura_max_m > max.altura_max_m ? dia : max),
    undefined,
  );
}

function construirDiasMini(dias: readonly DiaPronostico[]): DiaMiniView[] {
  return dias.map((dia, index) => {
    const anterior = dias[index - 1];
    const delta = anterior ? dia.altura_est_m - anterior.altura_est_m : null;
    return {
      dia: formatDiaCorto(dia.fecha),
      rango: formatRangoMetros(dia.altura_min_m, dia.altura_max_m),
      tendencia: calcularTendencia(delta),
      extrapolado: dia.extrapolado,
    };
  });
}

/** Pure derivation: state -> what the card should show. Never a bare number, always a range. No DOM. */
export function deriveProximosDiasView(state: ProximosDiasState): ProximosDiasView {
  if (state.kind === "loading") return { kind: "loading" };
  if (state.kind === "unavailable") return { kind: "unavailable" };
  if (state.kind !== "ok") return { kind: "error" };

  const { data } = state;
  const diaMaximo = elegirDiaMaximo(data.dias);

  const frase =
    diaMaximo === undefined
      ? "Todavía no hay pronóstico para los próximos días."
      : `El río podría llegar a ${formatRangoMetros(diaMaximo.altura_min_m, diaMaximo.altura_max_m)} el ${formatDiaSemanaFecha(diaMaximo.fecha)}.`;

  return {
    kind: "ready",
    avisoLabel: describeAviso(data.aviso.nivel),
    frase,
    fraseExtrapolada: diaMaximo?.extrapolado ?? false,
    dias: construirDiasMini(data.dias),
    hayExtrapolados: data.dias.some((d) => d.extrapolado),
  };
}

const TITULO = "Próximos días";
const FLECHAS: Record<Tendencia, string> = { sube: "▲", baja: "▼", estable: "→" };
const FLECHAS_ALT: Record<Tendencia, string> = { sube: "sube", baja: "baja", estable: "estable" };

export function renderProximosDias(container: HTMLElement, view: ProximosDiasView): void {
  if (view.kind === "loading") {
    renderCardSkeleton(container, TITULO);
    return;
  }
  if (view.kind === "unavailable") {
    container.innerHTML = `
      <h2>${TITULO}</h2>
      <p class="card-info" role="status">Pronóstico no disponible por el momento.</p>
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
      const caveat = dia.extrapolado ? ` <span class="caveat" title="Estimación fuera del rango calibrado">*</span>` : "";
      return `
        <li>
          <span class="dia-mini-fecha">${dia.dia}</span>
          <span class="dia-mini-flecha" aria-label="Tendencia: ${flechaAlt}">${flecha}</span>
          <span class="dia-mini-rango">${dia.rango}${caveat}</span>
        </li>
      `;
    })
    .join("");

  container.innerHTML = `
    <h2>${TITULO}</h2>
    <p class="aviso-nivel">Nivel de aviso: <strong>${view.avisoLabel}</strong></p>
    <p class="frase-pronostico">
      ${view.frase}${view.fraseExtrapolada ? ' <span class="caveat">Esta estimación excede el rango calibrado de la curva: es una extrapolación.</span>' : ""}
    </p>
    <ul class="dias-mini">${itemsMini}</ul>
    ${view.hayExtrapolados ? '<p class="caveat-nota">* Estimación fuera del rango calibrado de la curva (extrapolación).</p>' : ""}
  `;
}
