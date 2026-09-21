import type { EstadoAltura } from "../api/types";

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
