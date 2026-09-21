import type {
  AlturaDiaria,
  AvisoPronostico,
  DiaPronostico,
  EstadoAltura,
  HistoricoDia,
  NivelAviso,
  Pronostico,
  UltimaAltura,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

const ESTADOS: readonly EstadoAltura[] = ["normal", "evacuacion_en_seco", "alerta", "evacuacion"];
const NIVELES_AVISO: readonly NivelAviso[] = ["sin_aviso", "atencion", "alerta_probable"];

export function isUltimaAltura(value: unknown): value is UltimaAltura {
  if (!isRecord(value)) return false;
  return (
    typeof value.fecha_hora === "string" &&
    isNumber(value.altura_m) &&
    (value.fuente === "ina" || value.fuente === "prefectura") &&
    isNullableNumber(value.tendencia_24h_m) &&
    typeof value.estado === "string" &&
    (ESTADOS as readonly string[]).includes(value.estado)
  );
}

export function isAlturaDiaria(value: unknown): value is AlturaDiaria {
  if (!isRecord(value)) return false;
  return typeof value.fecha === "string" && isNumber(value.altura_m);
}

export function isAlturaDiariaList(value: unknown): value is AlturaDiaria[] {
  return Array.isArray(value) && value.every(isAlturaDiaria);
}

export function isDiaPronostico(value: unknown): value is DiaPronostico {
  if (!isRecord(value)) return false;
  return (
    typeof value.fecha === "string" &&
    isNumber(value.lead_dias) &&
    isNumber(value.caudal_m3s) &&
    isNumber(value.altura_est_m) &&
    isNumber(value.altura_min_m) &&
    isNumber(value.altura_max_m) &&
    typeof value.extrapolado === "boolean"
  );
}

export function isAvisoPronostico(value: unknown): value is AvisoPronostico {
  if (!isRecord(value)) return false;
  return (
    typeof value.nivel === "string" &&
    (NIVELES_AVISO as readonly string[]).includes(value.nivel) &&
    isNullableNumber(value.umbral_m3s) &&
    isNullableString(value.primer_dia) &&
    isNullableNumber(value.caudal_max_m3s)
  );
}

export function isPronostico(value: unknown): value is Pronostico {
  if (!isRecord(value)) return false;
  return (
    typeof value.emitido === "string" &&
    typeof value.gauge_id === "string" &&
    Array.isArray(value.dias) &&
    value.dias.every(isDiaPronostico) &&
    isAvisoPronostico(value.aviso)
  );
}

export function isHistoricoDia(value: unknown): value is HistoricoDia {
  if (!isRecord(value)) return false;
  return (
    typeof value.fecha === "string" &&
    isNumber(value.caudal_m3s) &&
    isNumber(value.altura_est_m) &&
    typeof value.extrapolado === "boolean"
  );
}

export function isHistoricoDiaList(value: unknown): value is HistoricoDia[] {
  return Array.isArray(value) && value.every(isHistoricoDia);
}
