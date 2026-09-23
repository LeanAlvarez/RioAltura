import { describe, expect, it } from "vitest";
import { DISCLAIMER_MI_CASA, deriveMiCasaView, type MiCasaState } from "../domain/miCasa";
import { partesMiCasa, renderEstructuraMiCasa } from "./miCasa";

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

function partes(state: MiCasaState) {
  return partesMiCasa(deriveMiCasaView(state));
}

/** Lo que se repinta en cada cambio de estado, todo junto. */
function render(state: MiCasaState): string {
  const p = partes(state);
  return p.cuerpo + p.disclaimer + p.acciones;
}

describe("partesMiCasa", () => {
  it("sin-punto: invita a marcar, sin disclaimer (todavía no hay respuesta)", () => {
    const html = render({ kind: "sin-punto" });
    expect(html).toContain("Marcá tu casa en el mapa");
    expect(html).not.toContain(DISCLAIMER_MI_CASA);
  });

  it("eligiendo: pide el click en el mapa y todavía no muestra el disclaimer", () => {
    const html = render({ kind: "eligiendo" });
    expect(html).toContain("Tocá tu casa en el mapa");
    expect(html).not.toContain(DISCLAIMER_MI_CASA);
  });

  it("calculando: no muestra el disclaimer todavía (no hay respuesta)", () => {
    expect(render({ kind: "calculando" })).not.toContain(DISCLAIMER_MI_CASA);
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

  it("error: se anuncia como alerta, no como estado", () => {
    expect(partes({ kind: "error" }).rol).toBe("alert");
    expect(render({ kind: "error" })).toContain(DISCLAIMER_MI_CASA);
  });

  it("el resto de los estados se anuncian como estado", () => {
    for (const state of TODOS_LOS_ESTADOS.filter((s) => s.kind !== "error")) {
      expect(partes(state).rol).toBe("status");
    }
  });

  it("el disclaimer nunca tiene forma de cerrarse: su bloque no lleva ningún control (C5)", () => {
    // Desde C6 la tarjeta SÍ tiene botones (marcar / elegir otro / borrar).
    // Lo que la spec prohíbe es cerrar el disclaimer, así que el invariante
    // se mide sobre su propio pedazo, que ahora viene separado.
    for (const state of TODOS_LOS_ESTADOS) {
      const p = partes(state);
      expect(p.disclaimer).not.toContain("<button");
      expect(p.disclaimer).not.toMatch(/<a\b/);
      expect(p.acciones).not.toMatch(/data-accion="(cerrar|ocultar)"/);
    }
  });

  it("nunca hay una respuesta sin su disclaimer al lado (C5)", () => {
    for (const state of TODOS_LOS_ESTADOS) {
      const p = partes(state);
      const ofreceBorrar = p.acciones.includes('data-accion="borrar"');
      expect(ofreceBorrar).toBe(p.disclaimer !== "");
    }
  });
});

describe("acciones de la tarjeta (C6)", () => {
  it("sin punto marcado: ofrece marcar, y nada que borrar", () => {
    const { acciones } = partes({ kind: "sin-punto" });
    expect(acciones).toContain('data-accion="marcar"');
    expect(acciones).toContain("Marcar mi casa");
    expect(acciones).not.toContain('data-accion="borrar"');
  });

  it("eligiendo: sólo se puede cancelar", () => {
    const { acciones } = partes({ kind: "eligiendo" });
    expect(acciones).toContain('data-accion="cancelar"');
    expect(acciones).not.toContain('data-accion="marcar"');
    expect(acciones).not.toContain('data-accion="borrar"');
  });

  it("calculando: ninguna acción mientras busca", () => {
    expect(partes({ kind: "calculando" }).acciones).toBe("");
  });

  it("con punto marcado: se puede cambiar y borrar, incluso si el cálculo falló", () => {
    for (const state of [
      { kind: "encontrado", alturaM: 7.4 },
      { kind: "ya-inundado", alturaM: 3.0 },
      { kind: "seco", alturaMaximaModeladaM: 20.0 },
      { kind: "fuera-de-area" },
      { kind: "error" },
    ] as MiCasaState[]) {
      const { acciones } = partes(state);
      expect(acciones).toContain('data-accion="marcar"');
      expect(acciones).toContain("Elegir otro punto");
      expect(acciones).toContain('data-accion="borrar"');
    }
  });

  it("borrar no pide confirmación: no arma ningún diálogo ni paso intermedio", () => {
    const { acciones } = partes({ kind: "encontrado", alturaM: 7.4 });
    expect(acciones).not.toContain("<dialog");
    expect(acciones).not.toMatch(/data-accion="confirmar/);
  });
});

describe("armazón de la tarjeta (C7 y accesibilidad)", () => {
  const estructura = renderEstructuraMiCasa();

  it("explica los tres pasos y la promesa de privacidad", () => {
    expect(estructura).toContain("¿Cómo se usa?");
    expect(estructura).toContain("Marcar mi casa");
    expect(estructura).toContain("Tocá tu casa en el mapa");
    expect(estructura).toContain("sólo en este teléfono");
    expect(estructura).toContain("No se envía a ningún lado");
  });

  it("la ayuda va plegada por defecto: <details> sin `open`", () => {
    expect(estructura).toMatch(/<details class="mi-casa-ayuda">/);
  });

  it("la ayuda NO se repinta en cada cambio de estado: así no se pliega sola", () => {
    // Es el defecto que tenía la versión anterior: el vecino abría la ayuda,
    // leía el paso 1, lo ejecutaba, y la ayuda se cerraba justo antes de los
    // pasos 2 y 3. Vive en el armazón, que se escribe una sola vez.
    for (const state of TODOS_LOS_ESTADOS) {
      const p = partes(state);
      const repintado = p.cuerpo + p.disclaimer + p.acciones;
      expect(repintado).not.toContain("¿Cómo se usa?");
      expect(repintado).not.toContain("<details");
    }
  });

  it("la región que anuncia la respuesta existe desde el arranque y vacía", () => {
    // Un `aria-live` que nace con texto adentro no lo anuncia: el nodo tiene
    // que estar en el DOM antes de que llegue el contenido.
    expect(estructura).toMatch(/<div class="mi-casa-resultado" role="status" aria-live="polite"><\/div>/);
  });
});
