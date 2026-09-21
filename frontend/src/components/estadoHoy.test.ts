import { describe, expect, it } from "vitest";
import { deriveEstadoHoyView, type EstadoHoyState } from "./estadoHoy";

const ahora = new Date("2026-09-21T15:00:00Z");

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

  it("da los textos formateados cuando hay datos", () => {
    const view = deriveEstadoHoyView(
      {
        kind: "ok",
        data: {
          fecha_hora: "2026-09-21T14:20:00Z",
          altura_m: 3.67,
          fuente: "ina",
          tendencia_24h_m: 0.12,
          estado: "normal",
        },
      },
      ahora,
    );
    expect(view).toEqual({
      kind: "ready",
      altura: "3,67 m",
      estadoLabel: "Normal",
      estadoTono: "ok",
      tendencia: "Sube 12 cm",
      actualizado: "hace 40 minutos",
      datoViejo: false,
    });
  });

  it("marca el dato como viejo cuando tiene más de 6 horas", () => {
    const view = deriveEstadoHoyView(
      {
        kind: "ok",
        data: {
          fecha_hora: "2026-09-21T08:00:00Z",
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
      expect(view.datoViejo).toBe(true);
      expect(view.tendencia).toBe("Tendencia no disponible");
    }
  });

  it("mapea cada estado a su color y etiqueta, siempre con texto", () => {
    const base = {
      fecha_hora: "2026-09-21T14:55:00Z",
      altura_m: 7.5,
      fuente: "ina" as const,
      tendencia_24h_m: 0,
    };
    const evacuacionEnSeco = deriveEstadoHoyView(
      { kind: "ok", data: { ...base, estado: "evacuacion_en_seco" } },
      ahora,
    );
    const alerta = deriveEstadoHoyView({ kind: "ok", data: { ...base, estado: "alerta" } }, ahora);
    const evacuacion = deriveEstadoHoyView({ kind: "ok", data: { ...base, estado: "evacuacion" } }, ahora);

    if (evacuacionEnSeco.kind === "ready") {
      expect(evacuacionEnSeco.estadoLabel).toBe("Evacuación en seco");
      expect(evacuacionEnSeco.estadoTono).toBe("warn");
    }
    if (alerta.kind === "ready") {
      expect(alerta.estadoLabel).toBe("Alerta");
      expect(alerta.estadoTono).toBe("error");
    }
    if (evacuacion.kind === "ready") {
      expect(evacuacion.estadoLabel).toBe("Evacuación");
      expect(evacuacion.estadoTono).toBe("danger");
    }
  });
});
