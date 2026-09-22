import { chromium } from "@playwright/test";
const b = await chromium.launch();
for (const w of [1920, 1280]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 1000 }, colorScheme: "dark" });
  const p = await ctx.newPage();
  await p.goto(process.env.URL, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3500);
  console.log(w, JSON.stringify(await p.evaluate(() => {
    const svg = document.querySelector(".superficie-svg");
    const r = svg?.getBoundingClientRect();
    return { viewBox: svg?.getAttribute("viewBox"), ancho: Math.round(r?.width ?? 0), alto: Math.round(r?.height ?? 0),
             relacion: r ? +(r.width / r.height).toFixed(2) : null };
  })));
  await ctx.close();
}
await b.close();
