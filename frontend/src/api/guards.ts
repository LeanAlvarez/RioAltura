import type {
  AlturaDiaria,
  Anclaje,
  AvisoPronostico,
  DiaPronostico,
  ErrorPronostico,
  Estadisticas,
  EstadoAltura,
  Evento,
  HistoricoDia,
  MismoDiaAnio,
  NivelAviso,
  PercentilHoy,
  Pronostico,
  PronosticoAguasArriba,
  RangoAlerta,
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
    isNumber(value.altura_anclada_m) &&
    isNumber(value.altura_anclada_min_m) &&
    isNumber(value.altura_anclada_max_m) &&
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

export function isAnclaje(value: unknown): value is Anclaje {
  if (!isRecord(value)) return false;
  return (
    typeof value.aplicado === "boolean" &&
    isNullableNumber(value.sesgo_m) &&
    isNullableNumber(value.altura_real_m) &&
    isNullableString(value.fecha_referencia) &&
    isNullableString(value.motivo)
  );
}

export function isPronostico(value: unknown): value is Pronostico {
  if (!isRecord(value)) return false;
  return (
    typeof value.emitido === "string" &&
    typeof value.gauge_id === "string" &&
    Array.isArray(value.dias) &&
    value.dias.every(isDiaPronostico) &&
    isAvisoPronostico(value.aviso) &&
    isAnclaje(value.anclaje)
  );
}

export function isPronosticoAguasArriba(value: unknown): value is PronosticoAguasArriba {
  if (!isRecord(value)) return false;
  return (
    typeof value.emitido === "string" &&
    typeof value.gauge_id === "string" &&
    Array.isArray(value.dias) &&
    value.dias.every(isDiaPronostico)
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

export function isPercentilHoy(value: unknown): value is PercentilHoy {
  if (!isRecord(value)) return false;
  return isNumber(value.altura_m) && isNumber(value.percentil) && isNumber(value.ventana_dias);
}

export function isErrorPronostico(value: unknown): value is ErrorPronostico {
  if (!isRecord(value)) return false;
  return isNumber(value.lead_dias) && isNumber(value.muestras) && isNullableNumber(value.mae_m);
}

export function isRangoAlerta(value: unknown): value is RangoAlerta {
  if (!isRecord(value)) return false;
  return typeof value.desde === "string" && typeof value.hasta === "string" && isNumber(value.max_m);
}

export function isMismoDiaAnio(value: unknown): value is MismoDiaAnio {
  if (!isRecord(value)) return false;
  return isNumber(value.anio) && isNumber(value.altura_m);
}

export function isEvento(value: unknown): value is Evento {
  if (!isRecord(value)) return false;
  return typeof value.fecha === "string" && isNumber(value.altura_m) && typeof value.etiqueta === "string";
}

export function isEstadisticas(value: unknown): value is Estadisticas {
  if (!isRecord(value)) return false;
  return (
    (value.percentil_hoy === null || isPercentilHoy(value.percentil_hoy)) &&
    isErrorPronostico(value.error_pronostico) &&
    Array.isArray(value.dias_en_alerta) &&
    value.dias_en_alerta.every(isRangoAlerta) &&
    Array.isArray(value.mismo_dia_otros_anios) &&
    value.mismo_dia_otros_anios.every(isMismoDiaAnio) &&
    Array.isArray(value.eventos) &&
    value.eventos.every(isEvento)
  );
}
