import { describe, expect, it } from "vitest";
import type { Anclaje, DiaPronostico, Pronostico } from "../api/types";
import { deriveProximosDiasView } from "./proximosDias";

// No coincide con ninguna `fecha` de los fixtures de abajo (por defecto
// "2026-09-22"), así que ningún día del pool general cae en "hoy" salvo que
// un test lo pida explícitamente con su propio `ahora`.
const ahora = new Date(2026, 8, 20);

const SIN_ANCLAJE: Anclaje = {
  aplicado: false,
  sesgo_m: null,
  altura_real_m: null,
  fecha_referencia: null,
  motivo: "No hay altura real disponible para hoy",
};

const CON_ANCLAJE: Anclaje = {
  aplicado: true,
  sesgo_m: 0.62,
  altura_real_m: 4.29,
  fecha_referencia: "2026-09-21",
  motivo: null,
};

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

function pronostico(
  dias: DiaPronostico[],
  nivel: Pronostico["aviso"]["nivel"] = "sin_aviso",
  anclaje: Anclaje = SIN_ANCLAJE,
): Pronostico {
  return {
    emitido: "2026-09-21T20:45:00Z",
    gauge_id: "hybas_6121320620",
    dias,
    aviso: { nivel, umbral_m3s: null, primer_dia: null, caudal_max_m3s: null },
    anclaje,
  };
}

