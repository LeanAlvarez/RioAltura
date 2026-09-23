// spec 015, C6/C7: el punto de "Mi casa" se marca con un botón explícito, se
// puede cambiar y se puede borrar. Verifica en la app real (no en tests) que:
//   1. un click en el mapa FUERA del modo elección no marca ni mueve nada;
//   2. "Marcar mi casa" enciende el modo (cartel + cursor) y el click marca;
//   3. Escape y "Cancelar" apagan el modo sin marcar;
//   4. "Elegir otro punto" reemplaza el punto, sin dejar dos marcadores;
//   5. "Borrar" saca el marcador, limpia localStorage y sobrevive a recargar.
//
// Uso: URL=http://127.0.0.1:5203 node scripts/verificar-mi-casa-controles.mjs
import { chromium } from "@playwright/test";

const url = process.env.URL;
if (!url) {
  console.error("Falta la variable de entorno URL (ej: URL=http://127.0.0.1:5203)");
  process.exit(1);
}

let fallo = false;
function assert(condicion, mensaje) {
  if (!condicion) {
    fallo = true;
    console.error(`✗ ${mensaje}`);
  } else {
    console.log(`✓ ${mensaje}`);
  }
}

// El marcador es un L.circleMarker (un <path> de SVG, indistinguible de las
// capas de inundación por selector). Su tooltip permanente sí es único, así
// que ése es el indicador de presencia.
const SEL_MARCADOR = ".leaflet-tooltip.mi-casa-tooltip";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

