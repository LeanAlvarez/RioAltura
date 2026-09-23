/**
 * Persistencia del punto de "Mi casa" (spec 015, C3): sólo en el navegador,
 * mismo patrón que `theme.ts` -- interfaz `StorageLike` inyectable, funciones
 * puras con `try/catch` que nunca tiran. Si `localStorage` falla (ventana
 * privada, cuota llena, cookies bloqueadas) o se limpia, la app sigue
 * funcionando: el vecino simplemente vuelve a marcar el punto.
 *
 * Nunca se guarda nada en el servidor (C2/fuera de alcance de la spec): esto
 * es estrictamente `window.localStorage` del dispositivo.
 */

import type { PuntoMapa } from "./domain/miCasa";

const STORAGE_KEY = "rioaltura-mi-casa";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function esPuntoMapa(value: unknown): value is PuntoMapa {
  return (
    isRecord(value) &&
    typeof value.lat === "number" &&
    typeof value.lng === "number" &&
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng)
  );
}

/** Pure-ish: lee el punto guardado. Nunca lanza: si `storage` falla o el dato no es válido, da null. */
export function leerPuntoGuardado(storage: StorageLike): PuntoMapa | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return esPuntoMapa(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Pure-ish: guarda el punto elegido. Nunca lanza: si `storage` falla, no hace nada (C3). */
export function guardarPunto(punto: PuntoMapa, storage: StorageLike): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(punto));
  } catch {
    // Ventana privada, cookies bloqueadas, cuota llena: el punto no
    // persiste, pero el vecino puede volver a marcarlo (C3).
  }
}
