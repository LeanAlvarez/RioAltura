import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "dark" });
const page = await ctx.newPage();
await page.goto(process.env.URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".leaflet-overlay-pane path", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(3000);
// Reproducir el caso del usuario: slider arrastrado a 17 m.
await page.evaluate(() => {
  const s = document.querySelector(".capas-slider");
  s.value = "17"; s.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(2500);
console.log(JSON.stringify(await page.evaluate(() => {
  const lienzo = document.querySelector(".mapa-inundacion-lienzo")?.getBoundingClientRect();
  const card = document.querySelector("#tarjeta-mapa")?.getBoundingClientRect();
  return {
    anchoLienzo: lienzo ? Math.round(lienzo.width) : null,
    anchoTarjeta: card ? Math.round(card.width) : null,
    porcentajeQueUsaElMapa: lienzo && card ? Math.round((lienzo.width / card.width) * 100) : null,
    textoResumen: document.querySelector(".mapa-inundacion-resumen-wrap")?.innerText?.replace(/\n/g, " | ").slice(0, 160),
  };
}), null, 2));
await page.screenshot({ path: `${process.env.OUT}/mapa-1920-17m.png`, fullPage: false });
await browser.close();
