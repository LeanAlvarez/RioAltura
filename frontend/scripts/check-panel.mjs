import { chromium } from "@playwright/test";
const browser = await chromium.launch();
for (const ancho of [360, 768, 1280]) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: 900 }, colorScheme: "light", isMobile: ancho < 768 });
  const page = await ctx.newPage();
  await page.goto(process.env.URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".leaflet-overlay-pane path", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  console.log(`--- ${ancho}px ---`, JSON.stringify(await page.evaluate(() => {
    const det = [...document.querySelectorAll("details")].map((d) => ({
      resumen: d.querySelector("summary")?.textContent?.trim().slice(0, 40),
      abierto: d.open,
      // ¿El summary tiene alguna señal visual de que se abre?
      tieneMarcador: getComputedStyle(d.querySelector("summary"), "::marker").content !== "none"
        || /[▸▾▼►+]/.test(d.querySelector("summary")?.textContent ?? ""),
    }));
    const slider = document.querySelector(".capas-slider");
    return {
      acordeones: det,
      sliderVisible: slider ? slider.getBoundingClientRect().height > 0 : false,
      chipsVisibles: [...document.querySelectorAll(".capas-escenario")].filter(c => c.getBoundingClientRect().height > 0).length,
    };
  }), null, 2));
  await ctx.close();
}
await browser.close();
