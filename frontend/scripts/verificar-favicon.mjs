// spec 026: que el navegador cargue el favicon de verdad, no sólo que esté
// declarado en el <head>. Uso: URL=http://localhost:<WEB_PORT>/ node scripts/verificar-favicon.mjs
import { chromium } from "@playwright/test";
const BASE = process.env.URL ?? "http://localhost:5173/";
let fallo = false;
const ok = (c, m) => { console.log(`${c ? "✓" : "✗"} ${m}`); if (!c) fallo = true; };

const b = await chromium.launch();
const p = await b.newPage();
const pedidos = new Map();
p.on("response", (r) => {
  const u = new URL(r.url());
  if (/favicon|apple-touch/.test(u.pathname)) pedidos.set(u.pathname, r.status());
});
await p.goto(BASE, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3500);

const declarados = await p.evaluate(() =>
  [...document.querySelectorAll('link[rel*="icon"]')].map((l) => ({ rel: l.rel, href: new URL(l.href).pathname })),
);
console.log("declarados:", declarados.map((d) => `${d.rel}→${d.href}`).join("  "));
ok(declarados.length === 3, "hay 3 declaraciones de icono (svg, png, apple-touch)");

// Lo que importa: que respondan 200 de verdad.
for (const ruta of ["/favicon.svg", "/favicon-96.png", "/apple-touch-icon.png"]) {
  const r = await p.request.get(new URL(ruta, BASE).href);
  ok(r.status() === 200, `${ruta} responde ${r.status()}`);
  const tipo = r.headers()["content-type"] ?? "";
  const esperado = ruta.endsWith(".svg") ? "svg" : "png";
  ok(tipo.includes(esperado), `  y con content-type de ${esperado} (${tipo})`);
}

const tc = await p.evaluate(() =>
  [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content),
);
ok(tc.length === 2, `theme-color para los dos temas (${tc.join(", ")})`);

await b.close();
console.log(fallo ? "\nHAY FALLAS" : "\nTodo OK");
process.exit(fallo ? 1 : 0);
