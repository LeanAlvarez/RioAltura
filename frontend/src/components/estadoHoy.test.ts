import { describe, expect, it } from "vitest";
import { deriveEstadoHoyView, type EstadoHoyState } from "./estadoHoy";

// Sin "Z": se interpretan como hora local (spec ECMA-262 date-time form sin
// offset), igual que en historial.ts/grafico.ts/precision.ts, así el test no
// depende de la zona horaria donde corra (formatMomentoMedicion compara días
// calendario en hora local).
const ahora = new Date("2026-09-21T15:00:00");

describe("deriveEstadoHoyView", () => {
  it("maneja el estado de carga de forma independiente", () => {
    expect(deriveEstadoHoyView({ kind: "loading" }, ahora)).toEqual({ kind: "loading" });
  });

  it("maneja errores de la API sin tumbar el resto", () => {
    const estados: EstadoHoyState[] = [
      { kind: "error" },
      { kind: "not-found" },
      { kind: "invalid" },
      { kind: "unavailable" },
    ];
    for (const estado of estados) {
      expect(deriveEstadoHoyView(estado, ahora)).toEqual({ kind: "error" });
    }
  });

  it("da los textos formateados cuando hay datos, con la distancia al primer umbral", () => {
    const view = deriveEstadoHoyView(
      {
        kind: "ok",
        data: {
          fecha_hora: "2026-09-21T14:20:00",
          altura_m: 4.29,
          fuente: "ina",
          tendencia_24h_m: 0.12,
          estado: "normal",
        },
      },
      ahora,
    );
    expect(view).toEqual({
      kind: "ready",
      alturaM: 4.29,
      altura: "4,29 m",
      estadoLabel: "Normal",
      estadoTono: "ok",
      distanciaUmbral: "Faltan 2,51 m para los 6,80 m, cuando el municipio empieza a evacuar por precaución.",
      tendencia: "Sube 12 cm",
      medicion: "Última medición del puerto: hoy a las 14:20.",
    });
  });

  it("nunca marca la medición como un aviso de riesgo: no depende de cuán vieja sea", () => {
    const view = deriveEstadoHoyView(
      {
        kind: "ok",
        data: {
          fecha_hora: "2026-09-20T20:00:00",
          altura_m: 3.5,
          fuente: "prefectura",
          tendencia_24h_m: null,
          estado: "normal",
        },
      },
      ahora,
    );
    expect(view.kind).toBe("ready");
    if (view.kind === "ready") {
      expect(view.medicion).toBe("Última medición del puerto: ayer a las 20:00.");
      expect(view.tendencia).toBe("Tendencia no disponible");
    }
  });

  it("dice cuál umbral ya superó, no solo cuánto falta", () => {
    const base = {
      fecha_hora: "2026-09-21T14:55:00",
      fuente: "ina" as const,
      tendencia_24h_m: 0,
    };
    const evacuacionEnSeco = deriveEstadoHoyView(
      { kind: "ok", data: { ...base, altura_m: 7.0, estado: "evacuacion_en_seco" } },
      ahora,
    );
    const alerta = deriveEstadoHoyView({ kind: "ok", data: { ...base, altura_m: 7.5, estado: "alerta" } }, ahora);
    const evacuacion = deriveEstadoHoyView(
      { kind: "ok", data: { ...base, altura_m: 8.5, estado: "evacuacion" } },
      ahora,
    );

    if (evacuacionEnSeco.kind === "ready") {
      expect(evacuacionEnSeco.estadoLabel).toBe("Evacuación preventiva");
      expect(evacuacionEnSeco.estadoTono).toBe("warn");
      expect(evacuacionEnSeco.distanciaUmbral).toContain("Faltan");
      expect(evacuacionEnSeco.distanciaUmbral).toContain("la alerta");
    }
    if (alerta.kind === "ready") {
      expect(alerta.estadoLabel).toBe("Alerta");
      expect(alerta.estadoTono).toBe("error");
      expect(alerta.distanciaUmbral).toContain("Ya superó la alerta");
    }
    if (evacuacion.kind === "ready") {
      expect(evacuacion.estadoLabel).toBe("Evacuación");
      expect(evacuacion.estadoTono).toBe("danger");
      expect(evacuacion.distanciaUmbral).toBe("Ya superó la evacuación (7,90 m).");
    }
  });
});
