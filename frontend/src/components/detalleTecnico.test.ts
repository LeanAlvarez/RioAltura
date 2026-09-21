import { describe, expect, it } from "vitest";
import type { DiaPronostico, Pronostico, PronosticoAguasArriba } from "../api/types";
import { deriveDetalleTecnicoView } from "./detalleTecnico";

function dia(overrides: Partial<DiaPronostico> = {}): DiaPronostico {
  return {
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
    ...overrides,
  };
}

describe("deriveDetalleTecnicoView", () => {
  it("da null cuando los dos pronósticos fallan, sin inventar datos", () => {
    const view = deriveDetalleTecnicoView({ kind: "error" }, { kind: "error" });
    expect(view.emitidoColon).toBeNull();
    expect(view.filasColon).toEqual([]);
    expect(view.emitidoAguasArriba).toBeNull();
  });

  it("arma las filas de caudal (m³/s) por día, para cada gauge", () => {
    const pronostico: Pronostico = {
      emitido: "2026-09-21T20:45:00Z",
      gauge_id: "hybas_6121320620",
      dias: [dia({ caudal_m3s: 12836 })],
      aviso: { nivel: "sin_aviso", umbral_m3s: null, primer_dia: null, caudal_max_m3s: null },
      anclaje: { aplicado: false, sesgo_m: null, altura_real_m: null, fecha_referencia: null, motivo: "x" },
    };
    const aguasArriba: PronosticoAguasArriba = {
      emitido: "2026-09-21T08:00:00Z",
      gauge_id: "hybas_6120865460",
      dias: [dia({ caudal_m3s: 5800 })],
    };

    const view = deriveDetalleTecnicoView({ kind: "ok", data: pronostico }, { kind: "ok", data: aguasArriba });
    expect(view.gaugeColon).toBe("hybas_6121320620");
    expect(view.filasColon).toEqual([{ dia: "mar 22", caudal: "12.836 m³/s" }]);
    expect(view.gaugeAguasArriba).toBe("hybas_6120865460");
    expect(view.filasAguasArriba).toEqual([{ dia: "mar 22", caudal: "5.800 m³/s" }]);
    expect(view.emitidoColon).not.toBeNull();
  });
});
