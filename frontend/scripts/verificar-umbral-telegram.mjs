// spec 021: que se pueda escribir una altura con coma desde un celular.
// Uso: URL=http://localhost:5211/ node scripts/verificar-umbral-telegram.mjs
import { chromium } from "@playwright/test";
const URL = process.env.URL ?? "http://localhost:5211/";
let fallo = false;
const ok = (c, m) => { console.log(`${c ? "✓" : "✗"} ${m}`); if (!c) fallo = true; };

const b = await chromium.launch();
// Contexto de celular: es donde apareció el bug.
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => { console.log("[pageerror]", e.message); fallo = true; });
await p.goto(URL, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(5000);

const input = p.locator("#telegram-umbral-input");
await input.scrollIntoViewIfNeeded();

ok((await input.getAttribute("type")) === "text", 'el campo es type="text", no "number"');
ok((await input.getAttribute("inputmode")) === "decimal", 'inputmode="decimal": sigue dando teclado numérico');

// Lo decisivo: que el texto con coma NO se pierda.
await input.fill("");
await input.type("7,12");
const valor = await input.inputValue();
ok(valor === "7,12", `la coma sobrevive en el campo (leído: "${valor}")`);

// Y que el link salga bien armado.
const linkPromise = ctx.waitForEvent("page", { timeout: 8000 }).catch(() => null);
await p.locator(".telegram-umbral-form button[type=submit]").click();
const nueva = await linkPromise;
if (nueva) {
  const url = nueva.url();
  ok(url.includes("start=712"), `7,12 -> ?start=712  (${url.split("?")[1] ?? url})`);
  await nueva.close();
} else { ok(false, "no se abrió el link de Telegram"); }

// El caso reportado: sin coma, se escribe 712.
await input.fill("");
await input.type("712");
await p.locator(".telegram-umbral-form button[type=submit]").click();
await p.waitForTimeout(400);
const err = await p.locator(".telegram-umbral-error").innerText();
console.log(`    error mostrado: "${err}"`);
ok(err.includes("7,12"), "con 712 el error sugiere 7,12 en vez de repetir el rango");

await b.close();
console.log(fallo ? "\nHAY FALLAS" : "\nTodo OK");
process.exit(fallo ? 1 : 0);
