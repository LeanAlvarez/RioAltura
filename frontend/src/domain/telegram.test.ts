import { describe, expect, it } from "vitest";
import {
  buildTelegramCanalUrl,
  buildTelegramDeepLink,
  TELEGRAM_BOT_USERNAME,
  TELEGRAM_CANAL_USERNAME,
  umbralValido,
} from "./telegram";

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
