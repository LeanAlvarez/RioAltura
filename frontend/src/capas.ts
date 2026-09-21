// Pure, DOM-free data and state for the flood-layer module. See specs/006-mapa-inundacion.md.
// map.ts is the thin Leaflet/DOM layer that consumes this module.

// --- index.json contract -----------------------------------------------------
// Field names are the public contract with geoprocessing/generar_capas.py and stay
// in Spanish on purpose (they are the JSON wire format, not internal identifiers).

export interface ClaseInfo {
  clase: 1 | 2 | 3;
  etiqueta: string;
}

export interface CapaBordes {
  norte: boolean;
  sur: boolean;
  oeste: boolean;
  este: boolean;
}

export interface CapaEntry {
  h: number;
  archivo: string;
  hectareas: number;
  bytes: number;
  toca_borde: boolean;
  bordes: CapaBordes;
}

export interface CapaIndex {
  generado: string;
  fuente_dem: string;
  licencia_dem: string;
  cero_ign: number;
  bbox: [number, number, number, number];
  nivel_min: number;
  nivel_max: number;
  paso: { hasta_1050: number; sobre_1050: number };
  clases: ClaseInfo[];
  capas: CapaEntry[];
}

/**
 * Minimal, structurally-compatible GeoJSON FeatureCollection shape.
 *
 * Decision: the brief asked for `GeoJSON.FeatureCollection` (the global namespace
 * from the "geojson" package). That package is only a transitive type dependency
 * of @types/leaflet here, and pnpm's strict node_modules layout does not hoist it
 * for this package, so `import ... from "geojson"` does not resolve from src/ and
 * the global `GeoJSON` namespace is unavailable without adding a new dependency
 * (the brief forbids new dependencies). This local type carries exactly what the
 * flood layers need (`properties.clase`, `properties.profundidad`) and is cast at
 * the Leaflet boundary in map.ts, where L.geoJSON's own (real) GeoJSON types live.
 */
export interface CapaFeature {
  type: "Feature";
  properties: {
    clase: 1 | 2 | 3;
    profundidad: string;
    [key: string]: unknown;
  };
  geometry: {
    type: string;
    coordinates: unknown;
  };
}

export interface CapaFeatureCollection {
  type: "FeatureCollection";
  features: CapaFeature[];
}

// --- Type guards ---------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isClaseInfo(value: unknown): value is ClaseInfo {
  if (!isRecord(value)) return false;
  return (
    (value.clase === 1 || value.clase === 2 || value.clase === 3) && typeof value.etiqueta === "string"
  );
}

function isCapaBordes(value: unknown): value is CapaBordes {
  if (!isRecord(value)) return false;
  return (
    typeof value.norte === "boolean" &&
    typeof value.sur === "boolean" &&
    typeof value.oeste === "boolean" &&
    typeof value.este === "boolean"
  );
}

function isCapaEntry(value: unknown): value is CapaEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.h === "number" &&
    typeof value.archivo === "string" &&
    typeof value.hectareas === "number" &&
    typeof value.bytes === "number" &&
    typeof value.toca_borde === "boolean" &&
    isCapaBordes(value.bordes)
  );
}

export function isCapaIndex(value: unknown): value is CapaIndex {
  if (!isRecord(value)) return false;
  const paso = value.paso;
  return (
    typeof value.generado === "string" &&
    typeof value.fuente_dem === "string" &&
    typeof value.licencia_dem === "string" &&
    typeof value.cero_ign === "number" &&
    Array.isArray(value.bbox) &&
    value.bbox.length === 4 &&
    value.bbox.every((n) => typeof n === "number") &&
    typeof value.nivel_min === "number" &&
    typeof value.nivel_max === "number" &&
    isRecord(paso) &&
    typeof paso.hasta_1050 === "number" &&
    typeof paso.sobre_1050 === "number" &&
    Array.isArray(value.clases) &&
    value.clases.every(isClaseInfo) &&
    Array.isArray(value.capas) &&
    value.capas.length > 0 &&
    value.capas.every(isCapaEntry)
  );
}

// --- Loading ---------------------------------------------------------------

export class CapaIndexError extends Error {}

