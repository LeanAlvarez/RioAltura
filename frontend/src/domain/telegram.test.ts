import { describe, expect, it } from "vitest";
import { TELEGRAM_BOT_USERNAME, TELEGRAM_CANAL_USERNAME, buildTelegramCanalUrl, buildTelegramDeepLink, mensajeUmbralInvalido, umbralValido } from "./telegram";

describe("buildTelegramDeepLink", () => {
  it("codifica el umbral en centímetros enteros", () => {
    expect(buildTelegramDeepLink(4.44)).toBe(`https://t.me/${TELEGRAM_BOT_USERNAME}?start=444`);
    expect(buildTelegramDeepLink(7.1)).toBe(`https://t.me/${TELEGRAM_BOT_USERNAME}?start=710`);
  });

  it("redondea a centímetros cuando hay más de dos decimales", () => {
    expect(buildTelegramDeepLink(4.456)).toBe(`https://t.me/${TELEGRAM_BOT_USERNAME}?start=446`);
  });
});

describe("buildTelegramCanalUrl", () => {
  it("apunta al canal público", () => {
    expect(buildTelegramCanalUrl()).toBe(`https://t.me/${TELEGRAM_CANAL_USERNAME}`);
  });
});

describe("umbralValido", () => {
  it("acepta valores dentro de rango", () => {
    expect(umbralValido(4.44)).toBe(true);
    expect(umbralValido(0.01)).toBe(true);
    expect(umbralValido(15)).toBe(true);
  });

  it("rechaza cero, negativos, NaN y valores fuera de rango", () => {
    expect(umbralValido(0)).toBe(false);
    expect(umbralValido(-1)).toBe(false);
    expect(umbralValido(Number.NaN)).toBe(false);
    expect(umbralValido(15.01)).toBe(false);
  });
});

describe("mensajeUmbralInvalido", () => {
  it("sugiere la coma cuando el teclado del celular no la ofreció", () => {
    // El caso real reportado: se quiso escribir 7,12 y salió 712.
    const msg = mensajeUmbralInvalido("712");
    expect(msg).toContain("7,12");
  });

  it("sirve también para 4 dígitos", () => {
    expect(mensajeUmbralInvalido("1050")).toContain("10,50");
  });

  it("dice que nunca llegó a esa altura, en vez de un rango abstracto", () => {
    expect(mensajeUmbralInvalido("712")).toContain("nunca llegó");
  });

  it("con el campo vacío pide la altura, sin retar", () => {
    const msg = mensajeUmbralInvalido("");
    expect(msg).toContain("Escribí");
    expect(msg).toContain("7,12");
  });

  it("con texto que no es número lo dice sin jerga", () => {
    expect(mensajeUmbralInvalido("hola")).toContain("no es un número");
  });

  it("acepta coma y punto por igual: ninguno de los dos es inválido", () => {
    expect(umbralValido(Number("7,12".replace(",", ".")))).toBe(true);
    expect(umbralValido(Number("7.12"))).toBe(true);
  });
});
