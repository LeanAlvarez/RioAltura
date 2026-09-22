import type {
  AlturaDiaria,
  DiaPronostico,
  Estadisticas,
  HistoricoDia,
  Pronostico,
  PronosticoAguasArriba,
  SaltoGrande,
  UltimaAltura,
} from "../api/types";
import {
  CAUDAL_MAX_CALIBRADO_M3S,
  CURVA_A,
  CURVA_B,
  CURVA_C,
  HORIZONTE_ANCLAJE_DIAS,
  RANGO_ESTIMACION_M,
} from "../domain/dominio";

/**
 * Realistic fixtures for offline/manual development (`VITE_USE_MOCKS=true`).
 * Scenario per spec 005: hoy ~3,7 m subiendo; pronóstico hasta ~9.100 m³/s
 * (≈5,5 m), sin aviso.
 *
 * The rating curve constants come from `../domain/dominio.ts` (the single
 * frontend mirror of `backend/app/config/dominio.py`); only the formula
 * below is duplicated for mock purposes, since the real API computes
 * `altura_est_m` itself.
 */

function alturaEstimadaMock(caudalM3s: number): number {
  const lnQ = Math.log(caudalM3s);
  return CURVA_A * lnQ * lnQ + CURVA_B * lnQ + CURVA_C;
}

function fechaISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDias(base: Date, dias: number): Date {
  const copia = new Date(base);
  copia.setUTCDate(copia.getUTCDate() + dias);
  return copia;
}

