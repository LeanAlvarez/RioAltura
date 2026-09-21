import { describe, expect, it } from "vitest";
import type { DiaPronostico, PronosticoAguasArriba } from "../api/types";
import { deriveAguasArribaView } from "./aguasArriba";

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
