// spec 015, C6/C7: capturas de los tres estados de la tarjeta "Mi casa"
// (sin punto, eligiendo, con punto) a 360 y 1280 px, en ambos temas, y
// medición de lo que no se ve en una captura: overflow horizontal de la
// página y objetivo táctil de 44 px en cada botón.
//
// Uso: node scripts/capturas-mi-casa.mjs   (con `pnpm dev` levantado en 5203)
import { chromium } from "@playwright/test";
const browser = await chromium.launch();
let fallo = false;
for (const [w, h, tema] of [[360,900,"light"],[360,900,"dark"],[1280,900,"light"]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto("http://127.0.0.1:5203", { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => { document.documentElement.setAttribute("data-theme", t);
    localStorage.removeItem("rioaltura-mi-casa"); }, tema);
  await page.waitForSelector(".mapa-inundacion-lienzo", { timeout: 30000 });
  await page.waitForTimeout(2500);
  // Estado 1: sin punto
  await page.locator("#tarjeta-mi-casa").scrollIntoViewIfNeeded();
  await page.locator(".mi-casa-ayuda summary").click();
  await page.waitForTimeout(200);
  await page.locator("#tarjeta-mi-casa").screenshot({ path: `../specs/assets/015/c6-sin-punto-${w}-${tema}.png` });
  await page.locator(".mi-casa-ayuda summary").click();
  // Estado 2: eligiendo (cartel sobre el mapa)
  await page.locator('#tarjeta-mi-casa [data-accion="marcar"]').click();
  await page.waitForTimeout(300);
  await page.locator(".mapa-inundacion-lienzo").screenshot({ path: `../specs/assets/015/c6-eligiendo-${w}-${tema}.png` });
  // Estado 3: con punto
  const box = await page.locator(".mapa-inundacion-lienzo").boundingBox();
  await page.locator(".mapa-inundacion-lienzo").click({ position: { x: Math.round(box.width*0.45), y: Math.round(box.height*0.4) } });
  await page.waitForTimeout(2500);
  await page.locator("#tarjeta-mi-casa").scrollIntoViewIfNeeded();
  await page.locator("#tarjeta-mi-casa").screenshot({ path: `../specs/assets/015/c6-con-punto-${w}-${tema}.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  const btns = await page.evaluate(() => [...document.querySelectorAll("#tarjeta-mi-casa .mi-casa-boton")]
    .map((b) => ({ t: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width) })));
  const hintW = await page.evaluate(() => { const e = document.querySelector(".mi-casa-hint"); return e ? Math.round(e.getBoundingClientRect().width) : -1; });
  console.log(`${w}px ${tema}: overflowH=${overflow} hintAncho=${hintW} botones=${JSON.stringify(btns)}`);
  if (overflow) fallo = true;
  if (btns.some((b) => b.h < 44)) { console.log("  ✗ botón por debajo de 44px de alto"); fallo = true; }
  await page.close();
}
await browser.close();
process.exit(fallo ? 1 : 0);
