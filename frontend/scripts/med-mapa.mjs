import { chromium } from "@playwright/test";
const b = await chromium.launch();
for (const w of [1920, 1280]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 1080 }, colorScheme: "dark" });
  const p = await ctx.newPage();
  await p.goto(process.env.URL, { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".leaflet-overlay-pane path", { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(3000);
  console.log(w, JSON.stringify(await p.evaluate(() => {
    const l = document.querySelector(".mapa-inundacion-lienzo")?.getBoundingClientRect();
    const r = document.querySelector(".mapa-inundacion-resumen-wrap")?.getBoundingClientRect();
    const chips = document.querySelector(".capas-escenarios");
    const panel = document.querySelector(".capas-panel");
    return {
      mapa: l ? Math.round(l.width) : null,
      panel: r ? Math.round(r.width) : null,
      panelAbierto: panel?.open ?? null,
      chipsCortadosVerticalmente: chips ? chips.scrollHeight > chips.clientHeight + 1 : null,
    };
  })));
  await ctx.close();
}
await b.close();
