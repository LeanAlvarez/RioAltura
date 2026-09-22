import { describe, expect, it } from "vitest";
import {
  CONTRASTE_MIN_LINEA,
  CONTRASTE_MIN_TEXTO,
  PALETA,
  ROLES_LINEA,
  ROLES_TEXTO,
  fondoTrazoCss,
  generarCssPaleta,
  ratioContraste,
} from "./paleta";
import type { Tema } from "../theme";

const TEMAS: readonly Tema[] = ["light", "dark"];

describe("ratioContraste", () => {
  it("da 21:1 entre blanco y negro puros", () => {
    expect(ratioContraste("#ffffff", "#000000")).toBeCloseTo(21, 1);
  });

  it("da 1:1 para el mismo color", () => {
    expect(ratioContraste("#3D3D3D", "#3D3D3D")).toBeCloseTo(1, 5);
  });

  it("es simétrico", () => {
    expect(ratioContraste("#0C447C", "#ffffff")).toBeCloseTo(ratioContraste("#ffffff", "#0C447C"), 10);
  });
});

// Test que falla si algún color de la paleta no llega al contraste mínimo
// (punto 3 de la tarea): lee todo desde PALETA, la misma fuente que usa el
// CSS generado — no se puede cambiar un color acá sin que este test lo vea.
describe("contraste mínimo WCAG de la paleta", () => {
  for (const tema of TEMAS) {
    const paleta = PALETA[tema];

    describe(`tema ${tema}`, () => {
      for (const rol of ROLES_TEXTO) {
        it(`${String(rol)}: texto de ejes/etiquetas >= ${CONTRASTE_MIN_TEXTO}:1 contra el fondo de tarjeta`, () => {
          const ratio = ratioContraste(paleta[rol] as string, paleta.fondoTarjeta);
          expect(ratio).toBeGreaterThanOrEqual(CONTRASTE_MIN_TEXTO);
        });
      }

      for (const rol of ROLES_LINEA) {
        it(`${rol}: línea de datos >= ${CONTRASTE_MIN_LINEA}:1 contra el fondo de tarjeta`, () => {
          const ratio = ratioContraste(paleta[rol], paleta.fondoTarjeta);
          expect(ratio).toBeGreaterThanOrEqual(CONTRASTE_MIN_LINEA);
        });
      }
    });
  }
});

describe("generarCssPaleta", () => {
  it("declara las custom properties de los dos temas (claro por defecto, oscuro por sistema y por elección explícita)", () => {
    const css = generarCssPaleta();
    expect(css).toContain(":root {");
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':root[data-theme="dark"]');
    for (const variable of [
      "--graf-eje",
      "--graf-grilla",
      "--graf-altura-real",
      "--graf-pronostico",
      "--graf-pronostico-banda",
      "--graf-historico",
      "--graf-evac-preventiva",
      "--graf-alerta",
      "--graf-evacuacion",
      "--graf-franja-alerta",
    ]) {
      expect(css).toContain(variable);
    }
    // Los tres umbrales llevan colores propios y distintos entre sí en cada tema.
    expect(PALETA.light.evacuacionPreventiva).not.toBe(PALETA.light.alerta);
    expect(PALETA.light.alerta).not.toBe(PALETA.light.evacuacion);
    expect(PALETA.dark.evacuacionPreventiva).not.toBe(PALETA.dark.alerta);
    expect(PALETA.dark.alerta).not.toBe(PALETA.dark.evacuacion);
  });
});

describe("fondoTrazoCss", () => {
  it("da el color sólido cuando no hay patrón de guiones", () => {
    expect(fondoTrazoCss("#0C447C", { widthPx: 2.5 })).toBe("#0C447C");
  });

  it("arma un repeating-linear-gradient con los segmentos del patrón cuando hay dash", () => {
    const css = fondoTrazoCss("#0F6E56", { widthPx: 2, dash: [8, 4] });
    expect(css).toBe("repeating-linear-gradient(to right, #0F6E56 0px 8px, transparent 8px 12px)");
  });
});