/**
 * Fetches and validates index.json. Decision: throws (CapaIndexError) rather than
 * returning a typed error union, matching the exception-based style map.ts already
 * needs for its own fetch/catch flow (see fetchHealth in api.ts for the alternate,
 * result-typed style used where no separate error box is needed).
 */
export async function fetchCapaIndex(fetchFn: typeof fetch = fetch, base = "/capas"): Promise<CapaIndex> {
  const response = await fetchFn(`${base}/index.json`, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new CapaIndexError(`index.json respondió ${String(response.status)}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CapaIndexError("index.json no es JSON válido");
  }
  if (!isCapaIndex(body)) {
    throw new CapaIndexError("index.json no cumple el contrato esperado");
  }
  return body;
}

// --- In-memory cache with in-flight de-duplication --------------------------

export interface CapaCache {
  get(entry: CapaEntry): Promise<CapaFeatureCollection>;
  has(entry: CapaEntry): boolean;
}

export function createCapaCache(fetchFn: typeof fetch = fetch, base = "/capas"): CapaCache {
  const cache = new Map<string, CapaFeatureCollection>();
  const inFlight = new Map<string, Promise<CapaFeatureCollection>>();

  async function load(entry: CapaEntry): Promise<CapaFeatureCollection> {
    const response = await fetchFn(`${base}/${entry.archivo}`, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`no se pudo cargar ${entry.archivo}: ${String(response.status)}`);
    }
    const body = (await response.json()) as CapaFeatureCollection;
    cache.set(entry.archivo, body);
    return body;
  }

  return {
    has(entry) {
      return cache.has(entry.archivo);
    },
    get(entry) {
      const cached = cache.get(entry.archivo);
      if (cached) return Promise.resolve(cached);
      const pending = inFlight.get(entry.archivo);
      if (pending) return pending;
      const promise = load(entry).finally(() => inFlight.delete(entry.archivo));
      inFlight.set(entry.archivo, promise);
      return promise;
    },
  };
}

// --- Level resolution ---------------------------------------------------------

export interface ResolvedNivel {
  entry: CapaEntry;
  mostrado: number;
  redondeado: boolean;
  fueraDeRango: "arriba" | "abajo" | null;
}

/**
 * Picks the nearest available layer to `requested`. Non-finite input (NaN,
 * +/-Infinity) never throws: it resolves to the minimum layer with
 * `fueraDeRango: null` and `redondeado: false`, so callers (the slider) can never
 * get into an unrenderable state from a stray invalid number.
 */
export function resolveNivel(index: CapaIndex, requested: number): ResolvedNivel {
  const capas = index.capas;
  const first = capas[0];
  const last = capas[capas.length - 1];
  if (!first || !last) {
    throw new Error("index sin capas");
  }

  if (!Number.isFinite(requested)) {
    return { entry: first, mostrado: first.h, redondeado: false, fueraDeRango: null };
  }
  if (requested > index.nivel_max) {
    return { entry: last, mostrado: last.h, redondeado: false, fueraDeRango: "arriba" };
  }
  if (requested < index.nivel_min) {
    return { entry: first, mostrado: first.h, redondeado: false, fueraDeRango: "abajo" };
  }

  // capas is sorted ascending by h (index.json contract). Ties go up: on an equal
  // distance, a later (higher h) entry replaces the current pick.
  let nearest = first;
  let nearestDiff = Math.abs(first.h - requested);
  for (const entry of capas) {
    const diff = Math.abs(entry.h - requested);
    if (diff < nearestDiff || (diff === nearestDiff && entry.h > nearest.h)) {
      nearest = entry;
      nearestDiff = diff;
    }
  }

  return {
    entry: nearest,
    mostrado: nearest.h,
    redondeado: requested !== nearest.h,
    fueraDeRango: null,
  };
}

// --- Formatting (es-AR, decimal comma) -----------------------------------------

const alturaFormatter = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const enteroFormatter = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

export function formatAltura(h: number): string {
  return `${alturaFormatter.format(h)} m`;
}

export function formatCota(h: number, ceroIgn: number): string {
  return `${alturaFormatter.format(h + ceroIgn)} m IGN`;
}

export function formatHectareas(ha: number): string {
  return `${enteroFormatter.format(ha)} ha`;
}

export function avisoFueraDeRango(index: CapaIndex): string {
  return `Altura por encima del rango modelado (${enteroFormatter.format(index.nivel_max)} m). La inundación real sería mayor.`;
}

export function textoMostrando(mostrado: number, requested: number): string | null {
  if (mostrado === requested) return null;
  return `mostrando ${formatAltura(mostrado)}`;
}

// --- Scenario / container state machine ---------------------------------------

export interface Escenario {
  id: string;
  etiqueta: string;
  /** null while the underlying value (hoy/pronóstico) has not arrived yet. */
  h: number | null;
  habilitado: boolean;
}

export interface VistaMapa {
  seleccion: number;
  resuelto: ResolvedNivel;
  escenarios: Escenario[];
  textos: {
    altura: string;
    cota: string;
    hectareas: string;
    mostrando: string | null;
    fueraDeRango: string | null;
  };
}

export interface EstadoMapa {
  setNivelActual(h: number): void;
  setNivelPronosticado(h: number): void;
  seleccionar(h: number, opts: { porUsuario: boolean }): void;
  escenarios(): Escenario[];
  subscribe(listener: (vista: VistaMapa) => void): () => void;
}

/** Initial selection before any forecast arrives: the costanera reference (jul 2026). */
export const SELECCION_INICIAL = 4.44;

export function createEstadoMapa(index: CapaIndex): EstadoMapa {
  let nivelActual: number | null = null;
  let nivelPronosticado: number | null = null;
  let seleccion = SELECCION_INICIAL;
  let tocadoPorUsuario = false;

  const listeners = new Set<(vista: VistaMapa) => void>();

  function construirEscenarios(): Escenario[] {
    return [
      { id: "hoy", etiqueta: "Hoy", h: nivelActual, habilitado: nivelActual !== null },
      {
        id: "pronostico",
        etiqueta: "Pronóstico máx.",
        h: nivelPronosticado,
        habilitado: nivelPronosticado !== null,
      },
      { id: "costanera", etiqueta: "4,44 costanera jul 2026", h: 4.44, habilitado: true },
      { id: "evacuacion_seco", etiqueta: "6,80 evacuación en seco", h: 6.8, habilitado: true },
      { id: "alerta", etiqueta: "7,10 alerta", h: 7.1, habilitado: true },
      { id: "crecida_2025", etiqueta: "7,60 crecida jun 2025", h: 7.6, habilitado: true },
      { id: "evacuacion", etiqueta: "7,90 evacuación", h: 7.9, habilitado: true },
      { id: "maximo_2024", etiqueta: "9,06 máx. may 2024", h: 9.06, habilitado: true },
    ];
  }

  function vistaActual(): VistaMapa {
    const resuelto = resolveNivel(index, seleccion);
    return {
      seleccion,
      resuelto,
      escenarios: construirEscenarios(),
      textos: {
        altura: formatAltura(resuelto.mostrado),
        cota: formatCota(resuelto.mostrado, index.cero_ign),
        hectareas: formatHectareas(resuelto.entry.hectareas),
        mostrando: resuelto.redondeado ? textoMostrando(resuelto.mostrado, seleccion) : null,
        fueraDeRango: resuelto.fueraDeRango === "arriba" ? avisoFueraDeRango(index) : null,
      },
    };
  }

  function notify(): void {
    const vista = vistaActual();
    for (const listener of listeners) listener(vista);
  }

  return {
    setNivelActual(h) {
      // Never moves the map by itself: only enables the "Hoy" button.
      nivelActual = h;
      notify();
    },
    setNivelPronosticado(h) {
      nivelPronosticado = h;
      // Follows the forecast only until the user takes control (slider or a
      // scenario button); repeated calls before that keep tracking a later
      // forecast so the map reflects the most recent one on load.
      if (!tocadoPorUsuario) {
        seleccion = h;
      }
      notify();
    },
    seleccionar(h, { porUsuario }) {
      seleccion = h;
      if (porUsuario) tocadoPorUsuario = true;
      notify();
    },
    escenarios: construirEscenarios,
    subscribe(listener) {
      listeners.add(listener);
      listener(vistaActual());
      return () => listeners.delete(listener);
    },
  };
}
