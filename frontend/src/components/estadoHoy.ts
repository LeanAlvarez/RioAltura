import type { FetchResult } from "../api/client";
import type { UltimaAltura } from "../api/types";
import { describeEstado } from "../domain/estado";
import { HORAS_DATO_VIEJO } from "../domain/dominio";
import { formatHaceTiempo, formatMetros, formatTendencia, horasDesde } from "../format";
import { renderCardError, renderCardSkeleton } from "./card";

export type EstadoHoyState = { kind: "loading" } | FetchResult<UltimaAltura>;

export type EstadoHoyView =
  | { kind: "loading" }
  | { kind: "error" }
  | {
      kind: "ready";
      altura: string;
      estadoLabel: string;
      estadoTono: "ok" | "warn" | "error" | "danger";
      tendencia: string;
      actualizado: string;
      datoViejo: boolean;
    };

/** Pure derivation: state + current time -> what the card should show. No DOM. */
export function deriveEstadoHoyView(state: EstadoHoyState, ahora: Date): EstadoHoyView {
  if (state.kind === "loading") return { kind: "loading" };
  if (state.kind !== "ok") return { kind: "error" };

  const { data } = state;
  const fecha = new Date(data.fecha_hora);
  const estado = describeEstado(data.estado);

  return {
    kind: "ready",
    altura: formatMetros(data.altura_m),
    estadoLabel: estado.label,
    estadoTono: estado.tono,
    tendencia: formatTendencia(data.tendencia_24h_m),
    actualizado: formatHaceTiempo(fecha, ahora),
    datoViejo: horasDesde(fecha, ahora) > HORAS_DATO_VIEJO,
  };
}

const TITULO = "Hoy";

export function renderEstadoHoy(container: HTMLElement, view: EstadoHoyView): void {
  if (view.kind === "loading") {
    renderCardSkeleton(container, TITULO);
    return;
  }
  if (view.kind === "error") {
    renderCardError(container, TITULO, "No pudimos obtener la altura actual del río. Reintentá en unos minutos.");
    return;
  }

  container.innerHTML = `
    <h2>${TITULO}</h2>
    <p class="altura-actual">${view.altura}</p>
    <p class="badge" data-tono="${view.estadoTono}">${view.estadoLabel}</p>
    <p class="tendencia">${view.tendencia} en las últimas 24 h</p>
    <p class="actualizado${view.datoViejo ? " actualizado--viejo" : ""}">
      Actualizado ${view.actualizado}${view.datoViejo ? " — dato desactualizado (más de 6 h)" : ""}
    </p>
  `;
}