/** Small deterministic pseudo-random generator (mulberry32) for reproducible mock series. */
function crearGenerador(semilla: number): () => number {
  let a = semilla;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mockUltimaAltura(ahora: Date = new Date()): UltimaAltura {
  return {
    fecha_hora: new Date(ahora.getTime() - 40 * 60_000).toISOString(),
    altura_m: 3.67,
    fuente: "ina",
    tendencia_24h_m: 0.12,
    estado: "normal",
  };
}

/**
 * Daily real-level series ending "today" at ~3,67 m, with a gentle rise over
 * the last two weeks and, further back, a bump resembling a past flood
 * (per CLAUDE.md's reference scenarios) so 90/365-day views look realistic.
 */
export function mockAlturasDiarias(desde: string, hasta: string, ahora: Date = new Date()): AlturaDiaria[] {
  const inicio = new Date(`${desde}T00:00:00Z`);
  const fin = new Date(`${hasta}T00:00:00Z`);
  const hoyISO = fechaISO(ahora);
  const random = crearGenerador(20260921);
  const dias: AlturaDiaria[] = [];

  for (let cursor = inicio; fechaISO(cursor) <= fechaISO(fin); cursor = addDias(cursor, 1)) {
    const fecha = fechaISO(cursor);
    if (fecha > hoyISO) break;

    const diasAntesDeHoy = Math.round((ahora.getTime() - cursor.getTime()) / 86_400_000);
    let base = 2.9;

    // Gentle rise over the last 14 days, ending at 3,67 m hoy.
    if (diasAntesDeHoy <= 14) {
      base = 3.67 - (diasAntesDeHoy / 14) * 0.7;
    }

    // A past-flood bump resembling jun 2025 (~7,6 m), ~90 días atrás.
    const distanciaPico = Math.abs(diasAntesDeHoy - 90);
    if (distanciaPico < 20) {
      base += (1 - distanciaPico / 20) * 4.2;
    }

    const ruido = (random() - 0.5) * 0.2;
    dias.push({ fecha, altura_m: Math.max(2.2, Math.round((base + ruido) * 100) / 100) });
  }

  return dias;
}

const CAUDALES_PRONOSTICO_M3S = [3500, 4200, 5200, 6300, 7400, 8300, 9100];

/**
 * El pronóstico de hoy (lead 0) según la curva rara vez coincide con la
 * altura real de hoy (`mockUltimaAltura`): igual que en producción, se
 * ancla (spec 007, C2) trasladando el rango hacia el dato medido, con el
 * sesgo decayendo a 0 en `HORIZONTE_ANCLAJE_DIAS`. Nunca toca `caudal_m3s`.
 */
export function mockPronostico(ahora: Date = new Date()): Pronostico {
  const alturaReal = mockUltimaAltura(ahora).altura_m;

  const dias: DiaPronostico[] = CAUDALES_PRONOSTICO_M3S.map((caudal, index) => {
    const alturaEst = Math.round(alturaEstimadaMock(caudal) * 100) / 100;
    const alturaMin = Math.round((alturaEst - RANGO_ESTIMACION_M) * 100) / 100;
    const alturaMax = Math.round((alturaEst + RANGO_ESTIMACION_M) * 100) / 100;
    return {
      fecha: fechaISO(addDias(ahora, index)),
      lead_dias: index,
      caudal_m3s: caudal,
      altura_est_m: alturaEst,
      altura_min_m: alturaMin,
      altura_max_m: alturaMax,
      altura_anclada_m: alturaEst,
      altura_anclada_min_m: alturaMin,
      altura_anclada_max_m: alturaMax,
      extrapolado: caudal > CAUDAL_MAX_CALIBRADO_M3S,
    };
  });

  const diaHoy = dias[0];
  const sesgo = diaHoy ? Math.round((alturaReal - diaHoy.altura_est_m) * 100) / 100 : null;

  const diasAnclados =
    sesgo === null
      ? dias
      : dias.map((dia, index) => {
          const factor = Math.max(0, 1 - index / HORIZONTE_ANCLAJE_DIAS);
          const ajuste = sesgo * factor;
          return {
            ...dia,
            altura_anclada_m: Math.round((dia.altura_est_m + ajuste) * 100) / 100,
            altura_anclada_min_m: Math.round((dia.altura_min_m + ajuste) * 100) / 100,
            altura_anclada_max_m: Math.round((dia.altura_max_m + ajuste) * 100) / 100,
          };
        });

  return {
    emitido: new Date(ahora.getTime() - 3 * 3_600_000).toISOString(),
    gauge_id: "hybas_6121320620",
    dias: diasAnclados,
    aviso: {
      nivel: "sin_aviso",
      umbral_m3s: null,
      primer_dia: null,
      caudal_max_m3s: Math.max(...CAUDALES_PRONOSTICO_M3S.slice(1)),
    },
    anclaje:
      sesgo === null || !diaHoy
        ? {
            aplicado: false,
            sesgo_m: null,
            altura_real_m: null,
            fecha_referencia: null,
            motivo: "No hay altura real disponible para hoy",
          }
        : {
            aplicado: true,
            sesgo_m: sesgo,
            altura_real_m: alturaReal,
            fecha_referencia: fechaISO(ahora),
            motivo: null,
          },
  };
}

const CAUDALES_AGUAS_ARRIBA_M3S = [3000, 3600, 4300, 5100, 5900, 6700, 7500];

/**
 * Pronóstico del gauge aguas arriba (zona Concordia / Salto Grande, spec 007
 * T5). No hay altura real medida ahí para anclar contra ella, así que
 * `altura_anclada_*` queda igual a la estimación de la curva.
 */
export function mockPronosticoAguasArriba(ahora: Date = new Date()): PronosticoAguasArriba {
  const dias: DiaPronostico[] = CAUDALES_AGUAS_ARRIBA_M3S.map((caudal, index) => {
    const alturaEst = Math.round(alturaEstimadaMock(caudal) * 100) / 100;
    const alturaMin = Math.round((alturaEst - RANGO_ESTIMACION_M) * 100) / 100;
    const alturaMax = Math.round((alturaEst + RANGO_ESTIMACION_M) * 100) / 100;
    return {
      fecha: fechaISO(addDias(ahora, index)),
      lead_dias: index,
      caudal_m3s: caudal,
      altura_est_m: alturaEst,
      altura_min_m: alturaMin,
      altura_max_m: alturaMax,
      altura_anclada_m: alturaEst,
      altura_anclada_min_m: alturaMin,
      altura_anclada_max_m: alturaMax,
      extrapolado: caudal > CAUDAL_MAX_CALIBRADO_M3S,
    };
  });

  return {
    emitido: new Date(ahora.getTime() - 5 * 3_600_000).toISOString(),
    gauge_id: "hybas_6120865460",
    dias,
  };
}

/** Fixtures de `/estadisticas` (spec 007): coherentes con los escenarios de referencia de CLAUDE.md §5. */
export function mockEstadisticas(ahora: Date = new Date()): Estadisticas {
  return {
    percentil_hoy: { altura_m: mockUltimaAltura(ahora).altura_m, percentil: 78.4, ventana_dias: 365 },
    error_pronostico: { lead_dias: 3, muestras: 420, mae_m: 0.5 },
    dias_en_alerta: [
      { desde: fechaISO(addDias(ahora, -76)), hasta: fechaISO(addDias(ahora, -70)), max_m: 7.66 },
    ],
    mismo_dia_otros_anios: [
      { anio: ahora.getFullYear() - 2, altura_m: 3.1 },
      { anio: ahora.getFullYear() - 1, altura_m: 5.8 },
    ],
    eventos: [
      { fecha: "2024-05-14", altura_m: 9.06, etiqueta: "Máximo diario registrado (INA)" },
      { fecha: "2025-06-29", altura_m: 7.66, etiqueta: "Crecida de referencia" },
      { fecha: "2026-07-23", altura_m: 4.44, etiqueta: "Costanera inundada" },
    ],
  };
}

/**
 * Fixture de `/salto-grande` (spec 012), con los valores reales del
 * comunicado del 22/09/2026 citado en la spec.
 */
export function mockSaltoGrande(ahora: Date = new Date()): SaltoGrande {
  const hoy = fechaISO(ahora);
  const ayer = fechaISO(addDias(ahora, -1));

  return {
    comunicado: {
      fecha: hoy,
      aporte_m3s: 7553,
      evacuado_m3s: 7821,
      nivel_embalse_m: 34.81,
      estado_vertedero: "Cerrado",
      texto_proyeccion:
        "Hasta la hora 15:00 de mañana, el caudal medio diario evacuado variará entre 8.000 y 7.000 m³/s. " +
        "Cotas máxima y mínima referidas al puerto de Concordia: 7,00 y 5,30 metros, respectivamente. " +
        "Cotas máxima y mínima referidas al puerto de Salto: 7,20 y 5,50 metros, respectivamente. " +
        "El nivel del embalse tenderá a 34,50 m.",
    },
    comunicado_anterior: {
      fecha: ayer,
      aporte_m3s: 9176,
      evacuado_m3s: 9692,
      nivel_embalse_m: 34.88,
      estado_vertedero: "Cerrado",
      texto_proyeccion: "Comunicado del día anterior.",
    },
    caudales_cascada: [
      { estacion: "Machadinho", fecha: hoy, caudal_m3s: 2441 },
      { estacion: "Itá", fecha: hoy, caudal_m3s: 2586 },
    ],
    lluvia_observada: [
      { subcuenca: "El Soberbio", fecha: fechaISO(addDias(ahora, -2)), lluvia_mm: 58 },
      { subcuenca: "El Soberbio", fecha: fechaISO(addDias(ahora, -1)), lluvia_mm: 1 },
      { subcuenca: "El Soberbio", fecha: hoy, lluvia_mm: 10 },
    ],
    lluvia_pronostico: [
      { subcuenca: "El Soberbio", fecha: fechaISO(addDias(ahora, 5)), lluvia_mm: 6 },
      { subcuenca: "El Soberbio", fecha: fechaISO(addDias(ahora, 6)), lluvia_mm: 14 },
    ],
  };
}

export function mockPronosticoHistorico(desde: string, lead: number, ahora: Date = new Date()): HistoricoDia[] {
  const inicio = new Date(`${desde}T00:00:00Z`);
  const hoyISO = fechaISO(ahora);
  const random = crearGenerador(31 * lead + 7);
  const dias: HistoricoDia[] = [];

  for (let cursor = inicio; fechaISO(cursor) <= hoyISO; cursor = addDias(cursor, 1)) {
    const caudal = 4000 + random() * 4000;
    dias.push({
      fecha: fechaISO(cursor),
      caudal_m3s: Math.round(caudal),
      altura_est_m: Math.round(alturaEstimadaMock(caudal) * 100) / 100,
      extrapolado: false,
    });
  }

  return dias;
}
