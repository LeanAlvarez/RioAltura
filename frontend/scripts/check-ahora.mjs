import { chromium } from "@playwright/test";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
await p.goto(process.env.URL, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(5000);
console.log(JSON.stringify(await p.evaluate(() => ({
  hoy: document.querySelector("#tarjeta-hoy")?.innerText?.replace(/\n+/g, " | ").slice(0, 170),
  proximos: document.querySelector("#tarjeta-proximos")?.innerText?.replace(/\n+/g, " | ").slice(0, 170),
  salud: document.querySelector("#health")?.innerText?.replace(/\n/g, " | "),
})), null, 2));
await b.close();
