/**
 * Number and date formatting, always `es-AR` (comma decimals, period
 * thousands separator, Spanish day names). Pure functions — no DOM — so they
 * are unit-testable directly.
 */

const metrosFormatters = new Map<number, Intl.NumberFormat>();

function metrosFormatter(decimales: number): Intl.NumberFormat {
  let formatter = metrosFormatters.get(decimales);
  if (!formatter) {
    formatter = new Intl.NumberFormat("es-AR", {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    });
    metrosFormatters.set(decimales, formatter);
  }
  return formatter;
}

const caudalFormatter = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

const diaSemanaFormatter = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric" });
const diaCortoFormatter = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric" });
const horaFormatter = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fechaCortaFormatter = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "numeric" });

/** "3,67 m" */
export function formatMetros(valueM: number, decimales = 2): string {
  return `${metrosFormatter(decimales).format(valueM)} m`;
}

/** "entre 4,7 y 6,7 m" — always a range, never an exact number. */
export function formatRangoMetros(minM: number, maxM: number, decimales = 1): string {
  const f = metrosFormatter(decimales);
  return `entre ${f.format(minM)} y ${f.format(maxM)} m`;
}

/** "12.836 m³/s" — only ever shown as secondary/collapsible detail. */
export function formatCaudal(valueM3s: number): string {
  return `${caudalFormatter.format(valueM3s)} m³/s`;
}

/** "58 mm" */
export function formatMilimetros(valueMm: number): string {
  return `${caudalFormatter.format(valueMm)} mm`;
}

/**
 * Parses a `YYYY-MM-DD` API date as a *local* date (no time component), so
 * formatting it never shifts the calendar day due to timezone conversion.
 */
export function parseFechaLocal(fechaIso: string): Date {
  const [year, month, day] = fechaIso.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

/** "sábado 27" */
export function formatDiaSemanaFecha(fechaIso: string): string {
  return diaSemanaFormatter.format(parseFechaLocal(fechaIso));
}

/** "sáb 27" */
export function formatDiaCorto(fechaIso: string): string {
  return diaCortoFormatter.format(parseFechaLocal(fechaIso)).replace(/\.$/, "");
}

/** "Sube 12 cm" / "Baja 5 cm" / "Estable" / "Tendencia no disponible" */
export function formatTendencia(deltaM: number | null): string {
  if (deltaM === null) return "Tendencia no disponible";
  if (Math.abs(deltaM) < 0.05) return "Estable";
  const cm = Math.round(Math.abs(deltaM) * 100);
  return deltaM > 0 ? `Sube ${cm} cm` : `Baja ${cm} cm`;
}

export type Tendencia = "sube" | "baja" | "estable";

export function calcularTendencia(deltaM: number | null): Tendencia | null {
  if (deltaM === null) return null;
  if (Math.abs(deltaM) < 0.05) return "estable";
  return deltaM > 0 ? "sube" : "baja";
}

/** "hace 15 minutos" / "hace 2 horas" / "hace 3 días" */
export function formatHaceTiempo(fecha: Date, ahora: Date): string {
  const diffMs = Math.max(0, ahora.getTime() - fecha.getTime());
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "hace instantes";
  if (diffMin < 60) return `hace ${diffMin} ${diffMin === 1 ? "minuto" : "minutos"}`;
  const diffHoras = Math.round(diffMin / 60);
  if (diffHoras < 24) return `hace ${diffHoras} ${diffHoras === 1 ? "hora" : "horas"}`;
  const diffDias = Math.round(diffHoras / 24);
  return `hace ${diffDias} ${diffDias === 1 ? "día" : "días"}`;
}

/** Horas transcurridas entre `fecha` y `ahora` (siempre >= 0). */
export function horasDesde(fecha: Date, ahora: Date): number {
  return Math.max(0, ahora.getTime() - fecha.getTime()) / 3_600_000;
}

function esMismoDiaLocal(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * "hoy a las 00:00" / "ayer a las 23:00" / "el 19/9 a las 10:00". Sin color
 * ni umbral de antigüedad: solo dice cuándo fue la medición (CLAUDE.md §6),
 * en lenguaje llano, para que la tarjeta "Hoy" no mezcle esto con un aviso.
 */
export function formatMomentoMedicion(fecha: Date, ahora: Date): string {
  const hora = horaFormatter.format(fecha);
  if (esMismoDiaLocal(fecha, ahora)) return `hoy a las ${hora}`;
  const ayer = new Date(ahora);
  ayer.setDate(ayer.getDate() - 1);
  if (esMismoDiaLocal(fecha, ayer)) return `ayer a las ${hora}`;
  return `el ${fechaCortaFormatter.format(fecha)} a las ${hora}`;
}
