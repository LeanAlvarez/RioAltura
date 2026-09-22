import { chromium } from "@playwright/test";
const browser = await chromium.launch();
for (const ancho of [360, 768, 1280, 1920]) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: 1000 }, colorScheme: "light", isMobile: ancho < 768 });
  const page = await ctx.newPage();
  await page.goto(process.env.URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => {
    const regla = document.querySelector('[class*="regla"]');
    const barra = regla?.querySelector('[class*="regla-marcas"]')?.getBoundingClientRect();
    const filas = [...regla.querySelectorAll('[class*="regla-marca-tick"]')].map((tick, i) => {
      const textos = [...regla.querySelectorAll('[class*="regla-marca-texto"]')];
      const t = tick.getBoundingClientRect(), x = textos[i]?.getBoundingClientRect();
      return {
        texto: textos[i]?.textContent?.trim().slice(0, 26),
        desfase: x ? +((x.top + x.height / 2) - (t.top + t.height / 2)).toFixed(1) : null,
        tickDentroDeBarra: barra ? t.top >= barra.top - 1 && t.bottom <= barra.bottom + 1 : null,
        textoDentroDeBarra: barra && x ? x.top >= barra.top - 1 && x.bottom <= barra.bottom + 1 : null,
      };
    });
    return { guias: regla.querySelectorAll('line, [class*="guia"]').length, filas };
  });
  console.log(`--- ${ancho}px --- guías: ${r.guias}`);
  for (const f of r.filas) console.log(`   ${String(f.texto).padEnd(26)} desfase ${String(f.desfase).padStart(7)}  tick dentro: ${f.tickDentroDeBarra}  texto dentro: ${f.textoDentroDeBarra}`);
  await ctx.close();
}
await browser.close();
