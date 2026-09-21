import type { AlturaDiaria, DiaPronostico, HistoricoDia, Pronostico, UltimaAltura } from "../api/types";
import { CAUDAL_MAX_CALIBRADO_M3S, CURVA_A, CURVA_B, CURVA_C, RANGO_ESTIMACION_M } from "../domain/dominio";

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

export function mockPronostico(ahora: Date = new Date()): Pronostico {
  const dias: DiaPronostico[] = CAUDALES_PRONOSTICO_M3S.map((caudal, index) => {
    const alturaEst = Math.round(alturaEstimadaMock(caudal) * 100) / 100;
    return {
      fecha: fechaISO(addDias(ahora, index)),
      lead_dias: index,
      caudal_m3s: caudal,
      altura_est_m: alturaEst,
      altura_min_m: Math.round((alturaEst - RANGO_ESTIMACION_M) * 100) / 100,
      altura_max_m: Math.round((alturaEst + RANGO_ESTIMACION_M) * 100) / 100,
      extrapolado: caudal > CAUDAL_MAX_CALIBRADO_M3S,
    };
  });

  return {
    emitido: new Date(ahora.getTime() - 3 * 3_600_000).toISOString(),
    gauge_id: "hybas_6121320620",
    dias,
    aviso: {
      nivel: "sin_aviso",
      umbral_m3s: null,
      primer_dia: null,
      caudal_max_m3s: Math.max(...CAUDALES_PRONOSTICO_M3S.slice(1)),
    },
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
