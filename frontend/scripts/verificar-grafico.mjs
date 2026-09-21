import { chromium } from "@playwright/test";

const url = process.env.URL ?? "http://localhost:5204/";
const browser = await chromium.launch();

for (const ancho of [360, 1920]) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: 1000 }, colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  const r = await page.evaluate(() => {
    const canvasWrap = document.querySelector("#tarjeta-grafico .grafico-canvas-wrap");
    const wrapRect = canvasWrap?.getBoundingClientRect();
    const xLabels = [...document.querySelectorAll("#tarjeta-grafico .u-axis text")]
      .map((t) => ({ texto: t.textContent, rect: t.getBoundingClientRect() }))
      .filter((t) => t.texto && wrapRect && t.rect.top < wrapRect.top + 300); // rough: x-axis is near bottom-ish; keep all, filter later
    const cortadoDerecha = xLabels.filter((t) => wrapRect && t.rect.right > wrapRect.right + 1);
    const umbrales = [...document.querySelectorAll(".grafico-umbral-etiqueta")].map((el) => ({
      texto: el.textContent,
      empiezaConNumero: /^\d/.test(el.textContent.trim()),
      cortado: el.scrollWidth > el.clientWidth + 1,
    }));
    return {
      wrapRight: wrapRect ? +wrapRect.right.toFixed(1) : null,
      totalEtiquetasEje: xLabels.length,
      etiquetasCortadasADerecha: cortadoDerecha.map((t) => ({ texto: t.texto, right: +t.rect.right.toFixed(1) })),
      umbrales,
    };
  });

  console.log(`\n=== ${ancho}px ===`);
  console.log(JSON.stringify(r, null, 2));
  await ctx.close();
}
await browser.close();
