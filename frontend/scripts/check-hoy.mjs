import { chromium } from "@playwright/test";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
await p.goto(process.env.URL, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(4000);
console.log(JSON.stringify(await p.evaluate(() => {
  const filas = [...document.querySelectorAll("#tarjeta-proximos tr, #tarjeta-proximos li")]
    .map((f) => f.innerText.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 3);
  return {
    tarjetaHoy: document.querySelector("#tarjeta-hoy")?.innerText?.replace(/\n/g, " | ").slice(0, 150),
    primerasFilas: filas,
    diceMedido: document.querySelector("#tarjeta-proximos")?.innerText?.includes("medido") ?? null,
  };
}), null, 2));
await b.close();
