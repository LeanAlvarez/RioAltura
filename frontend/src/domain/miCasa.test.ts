import { describe, expect, it } from "vitest";
import type { CapaCache, CapaEntry, CapaFeatureCollection, CapaIndex } from "../capas";
import { DISCLAIMER_MI_CASA, buscarAlturaInundacion, deriveMiCasaView, type PuntoMapa } from "./miCasa";

/** Mismo fixture que capas.test.ts: 43 capas, 3,00 a 13,00 m (ver ese archivo). */
function buildIndex(): CapaIndex {
  const capas: CapaEntry[] = [];
  let hectareas = 500;

  function push(h: number): void {
    const codigo = Math.round(h * 100)
      .toString()
      .padStart(4, "0");
    capas.push({
      h,
      archivo: `h_${codigo}.geojson`,
      hectareas,
      bytes: 10_000,
      toca_borde: false,
      bordes: { norte: false, sur: false, oeste: false, este: false },
    });
    hectareas += 20;
  }

  for (let i = 0; i <= 30; i++) {
    push(Math.round((3.0 + i * 0.25) * 100) / 100);
  }
  for (let i = 1; i <= 5; i++) {
    push(Math.round((10.5 + i * 0.5) * 100) / 100);
  }

  return {
    generado: "2026-09-21T18:23:07Z",
    fuente_dem: "Copernicus DEM GLO-30 (test fixture)",
    licencia_dem: "Copernicus DEM (test fixture)",
    cero_ign: -0.26,
    bbox: [-100, -100, 100, 100],
    nivel_min: 3.0,
    nivel_max: 13.0,
    paso: { hasta_1050: 0.25, sobre_1050: 0.5 },
    clases: [
      { clase: 1, etiqueta: "hasta 0,5 m" },
      { clase: 2, etiqueta: "0,5 a 1,5 m" },
      { clase: 3, etiqueta: "más de 1,5 m" },
    ],
    capas,
  };
}

const PUNTO: PuntoMapa = { lat: 50, lng: 50 };

/**
 * Capa cache falso: cada entrada moja `PUNTO` sí o sólo si `entry.h >=
 * umbral`, simulando capas anidadas (monótonas). Cuenta cuántas veces se
 * pidió cada archivo, para poder verificar el presupuesto de consultas (C2:
 * ~6, no 43).
 */
function buildCache(umbral: number | null): { cache: CapaCache; pedidos: string[] } {
  const pedidos: string[] = [];
  const cache: CapaCache = {
    has: () => false,
    get(entry: CapaEntry): Promise<CapaFeatureCollection> {
      pedidos.push(entry.archivo);
      const moja = umbral !== null && entry.h >= umbral;
      const exterior = moja
        ? ([
            [-1000, -1000],
            [1000, -1000],
            [1000, 1000],
            [-1000, 1000],
            [-1000, -1000],
          ] as const)
        : ([
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
            [-1, -1],
          ] as const);
      return Promise.resolve({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { clase: 1, profundidad: "" },
            geometry: { type: "Polygon", coordinates: [exterior] },
          },
        ],
      });
    },
  };
  return { cache, pedidos };
}