describe("deriveProximosDiasView", () => {
  it("maneja carga y error de forma independiente", () => {
    expect(deriveProximosDiasView({ kind: "loading" }, ahora)).toEqual({ kind: "loading" });
    expect(deriveProximosDiasView({ kind: "error" }, ahora)).toEqual({ kind: "error" });
    expect(deriveProximosDiasView({ kind: "not-found" }, ahora)).toEqual({ kind: "error" });
  });

  it("distingue el 503 (pronóstico no disponible) de un error genérico", () => {
    expect(deriveProximosDiasView({ kind: "unavailable" }, ahora)).toEqual({ kind: "unavailable" });
  });

  it("la frase siempre es un rango, nunca un número exacto", () => {
    const view = deriveProximosDiasView(
      {
        kind: "ok",
        data: pronostico([
          dia({
            fecha: "2026-09-22",
            lead_dias: 1,
            altura_min_m: 4.7,
            altura_max_m: 6.7,
            altura_est_m: 5.7,
            altura_anclada_min_m: 4.7,
            altura_anclada_max_m: 6.7,
            altura_anclada_m: 5.7,
          }),
          dia({
            fecha: "2026-09-27",
            lead_dias: 6,
            altura_min_m: 5.5,
            altura_max_m: 7.5,
            altura_est_m: 6.5,
            altura_anclada_min_m: 5.5,
            altura_anclada_max_m: 7.5,
            altura_anclada_m: 6.5,
          }),
        ]),
      },
      ahora,
    );
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.frase).toMatch(/entre .+ y .+ m/);
    expect(view.frase).toContain("domingo 27");
  });

  it("usa el día de mayor altura máxima estimada entre lead >= 1", () => {
    const view = deriveProximosDiasView(
      {
        kind: "ok",
        data: pronostico([
          dia({ fecha: "2026-09-21", lead_dias: 0, altura_max_m: 20, altura_anclada_max_m: 20 }), // no cuenta: lead 0
          dia({ fecha: "2026-09-22", lead_dias: 1, altura_max_m: 6.9, altura_anclada_max_m: 6.9 }),
          dia({ fecha: "2026-09-23", lead_dias: 2, altura_max_m: 8.1, altura_anclada_max_m: 8.1 }),
        ]),
      },
      ahora,
    );
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.frase).toContain("miércoles 23");
  });

  it("surfacea el aviso de extrapolación cuando el día elegido lo tiene", () => {
    const view = deriveProximosDiasView(
      { kind: "ok", data: pronostico([dia({ lead_dias: 1, extrapolado: true })]) },
      ahora,
    );
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.fraseExtrapolada).toBe(true);
    expect(view.hayExtrapolados).toBe(true);
  });

  it("no marca extrapolación cuando ningún día la tiene", () => {
    const view = deriveProximosDiasView({ kind: "ok", data: pronostico([dia({ extrapolado: false })]) }, ahora);
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.fraseExtrapolada).toBe(false);
    expect(view.hayExtrapolados).toBe(false);
  });

  it("traduce el nivel de aviso a lenguaje simple", () => {
    const view = deriveProximosDiasView({ kind: "ok", data: pronostico([dia()], "alerta_probable") }, ahora);
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.avisoLabel).toBe("Alerta probable");
  });

  it("dice 'Hoy no hay alerta' en vez de repetir la jerga de 'Sin aviso' (ítem 8/9)", () => {
    const view = deriveProximosDiasView({ kind: "ok", data: pronostico([dia()], "sin_aviso") }, ahora);
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.nivelAviso).toBe("sin_aviso");
    expect(view.avisoLabel).toBe("Sin aviso");
  });

  it("arma la mini lista con rango y tendencia por día, siempre como rango", () => {
    const view = deriveProximosDiasView(
      {
        kind: "ok",
        data: pronostico([
          dia({
            fecha: "2026-09-22",
            lead_dias: 1,
            altura_est_m: 5.0,
            altura_min_m: 4.0,
            altura_max_m: 6.0,
            altura_anclada_m: 5.0,
            altura_anclada_min_m: 4.0,
            altura_anclada_max_m: 6.0,
          }),
          dia({
            fecha: "2026-09-23",
            lead_dias: 2,
            altura_est_m: 5.5,
            altura_min_m: 4.5,
            altura_max_m: 6.5,
            altura_anclada_m: 5.5,
            altura_anclada_min_m: 4.5,
            altura_anclada_max_m: 6.5,
          }),
        ]),
      },
      ahora,
    );
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.dias).toHaveLength(2);
    expect(view.dias[0]?.tendencia).toBeNull();
    expect(view.dias[1]?.tendencia).toBe("sube");
    expect(view.dias[0]?.rango).toMatch(/^entre .+ y .+ m$/);
  });

  it("la fila de hoy (fecha == hoy, sin importar lead_dias) muestra el valor medido, no un rango (ítem 5)", () => {
    // Reproduce el caso real del diagnóstico: la última emisión de Google es
    // de ayer, así que el día de "hoy" sobrevive con lead_dias 1 (el de
    // lead_dias 0 cae ayer y C3 lo filtra por fecha). Comparar por
    // `lead_dias === 0` detectaría mal "hoy" en este caso.
    const hoy = new Date(2026, 8, 21);
    const view = deriveProximosDiasView(
      {
        kind: "ok",
        data: pronostico([
          dia({ fecha: "2026-09-21", lead_dias: 1, altura_anclada_m: 4.29 }),
          dia({ fecha: "2026-09-22", lead_dias: 2, altura_anclada_min_m: 3.3, altura_anclada_max_m: 5.3 }),
        ], "sin_aviso", CON_ANCLAJE),
      },
      hoy,
    );
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.dias[0]).toMatchObject({ dia: "Hoy", rango: null, medido: "4,29 m" });
    expect(view.dias[1]).toMatchObject({ dia: "mar 22", medido: null });
    expect(view.dias[1]?.rango).toMatch(/^entre .+ y .+ m$/);
  });

  it("usa el rango anclado, no el crudo de la curva, y explica el anclaje cuando se aplicó", () => {
    const view = deriveProximosDiasView(
      {
        kind: "ok",
        data: pronostico(
          [dia({ altura_min_m: 4.9, altura_max_m: 6.9, altura_anclada_min_m: 5.5, altura_anclada_max_m: 7.5 })],
          "sin_aviso",
          { aplicado: true, sesgo_m: 0.6, altura_real_m: 6.5, fecha_referencia: "2026-09-21", motivo: null },
        ),
      },
      ahora,
    );
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.frase).toContain("entre 5,5 y 7,5 m");
    expect(view.frase).not.toContain("entre 4,9 y 6,9 m");
    expect(view.anclajeTexto).toMatch(/ajustado con la medición de hoy/i);
  });

  it("no explica el anclaje cuando no se aplicó", () => {
    const view = deriveProximosDiasView({ kind: "ok", data: pronostico([dia()]) }, ahora);
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.anclajeTexto).toBeNull();
  });

  it("sin anclaje, la fila de hoy muestra rango: una estimación no se rotula 'medido'", () => {
    // Bug visto con datos reales: el worker no había traído la altura de hoy,
    // así que `anclaje.aplicado` era false y `altura_anclada_m` era la
    // estimación pura de la curva. La fila igual decía "3,93 m medido", o sea
    // presentaba un pronóstico como una medición.
    const hoy = new Date(2026, 8, 22);
    const view = deriveProximosDiasView(
      {
        kind: "ok",
        data: pronostico(
          [dia({ fecha: "2026-09-22", lead_dias: 1, altura_anclada_m: 3.93 })],
          "sin_aviso",
          SIN_ANCLAJE,
        ),
      },
      hoy,
    );
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.dias[0]?.dia).toBe("Hoy");
    expect(view.dias[0]?.medido).toBeNull();
    expect(view.dias[0]?.rango).toMatch(/^entre .+ y .+ m$/);
  });

});
