import { describe, expect, it } from "vitest";
import type { DiaPronostico, PronosticoAguasArriba } from "../api/types";
import { buildAguasArribaChartSeries, deriveAguasArribaView } from "./aguasArriba";

function dia(overrides: Partial<DiaPronostico> = {}): DiaPronostico {
  return {
    fecha: "2026-09-22",
    lead_dias: 1,
    caudal_m3s: 5000,
    altura_est_m: 5.0,
    altura_min_m: 4.0,
    altura_max_m: 6.0,
    altura_anclada_m: 5.0,
    altura_anclada_min_m: 4.0,
    altura_anclada_max_m: 6.0,
    extrapolado: false,
    ...overrides,
  };
}

function pronostico(dias: DiaPronostico[]): PronosticoAguasArriba {
  return { emitido: "2026-09-21T08:00:00Z", gauge_id: "hybas_6120865460", dias };
}

describe("deriveAguasArribaView", () => {
  it("maneja carga, no disponible y error de forma independiente", () => {
    expect(deriveAguasArribaView({ kind: "loading" })).toEqual({ kind: "loading" });
    expect(deriveAguasArribaView({ kind: "unavailable" })).toEqual({ kind: "unavailable" });
    expect(deriveAguasArribaView({ kind: "error" })).toEqual({ kind: "error" });
  });

  it("arma la frase con el rango del último día y explica el desfasaje", () => {
    const view = deriveAguasArribaView({
      kind: "ok",
      data: pronostico([
        dia({ fecha: "2026-09-22", lead_dias: 1, altura_anclada_m: 5.0 }),
        dia({ fecha: "2026-09-28", lead_dias: 7, altura_anclada_m: 6.2, altura_anclada_min_m: 5.2, altura_anclada_max_m: 7.2 }),
      ]),
    });
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.frase).toMatch(/entre 5,2 y 7,2 m/);
    expect(view.frase).toContain("llega a Colón");
    expect(view.tendencia).toBe("sube");
  });
});

describe("buildAguasArribaChartSeries", () => {
  it("alinea Colón y aguas arriba por fecha, con un eje x único y ordenado", () => {
    const colon = [dia({ fecha: "2026-09-22", altura_anclada_m: 4.5 }), dia({ fecha: "2026-09-23", altura_anclada_m: 4.8 })];
    const aguasArriba = [dia({ fecha: "2026-09-23", altura_anclada_m: 3.9 }), dia({ fecha: "2026-09-24", altura_anclada_m: 4.1 })];

    const series = buildAguasArribaChartSeries(colon, aguasArriba);

    expect(series.x).toHaveLength(3);
    expect([...series.x].sort((a, b) => a - b)).toEqual(series.x);
    expect(series.colon).toEqual([4.5, 4.8, null]);
    expect(series.aguasArriba).toEqual([null, 3.9, 4.1]);
  });

  it("funciona con una sola serie o ninguna, sin romper", () => {
    const colon = [dia({ fecha: "2026-09-22", altura_anclada_m: 4.5 })];
    expect(buildAguasArribaChartSeries(colon, null)).toEqual({ x: expect.any(Array), colon: [4.5], aguasArriba: [null] });
    expect(buildAguasArribaChartSeries(null, null)).toEqual({ x: [], colon: [], aguasArriba: [] });
  });
});