async function marcadores() {
  return page.locator(SEL_MARCADOR).count();
}
async function textoTarjeta() {
  return (await page.locator("#tarjeta-mi-casa").textContent()) ?? "";
}
async function esperarCalculo() {
  await page
    .waitForFunction(
      () => {
        const t = document.querySelector(".mi-casa-resultado")?.textContent ?? "";
        return t.length > 0 && !t.includes("Buscando");
      },
      { timeout: 30_000 },
    )
    .catch(() => {});
}
// `locator.click({position})` y no `page.mouse.click(x, y)`: clickear un
// botón de la tarjeta scrollea la página, y con coordenadas absolutas el
// click siguiente cae fuera del mapa (o fuera del viewport) sin que nada
// avise. Playwright scrollea el lienzo a la vista y traduce la posición
// relativa él mismo.
async function clickEnMapa(fraccionX, fraccionY) {
  const lienzo = page.locator(".mapa-inundacion-lienzo");
  const box = await lienzo.boundingBox();
  if (!box) throw new Error("No se encontró .mapa-inundacion-lienzo");
  await lienzo.click({
    position: { x: Math.round(box.width * fraccionX), y: Math.round(box.height * fraccionY) },
  });
}

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".mapa-inundacion-lienzo", { timeout: 30_000 });
await page.waitForSelector(".leaflet-overlay-pane path, .capas-error", { timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(1000);

// Partir siempre de cero: si una corrida anterior dejó un punto guardado, el
// primer chequeo ("no marca sin modo elección") no probaría nada.
await page.evaluate(() => localStorage.removeItem("rioaltura-mi-casa"));
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".mapa-inundacion-lienzo", { timeout: 30_000 });
await page.waitForTimeout(1500);

// --- 1. El bug reportado: un click cualquiera NO puede marcar la casa ------
// Control positivo, obligatorio: "no pasó nada" también es el resultado de un
// click que nunca llegó al mapa. Sin este contador el chequeo de abajo pasa
// en verde aunque el script esté clickeando al vacío (ya ocurrió: al clickear
// un botón de la tarjeta la página scrollea y las coordenadas absolutas
// quedan viejas).
await page.evaluate(() => {
  window.__clicksAlMapa = 0;
  window.mapaInundacion?.map.on("click", () => {
    window.__clicksAlMapa++;
  });
});

assert((await marcadores()) === 0, "arranca sin marcador");
await clickEnMapa(0.4, 0.35);
await page.waitForTimeout(600);
assert(
  (await page.evaluate(() => window.__clicksAlMapa)) === 1,
  "control positivo: el click SÍ llegó a Leaflet (si no, el chequeo de abajo no prueba nada)",
);
assert((await marcadores()) === 0, "un click en el mapa fuera del modo elección NO crea el marcador");
assert(
  !(await textoTarjeta()).includes("se moja cuando el río"),
  "un click fuera del modo elección tampoco calcula ninguna altura",
);

// --- 2. El botón enciende el modo elección --------------------------------
await page.locator('#tarjeta-mi-casa [data-accion="marcar"]').click();
await page.waitForTimeout(300);
assert(await page.locator(".mi-casa-hint").isVisible(), "el cartel 'Tocá tu casa en el mapa' se ve en el lienzo");
assert(
  await page.locator(".mapa-inundacion-lienzo.eligiendo-mi-casa").count(),
  "el lienzo toma la clase del cursor de elección",
);

// --- 3. Escape cancela sin marcar -----------------------------------------
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
assert(!(await page.locator(".mi-casa-hint").isVisible()), "Escape apaga el modo elección");
assert((await marcadores()) === 0, "cancelar con Escape no deja ningún marcador");

// Y el botón Cancelar hace lo mismo.
await page.locator('#tarjeta-mi-casa [data-accion="marcar"]').click();
await page.waitForTimeout(200);
await page.locator('#tarjeta-mi-casa [data-accion="cancelar"]').click();
await page.waitForTimeout(300);
assert(!(await page.locator(".mi-casa-hint").isVisible()), "el botón Cancelar apaga el modo elección");
assert((await marcadores()) === 0, "cancelar con el botón no deja ningún marcador");

// --- 4. Marcar de verdad ---------------------------------------------------
await page.locator('#tarjeta-mi-casa [data-accion="marcar"]').click();
await page.waitForTimeout(200);
await clickEnMapa(0.4, 0.35);
await esperarCalculo();
assert((await marcadores()) === 1, "el click en modo elección crea exactamente un marcador");
assert(!(await page.locator(".mi-casa-hint").isVisible()), "marcar apaga el modo elección (es de un solo uso)");
const guardado1 = await page.evaluate(() => localStorage.getItem("rioaltura-mi-casa"));
assert(guardado1 !== null, "el punto queda guardado en localStorage");

// --- 5. Elegir otro punto reemplaza, no acumula ---------------------------
await page.locator('#tarjeta-mi-casa [data-accion="marcar"]').click();
await page.waitForTimeout(200);
await clickEnMapa(0.65, 0.6);
await esperarCalculo();
assert((await marcadores()) === 1, "'Elegir otro punto' reemplaza el marcador, no agrega uno nuevo");
const guardado2 = await page.evaluate(() => localStorage.getItem("rioaltura-mi-casa"));
assert(guardado2 !== guardado1, "el punto guardado cambió al elegir otro");

// --- 6. Borrar -------------------------------------------------------------
await page.locator('#tarjeta-mi-casa [data-accion="borrar"]').click();
await page.waitForTimeout(500);
assert((await marcadores()) === 0, "Borrar saca el marcador del mapa");
assert(
  (await page.evaluate(() => localStorage.getItem("rioaltura-mi-casa"))) === null,
  "Borrar limpia localStorage",
);
const tras = await textoTarjeta();
assert(tras.includes("Marcá tu casa en el mapa"), "la tarjeta vuelve a su estado inicial");
assert(
  (await page.locator('#tarjeta-mi-casa [data-accion="borrar"]').count()) === 0,
  "ya no ofrece borrar cuando no hay punto",
);

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".mapa-inundacion-lienzo", { timeout: 30_000 });
await page.waitForTimeout(2000);
assert((await marcadores()) === 0, "el borrado sobrevive a recargar la página");

// --- 7. C7: la ayuda -------------------------------------------------------
const ayuda = (await page.locator(".mi-casa-ayuda").textContent()) ?? "";
assert(ayuda.includes("¿Cómo se usa?"), "la tarjeta explica cómo se usa");
assert(ayuda.includes("Tocá tu casa en el mapa"), "la ayuda incluye el paso del mapa");
assert(ayuda.includes("sólo en este teléfono"), "la ayuda incluye la promesa de privacidad");
assert(
  !(await page.locator(".mi-casa-pasos").isVisible()),
  "la ayuda va plegada por defecto (no le come la pantalla al resultado)",
);

await browser.close();
if (fallo) {
  console.error("\nHAY FALLAS");
  process.exit(1);
}
console.log("\nTodo OK");
