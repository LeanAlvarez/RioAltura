/**
 * Spec 013 (D3): verifica la banda "DATOS DE PRUEBA" en distintos anchos y
 * temas, y que el <title> lleve el prefijo (D4).
 *
 * Usage: node scripts/verificar-banda-mock.mjs <url> <esperado: si|no>
 */
import { chromium } from "@playwright/test";

const [url, esperado] = process.argv.slice(2);
if (!url || (esperado !== "si" && esperado !== "no")) {
  console.error("uso: node scripts/verificar-banda-mock.mjs <url> <si|no>");
  process.exit(1);
}
const debeVerse = esperado === "si";

const anchos = [360, 1920];
const temas = ["light", "dark"];

let fallo = false;
const browser = await chromium.launch();

for (const ancho of anchos) {
  for (const tema of temas) {
    const context = await browser.newContext({ viewport: { width: ancho, height: 900 }, colorScheme: tema });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);

    const banner = page.locator("#mock-banner");
    const visible = await banner.isVisible();
    const texto = visible ? await banner.innerText() : "";
    const title = await page.title();

    const etiqueta = `${ancho}px / ${tema}`;
    if (visible !== debeVerse) {
      console.error(`FALLO (${etiqueta}): visible=${visible}, esperado=${debeVerse}`);
      fallo = true;
    } else {
      console.log(`OK (${etiqueta}): visible=${visible}`);
    }
    if (debeVerse && !texto.includes("DATOS DE PRUEBA")) {
      console.error(`FALLO (${etiqueta}): la banda no contiene el texto esperado. Texto: "${texto}"`);
      fallo = true;
    }
    if (debeVerse && !title.startsWith("[DATOS DE PRUEBA]")) {
      console.error(`FALLO (${etiqueta}): el <title> no lleva el prefijo. Title: "${title}"`);
      fallo = true;
    }
    if (!debeVerse && title.startsWith("[DATOS DE PRUEBA]")) {
      console.error(`FALLO (${etiqueta}): el <title> lleva el prefijo sin mocks. Title: "${title}"`);
      fallo = true;
    }

    await context.close();
  }
}

await browser.close();
if (fallo) {
  console.error("Hubo fallos.");
  process.exit(1);
}
console.log("Todo OK.");
