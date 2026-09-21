import { describe, expect, it } from "vitest";
import type { AlturaDiaria, ErrorPronostico, HistoricoDia } from "../api/types";
import { buildPrecisionSeries, calcularRangoPrecision, describeErrorPronostico } from "./precision";

describe("calcularRangoPrecision", () => {
  it("resta la cantidad de días pedida a partir de hoy", () => {
    const hoy = new Date(2026, 8, 21);
    expect(calcularRangoPrecision(hoy, 90)).toEqual({ desde: "2026-06-23", hasta: "2026-09-21" });
  });
});

describe("buildPrecisionSeries", () => {
  it("alinea altura real y pronóstico histórico por fecha, con null donde falta un dato", () => {
    const alturas: AlturaDiaria[] = [
      { fecha: "2026-09-19", altura_m: 3.4 },
      { fecha: "2026-09-20", altura_m: 3.5 },
    ];
    const historico: HistoricoDia[] = [
      { fecha: "2026-09-19", caudal_m3s: 5000, altura_est_m: 3.1, extrapolado: false },
      { fecha: "2026-09-21", caudal_m3s: 5200, altura_est_m: 3.6, extrapolado: false },
    ];
    const series = buildPrecisionSeries(alturas, historico);
    expect(series.x).toHaveLength(3);
    expect(series.real).toEqual([3.4, 3.5, null]);
    expect(series.pronosticado).toEqual([3.1, null, 3.6]);
  });
});

describe("describeErrorPronostico", () => {
  it("da la frase con el error promedio cuando hay muestras", () => {
    const error: ErrorPronostico = { lead_dias: 3, muestras: 775, mae_m: 0.5 };
    const texto = describeErrorPronostico(error);
    expect(texto).toContain("±0,50 m");
    expect(texto).toContain("775");
  });

  it("avisa cuando no hay suficientes muestras", () => {
    const error: ErrorPronostico = { lead_dias: 3, muestras: 0, mae_m: null };
    expect(describeErrorPronostico(error)).toMatch(/no hay suficientes/i);
  });
});
