import { describe, expect, it } from "vitest";
import { deriveQueHacerView, renderQueHacer, type QueHacerDeps } from "./queHacer";
import { INDICACIONES, QUE_HACER_HABILITADO, TELEFONOS } from "../config/queHacer";

function fakeContainer(): HTMLElement {
  return { innerHTML: "", hidden: false } as unknown as HTMLElement;
}


const CON_CONTENIDO: QueHacerDeps = {
  habilitado: true,
  indicaciones: [
    { nivel: "atencion", titulo: "Qué hacer ahora", pasos: ["Primer paso", "Segundo paso"] },
  ],
  telefonos: [{ nombre: "Defensa Civil", numero: "000-000" }],
};

describe("config/queHacer", () => {
  it("está apagado y sin teléfonos hasta que lo confirme la Municipalidad", () => {
    expect(QUE_HACER_HABILITADO).toBe(false);
    expect(TELEFONOS).toHaveLength(0);
    expect(INDICACIONES).toHaveLength(0);
  });
});

describe("deriveQueHacerView", () => {
  it("es null con el flag apagado, aunque haya contenido cargado", () => {
    expect(deriveQueHacerView("atencion", { ...CON_CONTENIDO, habilitado: false })).toBeNull();
  });

  it("es null si no hay indicaciones confirmadas para ese nivel", () => {
    expect(deriveQueHacerView("alerta_probable", CON_CONTENIDO)).toBeNull();
  });

  it("devuelve los pasos y teléfonos del nivel cuando está habilitado", () => {
    expect(deriveQueHacerView("atencion", CON_CONTENIDO)).toEqual({
      titulo: "Qué hacer ahora",
      pasos: ["Primer paso", "Segundo paso"],
      telefonos: [{ nombre: "Defensa Civil", numero: "000-000" }],
    });
  });

  it("con la configuración real del repo no muestra nada", () => {
    expect(deriveQueHacerView("atencion")).toBeNull();
  });
});

describe("renderQueHacer", () => {
  it("deja el contenedor vacío y oculto cuando no hay vista", () => {
    const el = fakeContainer();
    renderQueHacer(el, null);
    expect(el.innerHTML).toBe("");
    expect(el.hidden).toBe(true);
  });

  it("renderiza los pasos cuando hay vista", () => {
    const el = fakeContainer();
    renderQueHacer(el, deriveQueHacerView("atencion", CON_CONTENIDO));
    expect(el.hidden).toBe(false);
    expect(el.innerHTML).toContain("Primer paso");
    expect(el.innerHTML).toContain("Defensa Civil");
  });
});
