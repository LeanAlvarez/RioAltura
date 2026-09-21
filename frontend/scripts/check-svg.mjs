import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "dark" });
const page = await ctx.newPage();
await page.goto(process.env.URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".superficie-svg text", { timeout: 30000 });
await page.waitForTimeout(2500);
console.log(JSON.stringify(await page.evaluate(() => {
  const svg = document.querySelector(".superficie-svg");
  const vb = svg.getAttribute("viewBox");
  // In SVG the honest test is the text's own bounding box against the viewBox
  // origin: a label that starts at a negative x is painted outside and clipped.
  return {
    viewBox: vb,
    etiquetas: [...svg.querySelectorAll("text")].map((t) => {
      const b = t.getBBox();
      return { texto: t.textContent, x: +b.x.toFixed(1), derecha: +(b.x + b.width).toFixed(1), cortada: b.x < 0 };
    }),
  };
}), null, 2));
await browser.close();
