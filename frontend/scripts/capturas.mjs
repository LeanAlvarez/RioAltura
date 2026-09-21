/**
 * Full-page screenshots at every breakpoint and in both themes.
 *
 * Usage:
 *   node scripts/capturas.mjs <url> <out-dir> <prefix>
 *
 * Example:
 *   node scripts/capturas.mjs http://localhost:5204/ /tmp/shots antes
 *
 * Produces `<prefix>-<width>-<theme>.png` for each width in ANCHOS and each
 * theme in TEMAS. The map is waited for explicitly: Leaflet keeps fetching
 * tiles, so `networkidle` never settles on this page.
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const ANCHOS = [360, 390, 768, 1280, 1920];
const TEMAS = /** @type {const} */ (["light", "dark"]);

const [url, outDir, prefix] = process.argv.slice(2);
if (!url || !outDir || !prefix) {
  console.error("uso: node scripts/capturas.mjs <url> <out-dir> <prefix>");
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();

for (const tema of TEMAS) {
  for (const ancho of ANCHOS) {
    const context = await browser.newContext({
      viewport: { width: ancho, height: 900 },
      deviceScaleFactor: 1,
      colorScheme: tema,
      isMobile: ancho < 768,
      hasTouch: ancho < 768,
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });

    // The flood layer is the last thing to paint; without it the map is bare.
    await page
      .waitForSelector(".leaflet-overlay-pane path", { timeout: 30_000 })
      .catch(() => console.warn(`  (${ancho}/${tema}) sin capa del mapa`));
    await page.waitForTimeout(3000);

    const archivo = join(outDir, `${prefix}-${ancho}-${tema}.png`);
    await page.screenshot({ path: archivo, fullPage: true });
    console.log(`${prefix}-${ancho}-${tema}.png`);
    await context.close();
  }
}

await browser.close();
