import { chromium } from "@playwright/test";
const browser = await chromium.launch();
for (const ancho of [360, 1920]) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: 1000 }, colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto(process.env.URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const r = await page.evaluate(() => {
    const regla = document.querySelector('[class*="regla"]');
    if (!regla) return { error: "no encontré la regla" };
    const marcas = [...regla.querySelectorAll('[class*="marca"], [class*="tick"]')].map((m) => {
      const b = m.getBoundingClientRect();
      return { clase: m.className.toString().slice(0, 30), centroY: +(b.top + b.height / 2).toFixed(1) };
    });
    const etiquetas = [...regla.querySelectorAll('[class*="etiqueta"], [class*="label"]')].map((e) => {
      const b = e.getBoundingClientRect();
      return { texto: e.textContent.trim().slice(0, 34), centroY: +(b.top + b.height / 2).toFixed(1) };
    });
    const barra = regla.querySelector('[class*="barra"], [class*="escala"]')?.getBoundingClientRect();
    return { barra: barra ? { top: +barra.top.toFixed(1), bottom: +barra.bottom.toFixed(1) } : null, marcas, etiquetas };
  });
  console.log(`--- ${ancho}px ---`);
  console.log(JSON.stringify(r, null, 2));
  await ctx.close();
}
await browser.close();
