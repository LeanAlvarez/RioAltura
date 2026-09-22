import { chromium } from "@playwright/test";
const browser = await chromium.launch();
for (const [ancho, tema] of [[360, "light"], [1920, "dark"]]) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: 1000 }, colorScheme: tema, isMobile: ancho < 768, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(process.env.URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const card = page.locator("#tarjeta-hoy");
  await card.screenshot({ path: `${process.env.OUT}/regla-${ancho}-${tema}.png` });
  console.log(`regla-${ancho}-${tema}.png`);
  await ctx.close();
}
await browser.close();
