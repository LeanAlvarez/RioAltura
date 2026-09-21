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
  /** `altura_est_m` trasladada hacia la altura real de hoy (spec 007, C2). Presentación, no recalibración. */
  altura_anclada_m: number;
  altura_anclada_min_m: number;
  altura_anclada_max_m: number;
  extrapolado: boolean;
}

export type NivelAviso = "sin_aviso" | "atencion" | "alerta_probable";

export interface AvisoPronostico {
  nivel: NivelAviso;
  umbral_m3s: number | null;
  primer_dia: string | null;
  caudal_max_m3s: number | null;
}

export interface Anclaje {
  aplicado: boolean;
  sesgo_m: number | null;
  altura_real_m: number | null;
  fecha_referencia: string | null;
  motivo: string | null;
}

export interface Pronostico {
  emitido: string;
  gauge_id: string;
  dias: DiaPronostico[];
  aviso: AvisoPronostico;
  anclaje: Anclaje;
}

/** Mismo `DiaPronostico[]` que `Pronostico`, sin `aviso` (el gauge aguas arriba no tiene nivel de aviso propio). */
export interface PronosticoAguasArriba {
  emitido: string;
  gauge_id: string;
  dias: DiaPronostico[];
}

export interface HistoricoDia {
  fecha: string;
  caudal_m3s: number;
  altura_est_m: number;
  extrapolado: boolean;
}

export interface PercentilHoy {
  altura_m: number;
  percentil: number;
  ventana_dias: number;
}

export interface ErrorPronostico {
  lead_dias: number;
  muestras: number;
  mae_m: number | null;
}

export interface RangoAlerta {
  desde: string;
  hasta: string;
  max_m: number;
}

export interface MismoDiaAnio {
  anio: number;
  altura_m: number;
}

export interface Evento {
  fecha: string;
  altura_m: number;
  etiqueta: string;
}

export interface Estadisticas {
  percentil_hoy: PercentilHoy | null;
  error_pronostico: ErrorPronostico;
  dias_en_alerta: RangoAlerta[];
  mismo_dia_otros_anios: MismoDiaAnio[];
  eventos: Evento[];
}
