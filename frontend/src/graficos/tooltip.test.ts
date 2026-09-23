import { describe, expect, it } from "vitest";
import { contenidoTooltipPrecision } from "../components/precision";
import { contenidoTooltipHistorial } from "../components/historial";
import { contenidoTooltipAguasArriba } from "../components/aguasArriba";

// 2026-08-10 y 2026-08-11 a las 00:00 locales, en segundos.
const DIA_1 = Math.floor(new Date(2026, 7, 10).getTime() / 1000);
const DIA_2 = Math.floor(new Date(2026, 7, 11).getTime() / 1000);

describe("contenidoTooltipPrecision", () => {
  const series = {
    x: [DIA_1, DIA_2],
    real: [6.58, null],
    pronosticado: [5.91, 4.2],
  };

  it("con las dos series muestra ambas y cuánto le erró", () => {
    const html = contenidoTooltipPrecision(series, 0) ?? "";
    expect(html).toContain("6,58 m");
    expect(html).toContain("5,91 m");
    // 6,58 - 5,91 = 0,67: el dato que este gráfico existe para mostrar.
    expect(html).toContain("0,67 m");
  });

  it("con una sola serie no inventa la diferencia", () => {
    const html = contenidoTooltipPrecision(series, 1) ?? "";
    expect(html).toContain("4,20 m");
    expect(html).not.toContain("erró");
  });

  it("devuelve null cuando el día no tiene ningún valor", () => {
    expect(contenidoTooltipPrecision({ x: [DIA_1], real: [null], pronosticado: [null] }, 0)).toBeNull();
  });

  it("devuelve null fuera de rango, en vez de romper", () => {
    expect(contenidoTooltipPrecision(series, 99)).toBeNull();
  });
});

describe("contenidoTooltipHistorial", () => {
  it("muestra la altura de ese día con su año: el gráfico abarca años", () => {
    const html = contenidoTooltipHistorial({ x: [DIA_1], real: [9.06] }, 0) ?? "";
    expect(html).toContain("9,06 m");
    expect(html).toContain("2026");
  });

  it("devuelve null fuera de rango", () => {
    expect(contenidoTooltipHistorial({ x: [DIA_1], real: [9.06] }, 5)).toBeNull();
  });
});

describe("contenidoTooltipAguasArriba", () => {
  const series = { x: [DIA_1, DIA_2], colon: [4.84, null], aguasArriba: [5.35, null] };

  it("nombra los dos lugares", () => {
    const html = contenidoTooltipAguasArriba(series, 0) ?? "";
    expect(html).toContain("Colón");
    expect(html).toContain("4,84 m");
    expect(html).toContain("Aguas arriba");
    expect(html).toContain("5,35 m");
  });

  it("devuelve null cuando falta todo, en vez de un tooltip vacío", () => {
    expect(contenidoTooltipAguasArriba(series, 1)).toBeNull();
  });
});
