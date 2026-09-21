import { describe, expect, it } from "vitest";
import { buildFaqEstaticas, describeFaqPrecision, describeFaqVeinteMetros, renderFaq } from "./faq";
import type { CapaEntry, CapaIndex } from "../capas";

function fakeContainer(): HTMLElement {
  return { innerHTML: "" } as unknown as HTMLElement;
}

describe("buildFaqEstaticas", () => {
  it("tiene las 11 preguntas mínimas de la spec", () => {
    const items = buildFaqEstaticas();
    expect(items).toHaveLength(11);
    for (const item of items) {
      expect(item.pregunta.length).toBeGreaterThan(5);
      expect(item.respuestaHtml.length).toBeGreaterThan(5);
    }
  });

  it("los ids son únicos", () => {
    const items = buildFaqEstaticas();
    const ids = new Set(items.map((i) => i.id));
    expect(ids.size).toBe(items.length);
  });

  it("usa los textos de umbrales.ts ya aprobados, sin reescribirlos", () => {
    const niveles = buildFaqEstaticas().find((i) => i.id === "niveles");
    expect(niveles?.respuestaHtml).toContain("El municipio puede empezar a trasladar a las familias");
    expect(niveles?.respuestaHtml).toContain("6,80 m");
    expect(niveles?.respuestaHtml).toContain("7,10 m");
    expect(niveles?.respuestaHtml).toContain("7,90 m");
  });

  it("marca PENDIENTE la pregunta sin dato confirmado en el código (canal de reporte de errores)", () => {
    const autor = buildFaqEstaticas().find((i) => i.id === "autor");
    expect(autor?.respuestaHtml).toContain("PENDIENTE");
    expect(autor?.respuestaHtml).toContain("miraisoftware.net");
  });

  it("linkea a Prefectura, CARU e INA en la pregunta de aviso oficial", () => {
    const oficial = buildFaqEstaticas().find((i) => i.id === "oficial");
    expect(oficial?.respuestaHtml).toContain("prefecturanaval");
    expect(oficial?.respuestaHtml).toContain("caru.org.uy");
    expect(oficial?.respuestaHtml).toContain("ina.gob.ar");
  });
});

describe("renderFaq", () => {
  it("arma un <details> por pregunta con ancla identificable por id", () => {
    const el = fakeContainer();
    renderFaq(el, [{ id: "x", pregunta: "¿Pregunta?", respuestaHtml: "Respuesta." }]);
    expect(el.innerHTML).toContain("<details");
    expect(el.innerHTML).toContain("¿Pregunta?");
    expect(el.innerHTML).toContain('id="faq-respuesta-x"');
    expect(el.innerHTML).toContain("Respuesta.");
  });
});

describe("describeFaqPrecision", () => {
  it("da un mensaje si no hay estadísticas", () => {
    expect(describeFaqPrecision({ kind: "error" })).toContain("No pudimos calcular");
  });

  it("describe el error del pronóstico cuando hay datos", () => {
    const texto = describeFaqPrecision({
      kind: "ok",
      data: {
        percentil_hoy: null,
        error_pronostico: { lead_dias: 3, muestras: 40, mae_m: 0.5 },
        dias_en_alerta: [],
        mismo_dia_otros_anios: [],
        eventos: [],
      },
    });
    expect(texto).toContain("0,50 m");
    expect(texto).toContain("Salto Grande");
  });
});

describe("describeFaqVeinteMetros", () => {
  function buildIndex(nivelMax: number): CapaIndex {
    const capa: CapaEntry = {
      h: nivelMax,
      archivo: "h.geojson",
      hectareas: 100,
      bytes: 10,
      toca_borde: false,
      bordes: { norte: false, sur: false, oeste: false, este: false },
    };
    return {
      generado: "2026-09-21T00:00:00Z",
      fuente_dem: "Copernicus DEM GLO-30",
      licencia_dem: "Copernicus DEM",
      cero_ign: -0.26,
      bbox: [-58.25, -32.35, -58.0, -32.1],
      nivel_min: 3,
      nivel_max: nivelMax,
      paso: { hasta_1050: 0.25, sobre_1050: 0.5 },
      clases: [],
      capas: [capa],
    };
  }

  it("nunca hardcodea el máximo: lo lee de index.json", () => {
    expect(describeFaqVeinteMetros(buildIndex(13))).toContain("13,00 m");
    expect(describeFaqVeinteMetros(buildIndex(20))).toContain("20,00 m");
  });

  it("cita la crecida máxima observada (marca MOP, 10,00 m)", () => {
    expect(describeFaqVeinteMetros(buildIndex(20))).toContain("10,00 m");
    expect(describeFaqVeinteMetros(buildIndex(20))).toContain("escenario hipotético");
  });
});
