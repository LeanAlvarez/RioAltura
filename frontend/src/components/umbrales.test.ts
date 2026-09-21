import { describe, expect, it } from "vitest";
import { deriveUmbralesView, renderUmbrales } from "./umbrales";
import { proximoUmbral, umbralAlcanzado } from "../domain/umbrales";

function fakeContainer(): HTMLElement {
  return { innerHTML: "", hidden: false } as unknown as HTMLElement;
}


describe("umbralAlcanzado / proximoUmbral", () => {
  it("con el río normal no hay umbral alcanzado y el próximo es la evacuación preventiva", () => {
    expect(umbralAlcanzado(4.29)).toBeNull();
    expect(proximoUmbral(4.29)?.alturaM).toBe(6.8);
  });

  it("devuelve el umbral más alto que el río ya superó", () => {
    expect(umbralAlcanzado(6.8)?.id).toBe("evacuacion_preventiva");
    expect(umbralAlcanzado(7.5)?.id).toBe("alerta");
    expect(umbralAlcanzado(8.0)?.id).toBe("evacuacion");
  });

  it("sin próximo umbral cuando el río los superó a todos", () => {
    expect(proximoUmbral(9.06)).toBeNull();
  });
});

describe("deriveUmbralesView", () => {
  it("muestra el término oficial como subtítulo de la evacuación preventiva", () => {
    const vista = deriveUmbralesView(4.29);
    const preventiva = vista.umbrales[0];
    expect(preventiva?.nombre).toBe("Evacuación preventiva");
    expect(preventiva?.subtitulo).toBe("(evacuación en seco)");
    expect(preventiva?.altura).toBe("6,80 m");
  });

  it("los tres niveles traen su explicación en lenguaje llano", () => {
    const vista = deriveUmbralesView(null);
    expect(vista.umbrales).toHaveLength(3);
    for (const umbral of vista.umbrales) {
      expect(umbral.explicacion.length).toBeGreaterThan(20);
    }
  });

  it("marca los umbrales que el río ya alcanzó", () => {
    const vista = deriveUmbralesView(7.5);
    expect(vista.umbrales.map((u) => u.alcanzado)).toEqual([true, true, false]);
    expect(vista.encabezado).toContain("alerta");
  });

  it("sin altura conocida no marca ninguno", () => {
    const vista = deriveUmbralesView(null);
    expect(vista.umbrales.every((u) => !u.alcanzado)).toBe(true);
  });
});

describe("renderUmbrales", () => {
  it("escribe nombre, subtítulo y explicación de cada nivel", () => {
    const el = fakeContainer();
    renderUmbrales(el, deriveUmbralesView(4.29));
    const texto = el.innerHTML;
    expect(texto).toContain("Evacuación preventiva");
    expect(texto).toContain("(evacuación en seco)");
    expect(texto).toContain("antes de que llegue el agua");
    expect(texto).toContain("6,80 m");
  });
});