describe("buscarAlturaInundacion", () => {
  it("fuera del área modelada: no consulta ninguna capa (chequeo de bbox, sin red)", async () => {
    const index = buildIndex();
    const { cache, pedidos } = buildCache(7.0);
    const resultado = await buscarAlturaInundacion(index, cache, { lat: -32.5, lng: -500 });
    expect(resultado).toEqual({ kind: "fuera-de-area" });
    expect(pedidos).toHaveLength(0);
  });

  it("encuentra la altura con una búsqueda binaria, en ~6 consultas sobre 43 capas", async () => {
    const index = buildIndex();
    // Umbral 7.00 cae exactamente en una capa del fixture (i=16: 3 + 16*0.25).
    const { cache, pedidos } = buildCache(7.0);
    const resultado = await buscarAlturaInundacion(index, cache, PUNTO);
    expect(resultado).toEqual({ kind: "encontrado", alturaM: 7.0 });
    expect(pedidos.length).toBeLessThanOrEqual(6);
    expect(pedidos.length).toBeGreaterThan(0);
    // Sin duplicados: cada consulta de la búsqueda binaria pide una capa distinta.
    expect(new Set(pedidos).size).toBe(pedidos.length);
  });

  it("ya bajo agua a la altura mínima modelada (nivel_min)", async () => {
    const index = buildIndex();
    const { cache } = buildCache(0); // todas las capas mojan el punto
    const resultado = await buscarAlturaInundacion(index, cache, PUNTO);
    expect(resultado).toEqual({ kind: "ya-inundado", alturaM: 3.0 });
  });

  it("seco ni con el río en la altura máxima modelada (nivel_max)", async () => {
    const index = buildIndex();
    const { cache } = buildCache(null); // ninguna capa moja el punto
    const resultado = await buscarAlturaInundacion(index, cache, PUNTO);
    expect(resultado).toEqual({ kind: "seco", alturaMaximaModeladaM: 13.0 });
  });

  it("la altura devuelta es exactamente la de la capa encontrada (ya redondeada al escalón, sin math extra)", async () => {
    const index = buildIndex();
    const { cache } = buildCache(9.75);
    const resultado = await buscarAlturaInundacion(index, cache, PUNTO);
    expect(resultado.kind).toBe("encontrado");
    if (resultado.kind === "encontrado") {
      expect(index.capas.some((c) => c.h === resultado.alturaM)).toBe(true);
      expect(resultado.alturaM).toBe(9.75);
    }
  });
});

describe("deriveMiCasaView", () => {
  it("sin-punto y calculando dan un texto pero ningún dato numérico", () => {
    expect(deriveMiCasaView({ kind: "sin-punto" }).kind).toBe("sin-punto");
    expect(deriveMiCasaView({ kind: "calculando" }).kind).toBe("calculando");
  });

  it("error da un mensaje claro para reintentar", () => {
    const view = deriveMiCasaView({ kind: "error" });
    expect(view.kind).toBe("error");
    expect(view.mensaje.length).toBeGreaterThan(0);
  });

  it("fuera-de-area", () => {
    const view = deriveMiCasaView({ kind: "fuera-de-area" });
    expect(view).toEqual({
      kind: "fuera-de-area",
      mensaje: "Ese punto queda fuera del área que mapeamos. No podemos calcular a qué altura se moja.",
    });
  });

  it("ya-inundado formatea la altura con coma decimal (es-AR)", () => {
    const view = deriveMiCasaView({ kind: "ya-inundado", alturaM: 3.0 });
    expect(view.kind).toBe("ya-inundado");
    if (view.kind === "ya-inundado") {
      expect(view.altura).toBe("3,00 m");
      expect(view.mensaje).toContain("3,00 m");
      expect(view.mensaje).toContain("nivel habitual");
    }
  });

  it("seco no sugiere que sea imposible que se inunde", () => {
    const view = deriveMiCasaView({ kind: "seco", alturaMaximaModeladaM: 20.0 });
    expect(view.kind).toBe("seco");
    if (view.kind === "seco") {
      expect(view.alturaMaximaModelada).toBe("20,00 m");
      expect(view.mensaje).not.toMatch(/nunca|imposible|jamás/i);
      expect(view.mensaje).toContain("no una garantía");
    }
  });

  it("encontrado da la altura redondeada, formateada", () => {
    const view = deriveMiCasaView({ kind: "encontrado", alturaM: 7.4 });
    expect(view.kind).toBe("encontrado");
    if (view.kind === "encontrado") {
      expect(view.altura).toBe("7,40 m");
      expect(view.mensaje).toBe("Ese punto se moja cuando el río llega a los 7,40 m.");
    }
  });
});

describe("DISCLAIMER_MI_CASA", () => {
  it("es el texto exacto de la spec 015, sección C5", () => {
    expect(DISCLAIMER_MI_CASA).toBe(
      "Es un cálculo aproximado, no una medición de tu casa. Usa una imagen satelital de 30 metros " +
        "que incluye techos y árboles, y no conoce el umbral de tu puerta, el nivel del piso, las " +
        "defensas ni los desagües. Puede errar por metros. Ante una crecida, seguí a Prefectura y a " +
        "Defensa Civil.",
    );
  });
});
