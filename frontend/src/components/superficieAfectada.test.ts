import { describe, expect, it } from "vitest";
import type { CapaIndex } from "../capas";
import {
  buildCurvaPuntos,
  describeSuperficie,
  escalarCurva,
  margenEjeY,
  xParaAltura,
} from "./superficieAfectada";

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

describe("xParaAltura", () => {
  it("0 en el mínimo y width en el máximo (G5, marca de máximo observado)", () => {
    expect(xParaAltura(3, 3, 13, 100)).toBe(0);
    expect(xParaAltura(13, 3, 13, 100)).toBe(100);
  });

  it("interpola linealmente en el medio", () => {
    expect(xParaAltura(8, 3, 13, 100)).toBe(50);
  });

  it("no divide por cero cuando el rango es 0", () => {
    expect(xParaAltura(5, 5, 5, 100)).toBe(0);
  });
});

describe("margenEjeY", () => {
  it("crece con la etiqueta más larga en vez de quedar fijo", () => {
    // El bug real: con margen fijo de 58 px, "26.094 ha" se dibujaba cortado
    // y se leía "6.094 ha" — 20.000 hectáreas de diferencia.
    const conRangoViejo = margenEjeY(["14.613 ha", "66 ha"]);
    const conRangoNuevo = margenEjeY(["26.094 ha", "66 ha"]);
    expect(conRangoNuevo).toBeGreaterThanOrEqual(conRangoViejo);
    expect(conRangoNuevo).toBeGreaterThan(58);
  });

  it("deja lugar para la etiqueta entera, no sólo para parte", () => {
    const etiqueta = "26.094 ha";
    // 13 px de fuente por 0,62 em de ancho por carácter, más la holgura.
    expect(margenEjeY([etiqueta])).toBeGreaterThan(etiqueta.length * 13 * 0.6);
  });

  it("no se achica por debajo de la etiqueta más corta", () => {
    expect(margenEjeY(["66 ha"])).toBeGreaterThan(0);
  });
});
