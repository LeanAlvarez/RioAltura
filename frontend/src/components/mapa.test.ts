import { describe, expect, it, vi } from "vitest";
import { mountMapa, type MapModule } from "./mapa";

function fakeContainer(): HTMLElement {
  return { innerHTML: "" } as unknown as HTMLElement;
}

describe("mountMapa", () => {
  it("degrada con un placeholder cuando el módulo no existe (import falla)", async () => {
    const container = fakeContainer();
    await mountMapa(container, 5.5, () => Promise.reject(new Error("no module")));
    expect(container.innerHTML).toContain("mapa de inundación");
  });

  it("degrada con un placeholder cuando el módulo no expone createMap", async () => {
    const container = fakeContainer();
    const mod: MapModule = {};
    await mountMapa(container, 5.5, () => Promise.resolve(mod));
    expect(container.innerHTML).toContain("mapa de inundación");
  });

  it("monta el mapa y no llama setNivelPronosticado si el módulo no lo expone", async () => {
    const container = fakeContainer();
    const createMap = vi.fn();
    const mod: MapModule = { createMap };
    await mountMapa(container, 5.5, () => Promise.resolve(mod));
    expect(createMap).toHaveBeenCalledWith(container);
    expect(container.innerHTML).toBe("");
  });

  it("monta el mapa y llama setNivelPronosticado con la altura máxima cuando existe", async () => {
    const container = fakeContainer();
    const createMap = vi.fn();
    const setNivelPronosticado = vi.fn();
    const mod: MapModule = { createMap, setNivelPronosticado };
    await mountMapa(container, 6.5, () => Promise.resolve(mod));
    expect(createMap).toHaveBeenCalledWith(container);
    expect(setNivelPronosticado).toHaveBeenCalledWith(6.5);
  });

  it("no llama setNivelPronosticado cuando no hay nivel estimado (null)", async () => {
    const container = fakeContainer();
    const setNivelPronosticado = vi.fn();
    const mod: MapModule = { createMap: vi.fn(), setNivelPronosticado };
    await mountMapa(container, null, () => Promise.resolve(mod));
    expect(setNivelPronosticado).not.toHaveBeenCalled();
  });

  it("no rompe si setNivelPronosticado tira una excepción", async () => {
    const container = fakeContainer();
    const mod: MapModule = {
      createMap: vi.fn(),
      setNivelPronosticado: () => {
        throw new Error("boom");
      },
    };
    await expect(mountMapa(container, 5.5, () => Promise.resolve(mod))).resolves.toBeUndefined();
  });
});
