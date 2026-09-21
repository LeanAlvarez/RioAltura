import type { NivelAviso } from "../api/types";

const NIVELES: Record<NivelAviso, string> = {
  sin_aviso: "Sin aviso",
  atencion: "Atención",
  alerta_probable: "Alerta probable",
};

export function describeAviso(nivel: NivelAviso): string {
  return NIVELES[nivel];
}
