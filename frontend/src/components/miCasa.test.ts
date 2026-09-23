import { describe, expect, it } from "vitest";
import { DISCLAIMER_MI_CASA, deriveMiCasaView, type MiCasaState } from "../domain/miCasa";
import { renderMiCasa } from "./miCasa";

function fakeContainer(): HTMLElement {
  return { innerHTML: "" } as unknown as HTMLElement;
}

function render(state: MiCasaState): string {
  const container = fakeContainer();
  renderMiCasa(container, deriveMiCasaView(state));
  return container.innerHTML;
}

describe("renderMiCasa", () => {
  it("sin-punto: invita a tocar el mapa, sin disclaimer (todavía no hay respuesta)", () => {
    const html = render({ kind: "sin-punto" });
    expect(html).toContain("Tocá el mapa");
    expect(html).not.toContain(DISCLAIMER_MI_CASA);
  });

  it("calculando: no muestra el disclaimer todavía (no hay respuesta)", () => {
    const html = render({ kind: "calculando" });
    expect(html).not.toContain(DISCLAIMER_MI_CASA);
  });

  it("fuera-de-area: mensaje y disclaimer, sin altura", () => {
    const html = render({ kind: "fuera-de-area" });
    expect(html).toContain("fuera del área que mapeamos");
    expect(html).toContain(DISCLAIMER_MI_CASA);
  });

  it("ya-inundado: muestra la altura y el disclaimer", () => {
    const html = render({ kind: "ya-inundado", alturaM: 3.0 });
    expect(html).toContain("3,00 m");
    expect(html).toContain(DISCLAIMER_MI_CASA);
  });

  it("seco: muestra el disclaimer sin sugerir que sea imposible que se inunde", () => {
    const html = render({ kind: "seco", alturaMaximaModeladaM: 20.0 });
    expect(html).toContain("20,00 m");
    expect(html).toContain(DISCLAIMER_MI_CASA);
    expect(html).not.toMatch(/nunca|imposible|jamás/i);
  });

  it("encontrado: altura y disclaimer", () => {
    const html = render({ kind: "encontrado", alturaM: 7.4 });
    expect(html).toContain("7,40 m");
    expect(html).toContain(DISCLAIMER_MI_CASA);
  });

  it("error: role=alert y disclaimer", () => {
    const html = render({ kind: "error" });
    expect(html).toContain('role="alert"');
    expect(html).toContain(DISCLAIMER_MI_CASA);
  });

  it("el disclaimer nunca tiene forma de cerrarse: la tarjeta no arma ningún botón", () => {
    for (const state of [
      { kind: "sin-punto" },
      { kind: "calculando" },
      { kind: "error" },
      { kind: "fuera-de-area" },
      { kind: "ya-inundado", alturaM: 3.0 },
      { kind: "seco", alturaMaximaModeladaM: 20.0 },
      { kind: "encontrado", alturaM: 7.4 },
    ] as MiCasaState[]) {
      expect(render(state)).not.toContain("<button");
    }
  });
});
