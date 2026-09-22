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
  /**
   * Marca MOP de "Crecida Máxima Observada" (informe INA-CARU 2019), la
   * agrega `geoprocessing/` (spec 008, en paralelo). Opcional para no romper
   * índices/fixtures viejos que todavía no la traen: por eso nunca se
   * hardcodea un "10,00" en la UI (CLAUDE.md §5) — si no está, simplemente no
   * se dibuja la marca (ver `components/superficieAfectada.ts`, G5).
   */
  crecida_maxima_observada_m?: number;
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
    value.capas.every(isCapaEntry) &&
    (value.crecida_maxima_observada_m === undefined || typeof value.crecida_maxima_observada_m === "number")
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

/**
 * Pure: el texto siempre visible "Mostrando: ..." del mapa (defecto G3,
 * revisión de diseño). Antes decía "si el río llega a 4,25 m — hoy está en
 * 4,29 m" sin explicar por qué esos dos números tan parecidos no coinciden —
 * se leía como un error. La razón: las capas van de 0,25 en 0,25 m
 * (`index.json.paso`), así que lo que se dibuja es la altura disponible más
 * cercana a la pedida, no la exacta (`vista.textos.mostrando` es no-null
 * justo en ese caso). Cuando no hubo que redondear, sigue el texto
 * original. No DOM (ver `map.ts`, que solo la usa para pintar un `<p>`).
 */
export function describeMostrando(vista: VistaMapa): string {
  const altura = vista.textos.altura;
  if (altura === null) return "Elegí un escenario para ver las zonas inundables.";
  const actual = vista.textos.actual;

  // Dos situaciones distintas que antes compartían el mismo texto: el mapa
  // redondeó la altura de hoy al escalón más cercano, o el usuario eligió a
  // propósito un escenario muy por encima. Decirle "la altura más parecida
  // que tenemos (17,00 m)" a quien acaba de arrastrar el slider a 17 m no
  // tiene sentido: 17 m no se parece a nada de hoy, es lo que pidió ver.
  const mostrado = vista.resuelto?.mostrado ?? null;
  const esEscenarioElegido =
    mostrado !== null && vista.alturaActualM !== null && Math.abs(mostrado - vista.alturaActualM) > 1;

  if (esEscenarioElegido) {
    const base = `Estás viendo un escenario: si el río llegara a ${altura}.`;
    return actual === null ? base : `${base} Hoy está en ${actual}.`;
  }
  if (vista.textos.mostrando !== null) {
    const base = `El mapa muestra la altura más parecida que tenemos (${altura}).`;
    return actual === null ? base : `${base} Hoy el río está en ${actual}.`;
  }
  if (actual === null) return `Mostrando: si el río llega a ${altura}.`;
  if (actual === altura) return `Mostrando la altura de hoy: ${altura}.`;
  return `Mostrando: si el río llega a ${altura} — hoy está en ${actual}.`;
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
  /** null mientras no haya medición ni elección del usuario: el mapa va sin capa. */
  seleccion: number | null;
  /** Altura real medida hoy, en metros, para comparar contra lo que se muestra. */
  alturaActualM: number | null;
  resuelto: ResolvedNivel | null;
  escenarios: Escenario[];
  textos: {
    altura: string | null;
    cota: string | null;
    hectareas: string | null;
    mostrando: string | null;
    fueraDeRango: string | null;
    /** "Última medición: ..." cuando el dato real no es reciente. */
    medicion: string | null;
    /** Texto que reemplaza la lectura cuando no hay ninguna capa elegida. */
    sinSeleccion: string | null;
    /**
     * Altura real medida hoy, formateada (o null hasta que llegue). Spec
     * 007, correcciones de diseño ítem 3: el resumen siempre visible del
     * mapa ("Mostrando: ... — hoy está en ...") la necesita fuera del panel
     * colapsable.
     */
    actual: string | null;
  };
}

/** Cuándo se midió la altura real, para rotular el arranque del mapa. */
export interface MedicionActual {
  alturaM: number;
  fechaHora: string;
  reciente: boolean;
}

export interface EstadoMapa {
  setNivelActual(medicion: MedicionActual): void;
  setNivelPronosticado(h: number): void;
  seleccionar(h: number, opts: { porUsuario: boolean }): void;
  escenarios(): Escenario[];
  subscribe(listener: (vista: VistaMapa) => void): () => void;
}

