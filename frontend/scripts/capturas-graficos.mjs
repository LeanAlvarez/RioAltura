/**
 * Capturas por-gráfico (no de la página completa), en los dos temas y dos
 * anchos, para la verificación de la paleta v3 (reactividad al tema,
 * contraste, leyendas). Copia adaptada de `capturas.mjs` (no se toca ese
 * archivo: se usa para comparar antes/después de otras tareas).
 *
 * Usage:
 *   node scripts/capturas-graficos.mjs <url> <out-dir> <prefix>
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const ANCHOS = [390, 1440];
const TEMAS = /** @type {const} */ (["light", "dark"]);
const TARJETAS = [
  { id: "tarjeta-grafico", nombre: "evolucion" },
  { id: "tarjeta-historial", nombre: "historial" },
  { id: "tarjeta-precision", nombre: "precision" },
  { id: "tarjeta-aguas-arriba", nombre: "aguas-arriba" },
];

const [url, outDir, prefix] = process.argv.slice(2);
if (!url || !outDir || !prefix) {
  console.error("uso: node scripts/capturas-graficos.mjs <url> <out-dir> <prefix>");
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();

for (const tema of TEMAS) {
  for (const ancho of ANCHOS) {
    const context = await browser.newContext({
      viewport: { width: ancho, height: 1200 },
      deviceScaleFactor: 1,
      colorScheme: tema,
      isMobile: ancho < 768,
      hasTouch: ancho < 768,
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#tarjeta-grafico .grafico-leyenda li", { timeout: 30_000 });
    await page.waitForSelector("#tarjeta-historial .grafico-leyenda li", { timeout: 30_000 });
    await page.waitForSelector("#tarjeta-precision .grafico-leyenda li", { timeout: 30_000 });
    await page.waitForTimeout(800);

    for (const { id, nombre } of TARJETAS) {
      const locator = page.locator(`#${id}`);
      const archivo = join(outDir, `${prefix}-${nombre}-${ancho}-${tema}.png`);
      await locator.screenshot({ path: archivo });
      console.log(`${prefix}-${nombre}-${ancho}-${tema}.png`);
    }

    await context.close();
  }
}

await browser.close();
