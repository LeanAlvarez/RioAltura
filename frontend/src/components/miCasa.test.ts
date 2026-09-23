import { describe, expect, it } from "vitest";
import { DISCLAIMER_MI_CASA, deriveMiCasaView, type MiCasaState } from "../domain/miCasa";
import { renderMiCasa } from "./miCasa";

function fakeContainer(): HTMLElement {
  return { innerHTML: "" } as unknown as HTMLElement;
}

const TODOS_LOS_ESTADOS: MiCasaState[] = [
  { kind: "sin-punto" },
  { kind: "eligiendo" },
  { kind: "calculando" },
  { kind: "error" },
  { kind: "fuera-de-area" },
  { kind: "ya-inundado", alturaM: 3.0 },
  { kind: "seco", alturaMaximaModeladaM: 20.0 },
  { kind: "encontrado", alturaM: 7.4 },
];

function render(state: MiCasaState): string {
  const container = fakeContainer();
  renderMiCasa(container, deriveMiCasaView(state));
  return container.innerHTML;
}

describe("renderMiCasa", () => {
  it("sin-punto: invita a marcar, sin disclaimer (todavía no hay respuesta)", () => {
    const html = render({ kind: "sin-punto" });
    expect(html).toContain("Marcá tu casa en el mapa");
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

  it("eligiendo: pide el click en el mapa y todavía no muestra el disclaimer", () => {
    const html = render({ kind: "eligiendo" });
    expect(html).toContain("Tocá tu casa en el mapa");
    expect(html).not.toContain(DISCLAIMER_MI_CASA);
  });

  it("el disclaimer nunca tiene forma de cerrarse: su bloque no lleva ningún control (C5)", () => {
    // Desde C6 la tarjeta SÍ tiene botones (marcar / elegir otro / borrar).
    // Lo que la spec prohíbe es cerrar el disclaimer, así que el invariante
    // se mide sobre su propio bloque, no sobre la tarjeta entera.
    for (const state of TODOS_LOS_ESTADOS) {
      const html = render(state);
      const bloque = /<div class="mi-casa-disclaimer">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
      expect(bloque).not.toContain("<button");
      expect(html).not.toMatch(/data-accion="(cerrar|ocultar)"/);
    }
  });
});

describe("acciones de la tarjeta (C6)", () => {
  it("sin punto marcado: ofrece marcar, y nada que borrar", () => {
    const html = render({ kind: "sin-punto" });
    expect(html).toContain('data-accion="marcar"');
    expect(html).toContain("Marcar mi casa");
    expect(html).not.toContain('data-accion="borrar"');
  });

  it("eligiendo: sólo se puede cancelar", () => {
    const html = render({ kind: "eligiendo" });
    expect(html).toContain('data-accion="cancelar"');
    expect(html).not.toContain('data-accion="marcar"');
    expect(html).not.toContain('data-accion="borrar"');
  });

  it("calculando: ninguna acción mientras busca", () => {
    const html = render({ kind: "calculando" });
    expect(html).not.toContain("data-accion=");
  });

  it("con punto marcado: se puede cambiar y borrar, incluso si el cálculo falló", () => {
    for (const state of [
      { kind: "encontrado", alturaM: 7.4 },
      { kind: "ya-inundado", alturaM: 3.0 },
      { kind: "seco", alturaMaximaModeladaM: 20.0 },
      { kind: "fuera-de-area" },
      { kind: "error" },
    ] as MiCasaState[]) {
      const html = render(state);
      expect(html).toContain('data-accion="marcar"');
      expect(html).toContain("Elegir otro punto");
      expect(html).toContain('data-accion="borrar"');
    }
  });

  it("borrar no pide confirmación: no arma ningún diálogo ni paso intermedio", () => {
    const html = render({ kind: "encontrado", alturaM: 7.4 });
    expect(html).not.toContain("<dialog");
    expect(html).not.toMatch(/data-accion="confirmar/);
  });
});

describe("ayuda de la tarjeta (C7)", () => {
  it("explica los tres pasos y la promesa de privacidad, en todos los estados", () => {
    for (const state of TODOS_LOS_ESTADOS) {
      const html = render(state);
      expect(html).toContain("¿Cómo se usa?");
      expect(html).toContain("Marcar mi casa");
      expect(html).toContain("Tocá tu casa en el mapa");
      expect(html).toContain("sólo en este teléfono");
      expect(html).toContain("No se envía a ningún lado");
    }
  });

  it("va plegada por defecto: <details> sin `open`", () => {
    expect(render({ kind: "sin-punto" })).toMatch(/<details class="mi-casa-ayuda">/);
  });
});
