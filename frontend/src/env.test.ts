import { describe, expect, it } from "vitest";
import { resolveUseMocks } from "./env";

// D6 (spec 013): este test tiene que fallar si se rompe D1 — que `PROD` gane
// siempre, sin importar la variable ni ninguna caché.
describe("resolveUseMocks", () => {
  it("en producción es siempre false, aunque la variable diga true", () => {
    expect(resolveUseMocks("true", true)).toBe(false);
    expect(resolveUseMocks("TRUE", true)).toBe(false);
    expect(resolveUseMocks(" true ", true)).toBe(false);
  });

  it("en producción es false también sin variable o con basura", () => {
    expect(resolveUseMocks(undefined, true)).toBe(false);
    expect(resolveUseMocks("", true)).toBe(false);
    expect(resolveUseMocks("1", true)).toBe(false);
  });

  it("fuera de producción respeta la variable", () => {
    expect(resolveUseMocks("true", false)).toBe(true);
    expect(resolveUseMocks("TRUE", false)).toBe(true);
    expect(resolveUseMocks(" true ", false)).toBe(true);
  });

  it("fuera de producción, sin variable o con un valor que no es 'true', es false", () => {
    expect(resolveUseMocks(undefined, false)).toBe(false);
    expect(resolveUseMocks("", false)).toBe(false);
    expect(resolveUseMocks("1", false)).toBe(false);
    expect(resolveUseMocks("false", false)).toBe(false);
  });
});
