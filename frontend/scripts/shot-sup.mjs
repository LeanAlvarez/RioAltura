import { chromium } from "@playwright/test";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "dark", deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto(process.env.URL, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3500);
await p.locator("#tarjeta-superficie").screenshot({ path: `${process.env.OUT}/superficie-1920.png` });
console.log("superficie-1920.png");
await b.close();
