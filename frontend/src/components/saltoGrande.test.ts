import { describe, expect, it } from "vitest";
import type { ComunicadoSaltoGrande, LluviaSubcuenca, SaltoGrande } from "../api/types";
import {
  construirFraseLluviaObservada,
  construirFrasePronosticoLluvia,
  deriveSaltoGrandeView,
  esVertederoAbierto,
  tendenciaCaudal,
} from "./saltoGrande";

const AHORA = new Date(2026, 8, 22, 10, 0, 0); // 22/09/2026 (mes 0-indexado)

function comunicado(overrides: Partial<ComunicadoSaltoGrande> = {}): ComunicadoSaltoGrande {
  return {
    fecha: "2026-09-22",
    aporte_m3s: 7553,
    evacuado_m3s: 7821,
    nivel_embalse_m: 34.81,
    estado_vertedero: "Cerrado",
    texto_proyeccion: "Hasta la hora 15:00 de mañana, el caudal medio diario evacuado variará entre 8.000 y 7.000 m³/s.",
    ...overrides,
  };
}

function lluvia(subcuenca: string, fecha: string, lluvia_mm: number): LluviaSubcuenca {
  return { subcuenca, fecha, lluvia_mm };
}

function saltoGrande(overrides: Partial<SaltoGrande> = {}): SaltoGrande {
  return {
    comunicado: comunicado(),
    comunicado_anterior: null,
    caudales_cascada: [],
    lluvia_observada: [],
    lluvia_pronostico: [],
    ...overrides,
  };
}

describe("tendenciaCaudal", () => {
  it("sube cuando el evacuado de hoy supera al de ayer en más del 3%", () => {
    expect(tendenciaCaudal(9692, 7821)).toBe("sube");
  });

  it("baja cuando el evacuado de hoy es menor al de ayer en más del 3%", () => {
    expect(tendenciaCaudal(7821, 9692)).toBe("baja");
  });

  it("estable dentro del 3% de diferencia", () => {
    expect(tendenciaCaudal(7821, 7900)).toBe("estable");
  });

  it("no rompe con ayer en cero", () => {
    expect(tendenciaCaudal(0, 0)).toBe("estable");
    expect(tendenciaCaudal(100, 0)).toBe("sube");
  });
});

describe("esVertederoAbierto", () => {
  it("Cerrado (en cualquier capitalización) es false", () => {
    expect(esVertederoAbierto("Cerrado")).toBe(false);
    expect(esVertederoAbierto("CERRADO")).toBe(false);
  });

  it("cualquier otro texto es true", () => {
    expect(esVertederoAbierto("Abierto")).toBe(true);
    expect(esVertederoAbierto("Parcialmente abierto")).toBe(true);
  });
});

describe("construirFraseLluviaObservada", () => {
  it("usa el día con más lluvia de la ventana, no el más reciente", () => {
    const frase = construirFraseLluviaObservada(
      [
        lluvia("El Soberbio", "2026-09-19", 13),
        lluvia("El Soberbio", "2026-09-20", 58),
        lluvia("El Soberbio", "2026-09-21", 1),
        lluvia("El Soberbio", "2026-09-22", 10),
      ],
      AHORA,
    );

    expect(frase).toBe("Llovió 58 mm río arriba hace 2 días.");
  });

  it("null si no hay datos", () => {
    expect(construirFraseLluviaObservada([], AHORA)).toBeNull();
  });

  it("null si nada supera el piso de lluvia significativa", () => {
    const frase = construirFraseLluviaObservada(
      [lluvia("El Soberbio", "2026-09-21", 1), lluvia("San Javier", "2026-09-22", 2)],
      AHORA,
    );
    expect(frase).toBeNull();
  });
});

describe("construirFrasePronosticoLluvia", () => {
  it("suma la lluvia pronosticada de todas las subcuencas", () => {
    const frase = construirFrasePronosticoLluvia([
      lluvia("Itá", "2026-09-27", 3),
      lluvia("El Soberbio", "2026-09-27", 6),
      lluvia("Itá", "2026-09-28", 21),
    ]);

    expect(frase).toBe("Se espera otros 30 mm de lluvia en la cuenca en los próximos días.");
  });

  it("null si no hay pronóstico o el total es despreciable", () => {
    expect(construirFrasePronosticoLluvia([])).toBeNull();
    expect(construirFrasePronosticoLluvia([lluvia("Itá", "2026-09-27", 1)])).toBeNull();
  });
});

describe("deriveSaltoGrandeView", () => {
  it("maneja carga, no disponible y error de forma independiente", () => {
    expect(deriveSaltoGrandeView({ kind: "loading" }, AHORA)).toEqual({ kind: "loading" });
    expect(deriveSaltoGrandeView({ kind: "unavailable" }, AHORA)).toEqual({ kind: "unavailable" });
    expect(deriveSaltoGrandeView({ kind: "error" }, AHORA)).toEqual({ kind: "error" });
  });

  it("sin comunicado_anterior, no arma tendencia y usa una frase neutra", () => {
    const view = deriveSaltoGrandeView({ kind: "ok", data: saltoGrande() }, AHORA);

    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.comunicado?.tendencia).toBeNull();
    expect(view.comunicado?.evacuadoFrase).toBe("La represa de Salto Grande está evacuando agua.");
  });

  it("con comunicado_anterior, arma la frase de tendencia y el detalle en m³/s", () => {
    const view = deriveSaltoGrandeView(
      {
        kind: "ok",
        data: saltoGrande({
          comunicado: comunicado({ evacuado_m3s: 7821 }),
          comunicado_anterior: comunicado({ fecha: "2026-09-21", evacuado_m3s: 9692 }),
        }),
      },
      AHORA,
    );

    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.comunicado?.tendencia).toBe("baja");
    expect(view.comunicado?.evacuadoFrase).toContain("menos agua que ayer");
    expect(view.comunicado?.evacuadoDetalle).toBe("7.821 m³/s evacuados");
  });

  it("cita la proyección tal cual, con el vertedero y la fecha", () => {
    const view = deriveSaltoGrandeView({ kind: "ok", data: saltoGrande() }, AHORA);

    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.comunicado?.proyeccionTexto).toContain("variará entre 8.000 y 7.000 m³/s");
    expect(view.comunicado?.vertederoTexto).toBe("Cerrado");
    expect(view.comunicado?.vertederoAbierto).toBe(false);
    expect(view.comunicado?.fechaTexto).toContain("22");
  });

  it("sin comunicado, comunicado queda null (degradación elegante)", () => {
    const view = deriveSaltoGrandeView({ kind: "ok", data: saltoGrande({ comunicado: null }) }, AHORA);

    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.comunicado).toBeNull();
  });

  it("nunca deriva ni menciona una altura de Colón", () => {
    const view = deriveSaltoGrandeView(
      {
        kind: "ok",
        data: saltoGrande({
          lluvia_observada: [lluvia("El Soberbio", "2026-09-20", 58)],
          lluvia_pronostico: [lluvia("Itá", "2026-09-27", 2)],
        }),
      },
      AHORA,
    );

    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    const json = JSON.stringify(view).toLowerCase();
    expect(json).not.toContain("colón");
    expect(json).not.toContain("colon");
    expect(view.lluviaFrase).toBe("Llovió 58 mm río arriba hace 2 días.");
    expect(view.pronosticoLluviaFrase).toBeNull(); // 2mm total, bajo el piso
  });
});
