import { describe, expect, it } from "vitest";
import { renderAvisosTelegram } from "./avisosTelegram";
import { TELEGRAM_BOT_USERNAME, TELEGRAM_CANAL_USERNAME } from "../domain/telegram";

function fakeContainer(): HTMLElement {
  return { innerHTML: "" } as unknown as HTMLElement;
}

describe("renderAvisosTelegram", () => {
  it("linkea al canal público", () => {
    const container = fakeContainer();
    renderAvisosTelegram(container);
    expect(container.innerHTML).toContain(`https://t.me/${TELEGRAM_CANAL_USERNAME}`);
  });

  it("incluye el formulario de umbral propio, sin action (nunca hace POST)", () => {
    const container = fakeContainer();
    renderAvisosTelegram(container);
    expect(container.innerHTML).toContain('class="telegram-umbral-form"');
    expect(container.innerHTML).not.toContain("action=");
    expect(container.innerHTML).not.toContain(TELEGRAM_BOT_USERNAME);
  });

  it("aclara que no se manda nada a nuestro servidor y cómo darse de baja", () => {
    const container = fakeContainer();
    renderAvisosTelegram(container);
    expect(container.innerHTML).toContain("No mandamos nada a nuestro servidor");
    expect(container.innerHTML).toContain("/baja");
  });
});
