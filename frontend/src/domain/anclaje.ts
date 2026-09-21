import type { Anclaje } from "../api/types";

/**
 * Texto accesible para el anclaje del pronóstico (spec 007, C2). El rango
 * siempre se muestra como rango (CLAUDE.md §5, §9); esto es solo la
 * explicación de una frase de por qué se movió respecto de la curva.
 */
export function describeAnclaje(anclaje: Anclaje): string | null {
  if (!anclaje.aplicado) return null;
  return "El pronóstico está ajustado con la medición de hoy en el puerto.";
}
