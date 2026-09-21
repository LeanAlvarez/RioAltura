import { describe, expect, it } from "vitest";
import type { CapaIndex } from "../capas";
import { buildCurvaPuntos, describeSuperficie, escalarCurva } from "./superficieAfectada";

function index(overrides: Partial<CapaIndex> = {}): CapaIndex {
  return {
    generado: "2026-09-21T18:45:08Z",
    fuente_dem: "Copernicus DEM GLO-30",
    licencia_dem: "Copernicus DEM",
    cero_ign: -0.26,
    bbox: [-58.25, -32.35, -58.0, -32.1],
    nivel_min: 3.0,
    nivel_max: 13.0,
    paso: { hasta_1050: 0.25, sobre_1050: 0.5 },
    clases: [{ clase: 1, etiqueta: "Baja" }],
    capas: [
      { h: 3.0, archivo: "h_0300.geojson", hectareas: 100, bytes: 10, toca_borde: false, bordes: { norte: false, sur: false, este: false, oeste: false } },
      { h: 5.0, archivo: "h_0500.geojson", hectareas: 400, bytes: 10, toca_borde: false, bordes: { norte: false, sur: false, este: false, oeste: false } },
      { h: 8.0, archivo: "h_0800.geojson", hectareas: 900, bytes: 10, toca_borde: false, bordes: { norte: false, sur: false, este: false, oeste: false } },
    ],
    ...overrides,
  };
}

describe("buildCurvaPuntos", () => {
  it("extrae altura y hectáreas de cada capa, en orden", () => {
    expect(buildCurvaPuntos(index())).toEqual([
      { h: 3.0, hectareas: 100 },
      { h: 5.0, hectareas: 400 },
      { h: 8.0, hectareas: 900 },
    ]);
  });
});

describe("escalarCurva", () => {
  it("escala al viewBox pedido, con y invertido (más hectáreas = más arriba)", () => {
    const puntos = buildCurvaPuntos(index());
    const escalados = escalarCurva(puntos, 100, 50);
    expect(escalados).toHaveLength(3);
    expect(escalados[0]).toEqual({ x: 0, y: 50 }); // menor altura, menos hectáreas -> abajo
    expect(escalados[2]).toEqual({ x: 100, y: 0 }); // mayor altura, más hectáreas -> arriba
  });

  it("no divide por cero cuando hay un único punto", () => {
    expect(escalarCurva([{ h: 5, hectareas: 100 }], 100, 50)).toEqual([{ x: 0, y: 50 }]);
  });

  it("devuelve vacío sin puntos", () => {
    expect(escalarCurva([], 100, 50)).toEqual([]);
  });
});

describe("describeSuperficie", () => {
  it("da la frase con la altura y hectáreas del nivel más cercano", () => {
    const texto = describeSuperficie(index(), 5.0);
    expect(texto).toContain("5,00 m");
    expect(texto).toContain("400 ha");
    expect(texto).toMatch(/^Si el río llega a/);
  });
});
