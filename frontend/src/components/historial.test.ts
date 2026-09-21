import { describe, expect, it } from "vitest";
import type { AlturaDiaria, Evento, RangoAlerta } from "../api/types";
import {
  buildEventoPuntos,
  buildHistorialSeries,
  buildRangosSombreados,
  calcularRangoHistorico,
} from "./historial";

describe("calcularRangoHistorico", () => {
  it("cubre el máximo permitido por /alturas (3 años) hasta hoy", () => {
    const hoy = new Date(2026, 8, 21);
    const { desde, hasta } = calcularRangoHistorico(hoy, 1080);
    expect(hasta).toBe("2026-09-21");
    expect(desde).toBe("2023-10-07");
  });
});

describe("buildHistorialSeries", () => {
  it("convierte alturas diarias a series x/y alineadas 1 a 1", () => {
    const alturas: AlturaDiaria[] = [
      { fecha: "2024-05-13", altura_m: 8.4 },
      { fecha: "2024-05-14", altura_m: 9.06 },
    ];
    const series = buildHistorialSeries(alturas);
    expect(series.real).toEqual([8.4, 9.06]);
    expect(series.x).toHaveLength(2);
    expect(series.x[1]).toBeGreaterThan(series.x[0] ?? 0);
  });
});

describe("buildRangosSombreados", () => {
  it("convierte los rangos en alerta a epoch seconds, preservando el máximo", () => {
    const rangos: RangoAlerta[] = [{ desde: "2024-05-13", hasta: "2024-05-16", max_m: 9.06 }];
    const sombreado = buildRangosSombreados(rangos);
    expect(sombreado).toHaveLength(1);
    expect(sombreado[0]?.max_m).toBe(9.06);
    expect(sombreado[0]?.hasta).toBeGreaterThan(sombreado[0]?.desde ?? 0);
  });
});

describe("buildEventoPuntos", () => {
  it("convierte cada evento a un punto x/y con su etiqueta", () => {
    const eventos: Evento[] = [{ fecha: "2024-05-14", altura_m: 9.06, etiqueta: "Máximo diario registrado (INA)" }];
    const puntos = buildEventoPuntos(eventos);
    expect(puntos).toHaveLength(1);
    expect(puntos[0]).toMatchObject({ y: 9.06, etiqueta: "Máximo diario registrado (INA)", fecha: "2024-05-14" });
  });
});
