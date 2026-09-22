import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "dark" });
const page = await ctx.newPage();
await page.goto(process.env.URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".leaflet-overlay-pane path", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(3000);

const r = await page.evaluate(() => {
  const cortados = [...document.querySelectorAll("*")]
    .filter((e) => e.children.length === 0 && e.textContent?.trim())
    .filter((e) => e.scrollWidth > e.clientWidth + 1)
    .map((e) => ({ clase: e.className?.toString().slice(0, 40), texto: e.textContent.trim().slice(0, 30) }));
  const svgTextos = [...document.querySelectorAll(".superficie-svg text")].map((t) => t.textContent);
  const chips = document.querySelector(".capas-escenarios");
  return {
    textosCortados: cortados.slice(0, 8),
    etiquetasSuperficie: svgTextos,
    chipsScrollable: chips ? { scrollW: chips.scrollWidth, clientW: chips.clientWidth, overflowX: getComputedStyle(chips).overflowX } : null,
    margenIzq: document.querySelector(".dashboard")?.getBoundingClientRect().left,
    anchoUsado: document.querySelector(".dashboard")?.getBoundingClientRect().width,
  };
});
console.log(JSON.stringify(r, null, 2));
await browser.close();
