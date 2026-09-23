// spec 018: capturas y mediciones de la UI v4 en los cuatro anchos y los dos
// temas. Mide lo que una captura no muestra: qué se ve sin scrollear, si el
// contexto arranca plegado, y si hay overflow horizontal.
//
// Uso: URL=http://localhost:<WEB_PORT>/ node scripts/capturas-ui-v4.mjs
import { chromium } from "@playwright/test";
const URL = process.env.URL ?? `http://localhost:/`;
const b = await chromium.launch();
let fallo = false;
for (const [w, h] of [[360, 780], [390, 844], [768, 1000], [1280, 900]]) {
  for (const tema of ["light", "dark"]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    p.on("pageerror", (e) => { console.log("[pageerror]", e.message); fallo = true; });
    await p.goto(URL, { waitUntil: "domcontentloaded" });
    await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), tema);
    await p.waitForTimeout(5000);
    const m = await p.evaluate((alto) => {
      const dentro = (el) => { const r = el.getBoundingClientRect(); return r.top < alto && r.bottom > 0; };
      const nombre = (el) => el.id || el.tagName.toLowerCase();
      return {
        sinScroll: [...document.querySelectorAll("main > section, main > details")].filter(dentro).map(nombre),
        plegado: !document.querySelector("#contexto-nivel")?.open,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        fuente: getComputedStyle(document.body).fontFamily.split(",")[0].replace(/"/g, ""),
      };
    }, h);
    if (tema === "light") console.log(`${w}px  sin scrollear: ${m.sinScroll.join(", ") || "(nada)"}`);
    if (m.overflow) { console.log(`  ✗ ${w}px ${tema}: overflow horizontal`); fallo = true; }
    if (!m.plegado) { console.log(`  ✗ ${w}px ${tema}: el contexto NO arranca plegado`); fallo = true; }
    if (m.fuente !== "Atkinson Hyperlegible") { console.log(`  ✗ fuente: ${m.fuente}`); fallo = true; }
    await p.screenshot({ path: `../specs/assets/018/v4-${w}-${tema}.png`, fullPage: false });
    await p.close();
  }
}
// --- D2: un día tranquilo es un día gris --------------------------------
// Se fuerza cada estado en el atributo que escribe `estadoHoy.ts`, en vez de
// esperar una crecida real: lo que se verifica es el contrato del CSS.
{
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto(URL, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(5000);
  const borde = async (estado) =>
    p.evaluate((e) => {
      document.documentElement.dataset.estadoRio = e;
      const c = document.querySelector(".card--respuesta");
      const s = getComputedStyle(c);
      return { color: s.borderLeftColor, ancho: s.borderLeftWidth };
    }, estado);

  const normal = await borde("ok");
  console.log(`\nD2  río normal   -> borde ${normal.color} ${normal.ancho}`);
  let previo = normal.color;
  let ok = true;
  for (const estado of ["warn", "error", "danger"]) {
    const b2 = await borde(estado);
    console.log(`D2  río ${estado.padEnd(9)} -> borde ${b2.color} ${b2.ancho}`);
    if (b2.color === previo) { console.log(`  ✗ ${estado} no cambió el color`); ok = false; }
    if (parseFloat(b2.ancho) <= parseFloat(normal.ancho)) { console.log(`  ✗ ${estado} no engrosó el filo`); ok = false; }
    previo = b2.color;
  }
  if (!ok) fallo = true;
  else console.log("D2  el color entra sólo cuando hay algo que decir.");
  await p.close();
}

await b.close();
console.log(fallo ? "\nHAY FALLAS" : "\nSin overflow, contexto plegado y tipografía propia en los 8 casos.");
process.exit(fallo ? 1 : 0);
