import { describe, expect, it } from "vitest";
import { guardarPunto, leerPuntoGuardado, type StorageLike } from "./miCasaStorage";

function fakeStorage(inicial: Record<string, string> = {}): StorageLike {
  const datos = { ...inicial };
  return {
    getItem: (key) => datos[key] ?? null,
    setItem: (key, value) => {
      datos[key] = value;
    },
  };
}

function storageQueFalla(): StorageLike {
  return {
    getItem: () => {
      throw new DOMException("blocked", "SecurityError");
    },
    setItem: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  };
}

describe("leerPuntoGuardado", () => {
  it("devuelve null cuando no hay nada guardado", () => {
    expect(leerPuntoGuardado(fakeStorage())).toBeNull();
  });

  it("devuelve el punto guardado", () => {
    const storage = fakeStorage({ "rioaltura-mi-casa": JSON.stringify({ lat: -32.21, lng: -58.14 }) });
    expect(leerPuntoGuardado(storage)).toEqual({ lat: -32.21, lng: -58.14 });
  });

  it("ignora JSON inválido sin lanzar", () => {
    const storage = fakeStorage({ "rioaltura-mi-casa": "{esto no es json" });
    expect(() => leerPuntoGuardado(storage)).not.toThrow();
    expect(leerPuntoGuardado(storage)).toBeNull();
  });

  it("ignora un valor guardado que no tiene forma de PuntoMapa", () => {
    expect(leerPuntoGuardado(fakeStorage({ "rioaltura-mi-casa": JSON.stringify({ lat: "no-numero" }) }))).toBeNull();
    expect(leerPuntoGuardado(fakeStorage({ "rioaltura-mi-casa": JSON.stringify(null) }))).toBeNull();
    expect(leerPuntoGuardado(fakeStorage({ "rioaltura-mi-casa": JSON.stringify({ lat: NaN, lng: 1 }) }))).toBeNull();
  });

  it("nunca lanza si el storage falla (C3, ventana privada / cuota llena)", () => {
    expect(() => leerPuntoGuardado(storageQueFalla())).not.toThrow();
    expect(leerPuntoGuardado(storageQueFalla())).toBeNull();
  });
});

describe("guardarPunto", () => {
  it("guarda el punto elegido", () => {
    const storage = fakeStorage();
    guardarPunto({ lat: -32.21, lng: -58.14 }, storage);
    expect(leerPuntoGuardado(storage)).toEqual({ lat: -32.21, lng: -58.14 });
  });

  it("nunca lanza si el storage falla: la app sigue funcionando (C3)", () => {
    expect(() => {
      guardarPunto({ lat: -32.21, lng: -58.14 }, storageQueFalla());
    }).not.toThrow();
  });
});