/**
 * Reference height used only when a scenario button needs a default; the map
 * itself no longer opens on a fixed level (see `createEstadoMapa`).
 */
export const SELECCION_INICIAL = 4.44;

/**
 * The map opens on the height the river is at TODAY, never on a forecast
 * (spec 007, decisión del usuario tras la revisión de diseño; reemplaza el
 * M3 original). Mostrar primero el peor caso hacía que un vecino viera agua
 * sobre su barrio y creyera que era la situación actual. Si no hay medición
 * reciente se usa la última guardada, rotulada con su fecha, y si no hay
 * ninguna el mapa abre sin capa: nunca se cae al pronóstico.
 */
export function createEstadoMapa(index: CapaIndex): EstadoMapa {
  let medicionActual: MedicionActual | null = null;
  let nivelPronosticado: number | null = null;
  let seleccion: number | null = null;
  let tocadoPorUsuario = false;

  const listeners = new Set<(vista: VistaMapa) => void>();

  function construirEscenarios(): Escenario[] {
    return [
      {
        id: "hoy",
        etiqueta: "Hoy",
        h: medicionActual?.alturaM ?? null,
        habilitado: medicionActual !== null,
      },
      {
        id: "pronostico",
        // Jerga (revisión de diseño): "máx." es una abreviatura técnica que
        // no dice a qué se refiere sin contexto.
        etiqueta: "Lo más alto del pronóstico",
        h: nivelPronosticado,
        habilitado: nivelPronosticado !== null,
      },
      { id: "costanera", etiqueta: "4,44 costanera jul 2026", h: 4.44, habilitado: true },
      { id: "evacuacion_seco", etiqueta: "6,80 evacuación en seco", h: 6.8, habilitado: true },
      { id: "alerta", etiqueta: "7,10 alerta", h: 7.1, habilitado: true },
      { id: "crecida_2025", etiqueta: "7,60 crecida jun 2025", h: 7.6, habilitado: true },
      { id: "evacuacion", etiqueta: "7,90 evacuación", h: 7.9, habilitado: true },
      { id: "crecida_2019", etiqueta: "8,87 ene 2019", h: 8.87, habilitado: true },
      { id: "maximo_2024", etiqueta: "9,06 máx. may 2024", h: 9.06, habilitado: true },
    ];
  }

  function vistaActual(): VistaMapa {
    if (seleccion === null) {
      // No measurement yet and the user has not picked anything: show the map
      // with no layer rather than guessing a height.
      return {
        seleccion: null,
        alturaActualM: medicionActual?.alturaM ?? null,
        resuelto: null,
        escenarios: construirEscenarios(),
        textos: {
          altura: null,
          cota: null,
          hectareas: null,
          mostrando: null,
          fueraDeRango: null,
          actual: null,
          medicion: null,
          sinSeleccion: "Elegí un escenario para ver las zonas inundables",
        },
      };
    }
    const resuelto = resolveNivel(index, seleccion);
    return {
      seleccion,
      alturaActualM: medicionActual?.alturaM ?? null,
      resuelto,
      escenarios: construirEscenarios(),
      textos: {
        altura: formatAltura(resuelto.mostrado),
        cota: formatCota(resuelto.mostrado, index.cero_ign),
        hectareas: formatHectareas(resuelto.entry.hectareas),
        mostrando: resuelto.redondeado ? textoMostrando(resuelto.mostrado, seleccion) : null,
        fueraDeRango: resuelto.fueraDeRango === "arriba" ? avisoFueraDeRango(index) : null,
        actual: medicionActual === null ? null : formatAltura(medicionActual.alturaM),
        medicion:
          medicionActual === null || medicionActual.reciente
            ? null
            : `Última medición: ${medicionActual.fechaHora}`,
        sinSeleccion: null,
      },
    };
  }

  function notify(): void {
    const vista = vistaActual();
    for (const listener of listeners) listener(vista);
  }

  return {
    setNivelActual(medicion) {
      medicionActual = medicion;
      // The measured height is what the map opens on, until the user takes
      // control with the slider or a scenario button.
      if (!tocadoPorUsuario) {
        seleccion = medicion.alturaM;
      }
      notify();
    },
    setNivelPronosticado(h) {
      // Only enables the "Pronóstico máx." button. It must never move the map
      // on its own: a forecast shown where the user expects a measurement is
      // read as the current situation.
      nivelPronosticado = h;
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
