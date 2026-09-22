import { describe, expect, it } from "vitest";
import { MOCK_BANNER_TEXTO, mountMockBanner } from "./mockBanner";

function fakeContainer(): HTMLElement {
  return { innerHTML: "", hidden: false } as unknown as HTMLElement;
}

describe("mountMockBanner", () => {
  it("no muestra nada cuando los mocks están apagados", () => {
    const el = fakeContainer();
    mountMockBanner(el, false);
    expect(el.hidden).toBe(true);
    expect(el.innerHTML).toBe("");
  });

  // D6 (spec 013): defiende que la banda efectivamente se renderiza cuando
  // los mocks están activos.
  it("muestra la banda de datos de prueba cuando los mocks están activos", () => {
    const el = fakeContainer();
    mountMockBanner(el, true);
    expect(el.hidden).toBe(false);
    expect(el.innerHTML).toContain(MOCK_BANNER_TEXTO);
  });
});
