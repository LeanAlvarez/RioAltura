import type { EstadoAltura } from "../api/types";
import { formatMetros } from "../format";
import { ALERTA_M, EVACUACION_EN_SECO_M, EVACUACION_M } from "./dominio";

export type Tono = "ok" | "warn" | "error" | "danger";

export interface EstadoView {
  label: string;
  tono: Tono;
}

const ESTADOS: Record<EstadoAltura, EstadoView> = {
  normal: { label: "Normal", tono: "ok" },
  evacuacion_en_seco: { label: "Evacuación en seco", tono: "warn" },
  alerta: { label: "Alerta", tono: "error" },
  evacuacion: { label: "Evacuación", tono: "danger" },
};

export function describeEstado(estado: EstadoAltura): EstadoView {
  return ESTADOS[estado];
}

/**
 * "Faltan X,XX m para los Y m, cuando..." (correcciones de diseño, spec 007
 * ítem 2): en la primera pantalla no había ninguna referencia de qué tan
 * lejos está el río del primer umbral. No cambia nombres ni valores de los
 * umbrales (CLAUDE.md §5, §9); solo describe la distancia contra los mismos
 * `EVACUACION_EN_SECO_M`/`ALERTA_M`/`EVACUACION_M` de `dominio.ts`. Si ya
 * superó un umbral, dice cuál.
 */
export function describeDistanciaUmbral(alturaM: number): string {
  if (alturaM < EVACUACION_EN_SECO_M) {
    return `Faltan ${formatMetros(EVACUACION_EN_SECO_M - alturaM)} para los ${formatMetros(EVACUACION_EN_SECO_M)}, cuando el municipio empieza a evacuar por precaución.`;
  }
  if (alturaM < ALERTA_M) {
    return `Ya superó los ${formatMetros(EVACUACION_EN_SECO_M)} de evacuación en seco. Faltan ${formatMetros(ALERTA_M - alturaM)} para la alerta (${formatMetros(ALERTA_M)}).`;
  }
  if (alturaM < EVACUACION_M) {
    return `Ya superó la alerta (${formatMetros(ALERTA_M)}). Faltan ${formatMetros(EVACUACION_M - alturaM)} para la evacuación (${formatMetros(EVACUACION_M)}).`;
  }
  return `Ya superó la evacuación (${formatMetros(EVACUACION_M)}).`;
}
