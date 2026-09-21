import { describe, expect, it } from "vitest";
import { fetchHealth, isHealthResponse, resolveApiUrl } from "./api";
import { describeHealth } from "./health";

const fixedNow = () => new Date("2026-09-21T15:00:00Z");

function fakeFetch(status: number, body: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

describe("resolveApiUrl", () => {
  it("usa /api cuando la variable está vacía o ausente", () => {
    expect(resolveApiUrl(undefined)).toBe("/api");
    expect(resolveApiUrl("")).toBe("/api");
    expect(resolveApiUrl("   ")).toBe("/api");
  });

  it("respeta la URL configurada y le saca la barra final", () => {
    expect(resolveApiUrl("http://localhost:8042/")).toBe("http://localhost:8042");
  });
});

describe("isHealthResponse", () => {
  it("acepta solo el contrato de /health", () => {
    expect(isHealthResponse({ status: "ok", db: "ok" })).toBe(true);
    expect(isHealthResponse({ status: "ok", db: "error" })).toBe(true);
    expect(isHealthResponse({ status: "ok" })).toBe(false);
    expect(isHealthResponse(null)).toBe(false);
  });
});

describe("fetchHealth", () => {
  it("devuelve ready con el cuerpo cuando la API responde", async () => {
    const state = await fetchHealth(fakeFetch(200, { status: "ok", db: "ok" }), "/api", fixedNow);
    expect(state).toEqual({
      kind: "ready",
      health: { status: "ok", db: "ok" },
      checkedAt: fixedNow(),
    });
  });

  it("marca unreachable ante error HTTP, cuerpo inválido o excepción", async () => {
    expect((await fetchHealth(fakeFetch(500, {}), "/api", fixedNow)).kind).toBe("unreachable");
    expect((await fetchHealth(fakeFetch(200, { nope: 1 }), "/api", fixedNow)).kind).toBe("unreachable");
    const throwing: typeof fetch = async () => {
      throw new TypeError("network down");
    };
    expect((await fetchHealth(throwing, "/api", fixedNow)).kind).toBe("unreachable");
  });

  it("pega a <base>/health", async () => {
    let url = "";
    const spy: typeof fetch = async (input) => {
      url = String(input);
      return new Response(JSON.stringify({ status: "ok", db: "ok" }));
    };
    await fetchHealth(spy, "http://api.test", fixedNow);
    expect(url).toBe("http://api.test/health");
  });
});

describe("describeHealth", () => {
  it("traduce cada estado a un texto claro con fecha de actualización", () => {
    expect(describeHealth({ kind: "loading" }).tone).toBe("muted");

    const ok = describeHealth({
      kind: "ready",
      health: { status: "ok", db: "ok" },
      checkedAt: fixedNow(),
    });
    expect(ok.tone).toBe("ok");
    expect(ok.detail).toMatch(/^Actualizado: /);

    const dbDown = describeHealth({
      kind: "ready",
      health: { status: "ok", db: "error" },
      checkedAt: fixedNow(),
    });
    expect(dbDown.tone).toBe("warn");

    expect(describeHealth({ kind: "unreachable", checkedAt: fixedNow() }).tone).toBe("error");
  });
});
