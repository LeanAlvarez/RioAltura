import { describe, expect, it } from "vitest";
import {
  alternarTema,
  guardarTemaElegido,
  leerTemaGuardado,
  notificarCambioTema,
  onTemaCambia,
  resolverTemaInicial,
  type StorageLike,
} from "./theme";

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

describe("leerTemaGuardado", () => {
  it("devuelve null cuando no hay nada guardado", () => {
    expect(leerTemaGuardado(fakeStorage())).toBeNull();
  });

  it("devuelve el tema guardado", () => {
    expect(leerTemaGuardado(fakeStorage({ "rioaltura-tema": "dark" }))).toBe("dark");
  });

  it("ignora un valor guardado que no es un tema válido", () => {
    expect(leerTemaGuardado(fakeStorage({ "rioaltura-tema": "azul" }))).toBeNull();
  });

  it("nunca lanza si el storage falla (ventana privada, cookies bloqueadas) — T2", () => {
    expect(() => leerTemaGuardado(storageQueFalla())).not.toThrow();
    expect(leerTemaGuardado(storageQueFalla())).toBeNull();
  });
});

describe("guardarTemaElegido", () => {
  it("guarda el tema elegido", () => {
    const storage = fakeStorage();
    guardarTemaElegido("dark", storage);
    expect(leerTemaGuardado(storage)).toBe("dark");
  });

  it("nunca lanza si el storage falla — T2", () => {
    expect(() => {
      guardarTemaElegido("dark", storageQueFalla());
    }).not.toThrow();
  });
});

describe("resolverTemaInicial", () => {
  it("usa lo guardado, aunque el sistema prefiera lo contrario", () => {
    expect(resolverTemaInicial(fakeStorage({ "rioaltura-tema": "light" }), true)).toBe("light");
  });

  it("sin nada guardado, sigue prefers-color-scheme del sistema", () => {
    expect(resolverTemaInicial(fakeStorage(), true)).toBe("dark");
    expect(resolverTemaInicial(fakeStorage(), false)).toBe("light");
  });

  it("si el storage falla, igual resuelve por el sistema (T2)", () => {
    expect(resolverTemaInicial(storageQueFalla(), true)).toBe("dark");
  });
});

describe("alternarTema", () => {
  it("invierte el tema", () => {
    expect(alternarTema("dark")).toBe("light");
    expect(alternarTema("light")).toBe("dark");
  });
});

describe("onTemaCambia / notificarCambioTema", () => {
  it("notifica a todos los suscriptos con el tema nuevo", () => {
    const recibidos: string[] = [];
    const desuscribir1 = onTemaCambia((tema) => recibidos.push(`uno:${tema}`));
    const desuscribir2 = onTemaCambia((tema) => recibidos.push(`dos:${tema}`));

    notificarCambioTema("dark");

    expect(recibidos).toEqual(["uno:dark", "dos:dark"]);
    desuscribir1();
    desuscribir2();
  });

  it("la función devuelta desuscribe: ese oyente no recibe más notificaciones (sin memory leaks)", () => {
    const recibidos: string[] = [];
    const desuscribir = onTemaCambia((tema) => recibidos.push(tema));

    desuscribir();
    notificarCambioTema("light");

    expect(recibidos).toEqual([]);
  });

  it("desuscribir dos veces no lanza", () => {
    const desuscribir = onTemaCambia(() => {});
    expect(() => {
      desuscribir();
      desuscribir();
    }).not.toThrow();
  });
});
