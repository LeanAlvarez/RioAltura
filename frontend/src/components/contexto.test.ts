import { describe, expect, it } from "vitest";
import type { Estadisticas } from "../api/types";
import { deriveContextoView } from "./contexto";

function estadisticas(overrides: Partial<Estadisticas> = {}): Estadisticas {
  return {
    percentil_hoy: { altura_m: 4.29, percentil: 83.4, ventana_dias: 365 },
    error_pronostico: { lead_dias: 3, muestras: 775, mae_m: 0.5 },
    dias_en_alerta: [],
    mismo_dia_otros_anios: [
      { anio: 2024, altura_m: 3.1 },
      { anio: 2025, altura_m: 5.8 },
    ],
    eventos: [],
    ...overrides,
  };
}

describe("deriveContextoView", () => {
  it("maneja carga y error de forma independiente", () => {
    expect(deriveContextoView({ kind: "loading" })).toEqual({ kind: "loading" });
    expect(deriveContextoView({ kind: "error" })).toEqual({ kind: "error" });
  });

  it("traduce el percentil a 'X de cada 10 días', en lenguaje llano", () => {
    const view = deriveContextoView({ kind: "ok", data: estadisticas() });
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    // percentil 83,4 -> 8 de cada 10; altura 4,29 m está a 2,51 m de los 6,80
    // m (>= 1 m de margen de estimación), así que agrega la coletilla.
    expect(view.fraseAmpliada).toBe(
      "En el último año, 8 de cada 10 días el río estuvo más bajo que hoy. Igual, sigue lejos de cualquier alerta.",
    );
  });

  it("no agrega la coletilla de 'lejos de cualquier alerta' cuando no lo está", () => {
    const view = deriveContextoView({
      kind: "ok",
      data: estadisticas({ percentil_hoy: { altura_m: 6.5, percentil: 95, ventana_dias: 365 } }),
    });
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.fraseAmpliada).toBe("En el último año, 10 de cada 10 días el río estuvo más bajo que hoy.");
  });

  it("arma comparaciones por año con hoy incluido y porcentajes relativos", () => {
    const view = deriveContextoView({ kind: "ok", data: estadisticas() });
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.hoy).toEqual({ anio: "Hoy", altura: "4,29 m", porcentaje: expect.any(Number) });
    expect(view.comparaciones).toHaveLength(2);
    expect(view.comparaciones[0]).toMatchObject({ anio: "2024", altura: "3,10 m" });
  });

  it("avisa cuando no hay percentil de hoy sin inventar un número", () => {
    const view = deriveContextoView({ kind: "ok", data: estadisticas({ percentil_hoy: null }) });
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.fraseAmpliada).toBeNull();
    expect(view.hoy).toBeNull();
  });
});
