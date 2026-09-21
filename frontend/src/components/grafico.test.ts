import { describe, expect, it } from "vitest";
import type { AlturaDiaria, DiaPronostico, HistoricoDia } from "../api/types";
import { buildChartSeries, buildResumenTexto, calcularRangoFechas } from "./grafico";

describe("calcularRangoFechas", () => {
  it("resta la cantidad de días pedida a partir de hoy", () => {
    const hoy = new Date(2026, 8, 21); // 21 sep 2026, local
    expect(calcularRangoFechas(30, hoy)).toEqual({ desde: "2026-08-22", hasta: "2026-09-21" });
    expect(calcularRangoFechas(90, hoy)).toEqual({ desde: "2026-06-23", hasta: "2026-09-21" });
  });
});

describe("buildChartSeries", () => {
  const alturas: AlturaDiaria[] = [
    { fecha: "2026-09-19", altura_m: 3.4 },
    { fecha: "2026-09-20", altura_m: 3.5 },
    { fecha: "2026-09-21", altura_m: 3.67 },
  ];
  const pronostico: DiaPronostico[] = [
    {
      fecha: "2026-09-22",
      lead_dias: 1,
      caudal_m3s: 6180,
      altura_est_m: 5.9,
      altura_min_m: 4.9,
      altura_max_m: 6.9,
      altura_anclada_m: 5.9,
      altura_anclada_min_m: 4.9,
      altura_anclada_max_m: 6.9,
      extrapolado: false,
    },
  ];

  it("arma un eje x único y ordenado con los valores alineados, null donde no hay dato", () => {
    const series = buildChartSeries(alturas, pronostico, null);
    expect(series.x).toHaveLength(4);
    expect(series.real).toEqual([3.4, 3.5, 3.67, null]);
    expect(series.pronosticoMin).toEqual([null, null, null, 4.9]);
    expect(series.pronosticoMax).toEqual([null, null, null, 6.9]);
    expect(series.pronosticoCentro).toEqual([null, null, null, 5.9]);
    // El eje x está ordenado ascendente.
    expect([...series.x].sort((a, b) => a - b)).toEqual(series.x);
  });

  it("funciona sin pronóstico ni histórico", () => {
    const series = buildChartSeries(alturas, null, null);
    expect(series.real).toEqual([3.4, 3.5, 3.67]);
    expect(series.pronosticoMin.every((v) => v === null)).toBe(true);
  });

  it("incorpora el histórico cuando está presente", () => {
    const historico: HistoricoDia[] = [{ fecha: "2026-09-20", caudal_m3s: 5000, altura_est_m: 3.3, extrapolado: false }];
    const series = buildChartSeries(alturas, null, historico);
    expect(series.historico).toEqual([null, 3.3, null]);
  });
});

describe("buildResumenTexto", () => {
  it("da una alternativa de texto con el rango real y el pronóstico", () => {
    const alturas: AlturaDiaria[] = [
      { fecha: "2026-09-20", altura_m: 3.4 },
      { fecha: "2026-09-21", altura_m: 3.67 },
    ];
    const pronostico: DiaPronostico[] = [
      {
        fecha: "2026-09-22",
        lead_dias: 1,
        caudal_m3s: 6180,
        altura_est_m: 5.9,
        altura_min_m: 4.9,
        altura_max_m: 6.9,
        altura_anclada_m: 5.9,
        altura_anclada_min_m: 4.9,
        altura_anclada_max_m: 6.9,
        extrapolado: false,
      },
    ];
    const texto = buildResumenTexto(alturas, pronostico);
    expect(texto).toContain("3,40 m");
    expect(texto).toContain("3,67 m");
    expect(texto).toContain("Pronóstico");

    // El pronóstico, igual que la frase de la tarjeta "Próximos días", nunca
    // se muestra como un número exacto: siempre como rango. Verificamos que,
    // fuera del propio rango ("entre X y Y m"), no quede ningún otro valor
    // de metros suelto.
    const partePronostico = texto.slice(texto.indexOf("Pronóstico"));
    const rango = partePronostico.match(/entre .+? y .+? m/);
    expect(rango).not.toBeNull();
    const restoSinRango = partePronostico.replace(rango?.[0] ?? "", "");
    expect(restoSinRango).not.toMatch(/\d,\d+ m/);
  });

  it("avisa cuando no hay datos reales", () => {
    expect(buildResumenTexto([], null)).toMatch(/no hay datos/);
  });
});
