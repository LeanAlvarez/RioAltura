/**
 * Qué tiene que hacer un vecino en cada nivel de aviso, y a quién llamar.
 *
 * ESTÁ APAGADO A PROPÓSITO. `QUE_HACER_HABILITADO` queda en `false` hasta que
 * la Municipalidad de Colón confirme los textos y los teléfonos. Publicar un
 * número de emergencia equivocado es peor que no publicar ninguno, así que
 * `TELEFONOS` va vacío: no se inventan números (CLAUDE.md §9).
 *
 * Para habilitarlo: que la Municipalidad confirme por escrito cada texto y
 * cada teléfono, cargarlos acá, y recién entonces poner el flag en `true`.
 */
export const QUE_HACER_HABILITADO = false;

export interface Telefono {
  /** Cómo se muestra el contacto, por ejemplo "Defensa Civil". */
  nombre: string;
  /** PENDIENTE: lo confirma la Municipalidad. */
  numero: string;
}

export interface IndicacionNivel {
  /** Coincide con el nivel de aviso que ya calcula el backend. */
  nivel: "sin_aviso" | "atencion" | "alerta_probable";
  titulo: string;
  pasos: readonly string[];
}

/** PENDIENTE DE CONFIRMACIÓN MUNICIPAL. Vacío a propósito: ver arriba. */
export const TELEFONOS: readonly Telefono[] = [];

/** PENDIENTE DE CONFIRMACIÓN MUNICIPAL. Vacío a propósito: ver arriba. */
export const INDICACIONES: readonly IndicacionNivel[] = [];
