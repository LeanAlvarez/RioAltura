/**
 * Verifica que tocar el toggle de tema redibuja los gráficos de verdad: lee
 * el `background` inline (escrito por JS en cada `dibujar()`, no por CSS)
 * de la muestra de leyenda "Altura real" del gráfico "Evolución", antes y
 * después de tocar el toggle, y confirma que cambió.
 *
 * Usage: node scripts/verificar-tema.mjs <url>
 */
import { chromium } from "@playwright/test";

const [url] = process.argv.slice(2);
if (!url) {
  console.error("uso: node scripts/verificar-tema.mjs <url>");
  process.exit(1);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, colorScheme: "light" });
const page = await context.newPage();
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#tarjeta-grafico .grafico-leyenda li", { timeout: 30_000 });
await page.waitForTimeout(500);

const swatch = page.locator("#tarjeta-grafico .grafico-leyenda-linea").first();
const antes = await swatch.evaluate((el) => el.style.background);
const temaAntes = await page.evaluate(() => document.documentElement.dataset.theme ?? "(sin elegir)");

await page.click("#theme-toggle");
await page.waitForTimeout(300);

const despues = await swatch.evaluate((el) => el.style.background);
const temaDespues = await page.evaluate(() => document.documentElement.dataset.theme ?? "(sin elegir)");

console.log(`tema antes: ${temaAntes}`);
console.log(`swatch "Altura real" antes:   ${antes}`);
console.log(`tema después: ${temaDespues}`);
console.log(`swatch "Altura real" después: ${despues}`);

if (antes === despues) {
  console.error("FALLO: el color de la línea no cambió al tocar el toggle.");
  process.exit(1);
}
console.log("OK: el color de la línea cambió de verdad al redibujar.");

await browser.close();
