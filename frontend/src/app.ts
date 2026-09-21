import { getUltimaAltura } from "./api/alturas";
import type { FetchResult } from "./api/client";
import { getPronostico } from "./api/pronostico";
import type { Pronostico, UltimaAltura } from "./api/types";
import type { MedicionActual } from "./capas";
import { HORAS_DATO_VIEJO } from "./domain/dominio";
import { formatMomentoMedicion, horasDesde } from "./format";

export interface DashboardData {
  altura: FetchResult<UltimaAltura>;
  pronostico: FetchResult<Pronostico>;
}

/**
 * Loads the two top-card endpoints independently: each already resolves to a
 * `FetchResult` (never throws, see `api/client.ts`), so one endpoint
 * failing — including a 503 from `/pronostico` — never affects the other's
 * result or throws an unhandled rejection.
 */
export async function loadDashboardData(fetchFn?: typeof fetch): Promise<DashboardData> {
  const [altura, pronostico] = await Promise.all([getUltimaAltura(fetchFn), getPronostico(fetchFn)]);
  return { altura, pronostico };
}

/**
 * El nivel máximo estimado (anclado, spec 007 M3) entre los próximos días,
 * para pasarle al mapa (spec 006).
 */
export function nivelMaximoEstimado(pronostico: FetchResult<Pronostico>): number | null {
  if (pronostico.kind !== "ok") return null;
  const candidatos = pronostico.data.dias.filter((d) => d.lead_dias >= 1);
  const pool = candidatos.length > 0 ? candidatos : pronostico.data.dias;
  const primero = pool[0];
  if (!primero) return null;
  let max = primero.altura_anclada_m;
  for (const dia of pool) if (dia.altura_anclada_m > max) max = dia.altura_anclada_m;
  return max;
}

/**
 * La medición real del puerto, que es donde abre el mapa (spec 007, decisión
 * del usuario tras la revisión de diseño). Viaja con su fecha y con si es
 * reciente, porque una medición vieja se sigue usando pero rotulada: el mapa
 * nunca cae al pronóstico, que se leería como la situación de hoy.
 */
export function medicionActual(
  altura: FetchResult<UltimaAltura>,
  ahora: Date = new Date(),
): MedicionActual | null {
  if (altura.kind !== "ok") return null;
  const medidoEn = new Date(altura.data.fecha_hora);
  if (Number.isNaN(medidoEn.getTime())) return null;
  return {
    alturaM: altura.data.altura_m,
    fechaHora: formatMomentoMedicion(medidoEn, ahora),
    reciente: horasDesde(medidoEn, ahora) <= HORAS_DATO_VIEJO,
  };
}
