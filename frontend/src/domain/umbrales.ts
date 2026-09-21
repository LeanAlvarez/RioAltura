import { ALERTA_M, EVACUACION_EN_SECO_M, EVACUACION_M } from "./dominio";

/**
 * Qué significa cada umbral, en lenguaje llano.
 *
 * Los VALORES y los nombres oficiales vienen de `dominio.ts` y no se tocan
 * (CLAUDE.md §5 y §9). Lo que se agrega acá son las explicaciones, porque en
 * la revisión de diseño quedó claro que "evacuación en seco" y "evacuación"
 * son indistinguibles para alguien sin formación técnica — y esa diferencia
 * es justamente la que separa prepararse de irse.
 *
 * PENDIENTE DE CONFIRMACIÓN MUNICIPAL: los textos los autorizó Leandro, pero
 * todavía no los confirmó la Municipalidad de Colón. No los reescribas sin
 * esa confirmación.
 */
export interface Umbral {
  id: "evacuacion_preventiva" | "alerta" | "evacuacion";
  /** Nombre que se muestra al vecino. */
  nombre: string;
  /** Término oficial, cuando difiere del nombre mostrado. */
  terminoOficial: string | null;
  alturaM: number;
  explicacion: string;
}

export const UMBRALES: readonly Umbral[] = [
  {
    id: "evacuacion_preventiva",
    nombre: "Evacuación preventiva",
    terminoOficial: "evacuación en seco",
    alturaM: EVACUACION_EN_SECO_M,
    explicacion:
      "El municipio puede empezar a trasladar a las familias de las zonas más bajas antes de que llegue el agua.",
  },
  {
    id: "alerta",
    nombre: "Alerta",
    terminoOficial: null,
    alturaM: ALERTA_M,
    explicacion:
      "El río está alto. Seguí las indicaciones oficiales y preparate por si hay que salir.",
  },
  {
    id: "evacuacion",
    nombre: "Evacuación",
    terminoOficial: null,
    alturaM: EVACUACION_M,
    explicacion:
      "Se evacúan las zonas inundables. Si vivís en una zona baja, seguí las indicaciones de Defensa Civil.",
  },
];

/** El umbral en el que está el río, o null si todavía no llegó a ninguno. */
export function umbralAlcanzado(alturaM: number): Umbral | null {
  let alcanzado: Umbral | null = null;
  for (const umbral of UMBRALES) {
    if (alturaM >= umbral.alturaM) alcanzado = umbral;
  }
  return alcanzado;
}

/** El próximo umbral por encima de la altura dada, o null si ya los superó todos. */
export function proximoUmbral(alturaM: number): Umbral | null {
  return UMBRALES.find((umbral) => alturaM < umbral.alturaM) ?? null;
}
