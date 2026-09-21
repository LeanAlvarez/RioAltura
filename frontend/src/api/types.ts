/**
 * TypeScript mirror of the schemas in `contracts/openapi.yaml` (specs 002 y 003).
 * Keep this in sync with that file; it is the source of truth for the contract.
 */

export type EstadoAltura = "normal" | "evacuacion_en_seco" | "alerta" | "evacuacion";

export interface UltimaAltura {
  fecha_hora: string;
  altura_m: number;
  fuente: "ina" | "prefectura";
  tendencia_24h_m: number | null;
  estado: EstadoAltura;
}

export interface AlturaDiaria {
  fecha: string;
  altura_m: number;
}

export interface DiaPronostico {
  fecha: string;
  lead_dias: number;
  caudal_m3s: number;
  altura_est_m: number;
  altura_min_m: number;
  altura_max_m: number;
  extrapolado: boolean;
}

export type NivelAviso = "sin_aviso" | "atencion" | "alerta_probable";

export interface AvisoPronostico {
  nivel: NivelAviso;
  umbral_m3s: number | null;
  primer_dia: string | null;
  caudal_max_m3s: number | null;
}

export interface Pronostico {
  emitido: string;
  gauge_id: string;
  dias: DiaPronostico[];
  aviso: AvisoPronostico;
}

export interface HistoricoDia {
  fecha: string;
  caudal_m3s: number;
  altura_est_m: number;
  extrapolado: boolean;
}
