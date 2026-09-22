import { describe, expect, it } from "vitest";
import { isUltimaAltura } from "./guards";
import type { Fuente } from "./types";

/**
 * Los type guards son el borde entre el contrato del backend y la UI: si
 * rechazan una respuesta válida, `fetchJson` devuelve `error` y la tarjeta
 * degrada mostrando "no pudimos obtener la altura" con un dato que en
 * realidad estaba perfecto.
 *
 * Eso pasó de verdad al agregar CARU (spec 009): se amplió el check de la
 * base, el `Literal` de Pydantic y el enum del OpenAPI, pero no este espejo
 * en TypeScript. La API devolvía 200 con `fuente: "caru"` y la tarjeta HOY
 * igual mostraba el error, mientras "Próximos días" funcionaba al lado.
 * Ningún test lo vio porque no había ninguno sobre los guards, y todas las
 * fixtures usaban "ina".
 */

const BASE = {
  fecha_hora: "2026-09-22T03:00:00Z",
  altura_m: 4.29,
  fuente: "ina" as Fuente,
  tendencia_24h_m: 0.0,
  estado: "normal",
};

describe("isUltimaAltura", () => {
  it.each<Fuente>(["ina", "prefectura", "caru"])("acepta fuente %s", (fuente) => {
    expect(isUltimaAltura({ ...BASE, fuente })).toBe(true);
  });

  it("rechaza una fuente que no está en el contrato", () => {
    expect(isUltimaAltura({ ...BASE, fuente: "marte" })).toBe(false);
  });

  it("rechaza si falta un campo obligatorio", () => {
    const { altura_m: _omitido, ...sinAltura } = BASE;
    expect(isUltimaAltura(sinAltura)).toBe(false);
  });

  it("rechaza tipos equivocados", () => {
    expect(isUltimaAltura({ ...BASE, altura_m: "4,29" })).toBe(false);
    expect(isUltimaAltura(null)).toBe(false);
    expect(isUltimaAltura("no es un objeto")).toBe(false);
  });

  it("acepta tendencia nula, que es válida sin lectura previa", () => {
    expect(isUltimaAltura({ ...BASE, tendencia_24h_m: null })).toBe(true);
  });
});
