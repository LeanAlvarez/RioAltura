import { describe, expect, it } from "vitest";
import type { Anclaje } from "./api/types";
import { loadDashboardData, nivelMaximoEstimado } from "./app";

const ULTIMA_ALTURA = {
  fecha_hora: "2026-09-21T14:20:00Z",
  altura_m: 3.67,
  fuente: "ina",
  tendencia_24h_m: 0.12,
  estado: "normal",
};

const SIN_ANCLAJE: Anclaje = {
  aplicado: false,
  sesgo_m: null,
  altura_real_m: null,
  fecha_referencia: null,
  motivo: "No hay altura real disponible para hoy",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("loadDashboardData", () => {
  it("un 503 en /pronostico no afecta el resultado de /alturas/ultima", async () => {
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/pronostico")) return jsonResponse(503, { detail: "Todavía no hay un pronóstico" });
      if (url.includes("/alturas/ultima")) return jsonResponse(200, ULTIMA_ALTURA);
      throw new Error(`unexpected url ${url}`);
    };

    const data = await loadDashboardData(fetchFn);

    expect(data.altura).toEqual({ kind: "ok", data: ULTIMA_ALTURA });
    expect(data.pronostico).toEqual({ kind: "unavailable" });
  });

  it("un error de red en /alturas/ultima no afecta a /pronostico", async () => {
    const pronosticoBody = {
      emitido: "2026-09-21T18:00:00Z",
      gauge_id: "hybas_6121320620",
      dias: [],
      aviso: { nivel: "sin_aviso", umbral_m3s: null, primer_dia: null, caudal_max_m3s: null },
      anclaje: SIN_ANCLAJE,
    };
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/pronostico")) return jsonResponse(200, pronosticoBody);
      if (url.includes("/alturas/ultima")) throw new TypeError("network down");
      throw new Error(`unexpected url ${url}`);
    };

    const data = await loadDashboardData(fetchFn);

    expect(data.altura).toEqual({ kind: "error" });
    expect(data.pronostico).toEqual({ kind: "ok", data: pronosticoBody });
  });
});

describe("nivelMaximoEstimado", () => {
  it("es null cuando el pronóstico no está disponible", () => {
    expect(nivelMaximoEstimado({ kind: "unavailable" })).toBeNull();
    expect(nivelMaximoEstimado({ kind: "error" })).toBeNull();
  });

  it("toma la altura estimada máxima entre los días con lead >= 1", () => {
    const nivel = nivelMaximoEstimado({
      kind: "ok",
      data: {
        emitido: "2026-09-21T18:00:00Z",
        gauge_id: "hybas_6121320620",
        dias: [
          {
            fecha: "2026-09-21",
            lead_dias: 0,
            caudal_m3s: 20000,
            altura_est_m: 99,
            altura_min_m: 98,
            altura_max_m: 100,
            altura_anclada_m: 99,
            altura_anclada_min_m: 98,
            altura_anclada_max_m: 100,
            extrapolado: true,
          },
          {
            fecha: "2026-09-22",
            lead_dias: 1,
            caudal_m3s: 6180,
            altura_est_m: 5.9,
            altura_min_m: 4.9,
            altura_max_m: 6.9,
            altura_anclada_m: 6.4,
            altura_anclada_min_m: 5.4,
            altura_anclada_max_m: 7.4,
            extrapolado: false,
          },
          {
            fecha: "2026-09-23",
            lead_dias: 2,
            caudal_m3s: 7000,
            altura_est_m: 6.3,
            altura_min_m: 5.3,
            altura_max_m: 7.3,
            altura_anclada_m: 6.6,
            altura_anclada_min_m: 5.6,
            altura_anclada_max_m: 7.6,
            extrapolado: false,
          },
        ],
        aviso: { nivel: "sin_aviso", umbral_m3s: null, primer_dia: null, caudal_max_m3s: null },
        anclaje: {
          aplicado: true,
          sesgo_m: 0.5,
          altura_real_m: 6.4,
          fecha_referencia: "2026-09-21",
          motivo: null,
        },
      },
    });
    // Anclado: la altura_anclada_m máxima entre lead >= 1 es la del 23/9 (6,6), no la altura_est_m cruda (6,3).
    expect(nivel).toBe(6.6);
  });
});
