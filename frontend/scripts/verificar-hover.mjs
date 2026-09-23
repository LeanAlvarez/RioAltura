// spec 019: que en cada gráfico se pueda apuntar un día y leer su valor.
// Uso: URL=http://localhost:5235/ node scripts/verificar-hover.mjs
import { chromium } from "@playwright/test";
const URL = process.env.URL ?? "http://localhost:5235/";
let fallo = false;
const ok = (c, m) => { console.log(`${c ? "✓" : "✗"} ${m}`); if (!c) fallo = true; };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
p.on("pageerror", (e) => { console.log("[pageerror]", e.message); fallo = true; });
await p.goto(URL, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(5000);
await p.locator("#contexto-nivel > summary").click();
await p.waitForTimeout(4000);

const graficos = [
  ["#tarjeta-grafico", "#grafico-tooltip", "evolución y pronóstico"],
  ["#tarjeta-historial", "#historial-tooltip", "historial completo"],
  ["#tarjeta-precision", "#precision-tooltip", "precisión del pronóstico"],
  ["#tarjeta-aguas-arriba", "#aguas-arriba-tooltip", "aguas arriba"],
];

for (const [tarjeta, tt, nombre] of graficos) {
  const over = p.locator(`${tarjeta} .u-over`);
  if ((await over.count()) === 0) { ok(false, `${nombre}: no hay gráfico`); continue; }
  // `hover` scrollea solo: con coordenadas absolutas el puntero cae fuera del
  // viewport y el chequeo pasaría en verde sin haber apuntado nada.
  await over.scrollIntoViewIfNeeded();
  await p.waitForTimeout(300);
  const box = await over.boundingBox();
  let textos = [];
  let dentroSiempre = true;
  for (const frac of [0.08, 0.5, 0.95]) {
    await over.hover({ position: { x: Math.round(box.width * frac), y: Math.round(box.height * 0.5) } });
    await p.waitForTimeout(300);
    const r = await p.evaluate((sel) => {
      const t = document.querySelector(sel);
      if (!t || t.hidden) return null;
      const tb = t.getBoundingClientRect(), wb = t.parentElement.getBoundingClientRect();
      return { texto: t.innerText.replace(/\n/g, " · "), dentro: tb.left >= wb.left - 1 && tb.right <= wb.right + 1 };
    }, tt);
    if (r) { textos.push(r.texto); if (!r.dentro) dentroSiempre = false; }
  }
  ok(textos.length > 0, `${nombre}: el tooltip aparece al apuntar`);
  ok(dentroSiempre, `${nombre}: no se sale del lienzo ni en los bordes`);
  if (textos[1]) console.log(`    "${textos[1]}"`);
}

// Con el dedo, en un contexto TÁCTIL de verdad: un TouchEvent sintético en un
// navegador sin soporte táctil no genera los eventos de mouse de
// compatibilidad, así que probaría el test y no la app.
{
  const ctxTactil = await b.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const m = await ctxTactil.newPage();
  await m.goto(URL, { waitUntil: "domcontentloaded" });
  await m.waitForTimeout(5000);
  await m.locator("#contexto-nivel > summary").tap();
  await m.waitForTimeout(4000);
  const overM = m.locator("#tarjeta-historial .u-over");
  await overM.scrollIntoViewIfNeeded();
  await m.waitForTimeout(300);
  const bm = await overM.boundingBox();
  const x = Math.round(bm.x + bm.width * 0.5);
  const y = Math.round(bm.y + bm.height * 0.5);
  // Arrastrar, no tocar: es el gesto con el que se recorre una serie.
  await m.touchscreen.tap(x, y);
  await m.waitForTimeout(500);
  const visto = await m.locator("#historial-tooltip").isVisible();
  ok(visto, "con el dedo el tooltip también aparece");
  if (visto) {
    console.log(`    "${(await m.locator("#historial-tooltip").innerText()).replace(/\n/g, " · ")}"`);
  }
  await ctxTactil.close();
}

await b.close();
console.log(fallo ? "\nHAY FALLAS" : "\nTodo OK");
process.exit(fallo ? 1 : 0);
