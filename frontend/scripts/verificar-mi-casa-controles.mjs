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

// --- 8. Los arreglos de la revisión -------------------------------------

// 8a. La ayuda no se pliega sola al cambiar de estado (C7). Era el defecto:
// el vecino leía el paso 1, lo ejecutaba, y la ayuda se cerraba justo antes
// de los pasos 2 y 3.
await page.locator(".mi-casa-ayuda summary").click();
await page.waitForTimeout(200);
assert(await page.locator(".mi-casa-pasos").isVisible(), "la ayuda se abre al tocarla");
await page.locator('#tarjeta-mi-casa [data-accion="marcar"]').click();
await page.waitForTimeout(300);
assert(
  await page.locator(".mi-casa-pasos").isVisible(),
  "la ayuda SIGUE abierta después de cambiar de estado (no se pliega sola)",
);

// 8b. El nodo que anuncia la respuesta es el mismo siempre: un `aria-live`
// recreado junto con su texto no lo anuncia en la mayoría de los lectores.
await page.evaluate(() => {
  document.querySelector(".mi-casa-resultado").setAttribute("data-marca", "1");
});
await clickEnMapa(0.5, 0.45);
await esperarCalculo();
assert(
  (await page.locator('.mi-casa-resultado[data-marca="1"]').count()) === 1,
  "la región aria-live sobrevive al repintado (mismo nodo, no uno nuevo)",
);
assert(
  (await page.locator(".mi-casa-resultado").getAttribute("aria-live")) === "polite",
  "la región mantiene aria-live=polite",
);

// 8c. El foco no se pierde al accionar: pasa al botón que ocupa el lugar.
await page.locator('#tarjeta-mi-casa [data-accion="borrar"]').focus();
await page.locator('#tarjeta-mi-casa [data-accion="borrar"]').click();
await page.waitForTimeout(300);
assert(
  (await page.evaluate(() => document.activeElement?.getAttribute("data-accion"))) === "marcar",
  "tras Borrar el foco queda en el botón que lo reemplaza, no en <body>",
);

// --- 9. Conexión lenta: el botón se puede apretar antes de que carguen las
// capas (CLAUDE.md §7 diseña para 3G). Antes el cartel, el cursor y el
// handler de click vivían dentro del .then() de index.json: se tocaba
// "Marcar mi casa", se tocaba el mapa, y no pasaba nada.
const lenta = await context.newPage();
await lenta.route("**/capas/index.json", async (route) => {
  await new Promise((r) => setTimeout(r, 6000));
  await route.continue();
});
await lenta.goto(url, { waitUntil: "domcontentloaded" });
await lenta.waitForSelector(".mapa-inundacion-lienzo", { timeout: 30_000 });
await lenta.waitForSelector('#tarjeta-mi-casa [data-accion="marcar"]', { timeout: 30_000 });
await lenta.locator('#tarjeta-mi-casa [data-accion="marcar"]').click();
await lenta.waitForTimeout(300);
assert(
  await lenta.locator(".mi-casa-hint").isVisible(),
  "con las capas todavía cargando, el modo elección YA muestra su cartel",
);
const boxLenta = await lenta.locator(".mapa-inundacion-lienzo").boundingBox();
await lenta.locator(".mapa-inundacion-lienzo").click({
  position: { x: Math.round(boxLenta.width * 0.45), y: Math.round(boxLenta.height * 0.4) },
});
await lenta.waitForTimeout(400);
assert(
  (await lenta.locator(SEL_MARCADOR).count()) === 1,
  "con las capas todavía cargando, el click marca el punto igual",
);
assert(
  ((await lenta.locator(".mi-casa-resultado").textContent()) ?? "").includes("Buscando"),
  "y la tarjeta dice que está buscando, sin inventar un error",
);
await lenta
  .waitForFunction(
    () => {
      const t = document.querySelector(".mi-casa-resultado")?.textContent ?? "";
      return t.length > 0 && !t.includes("Buscando");
    },
    { timeout: 40_000 },
  )
  .catch(() => {});
assert(
  !((await lenta.locator(".mi-casa-resultado").textContent()) ?? "").includes("No pudimos calcular"),
  "cuando por fin llegan las capas, el cálculo se completa (no quedó en error)",
);
await lenta.close();

// --- 10. El punto guardado no se pierde por haber tocado "Marcar" antes de
// que cargaran las capas. La restauración corría una sola vez y sólo si la
// tarjeta seguía en "sin punto": entrar al modo elección la salteaba para
// siempre, y quedaba localStorage con un punto que la app ya no mostraba.
const lenta2 = await context.newPage();
await lenta2.route("**/capas/index.json", async (route) => {
  await new Promise((r) => setTimeout(r, 6000));
  await route.continue();
});
await lenta2.goto(url, { waitUntil: "domcontentloaded" });
await lenta2.evaluate(() => {
  localStorage.setItem("rioaltura-mi-casa", JSON.stringify({ lat: -32.2147, lng: -58.137 }));
});
await lenta2.reload({ waitUntil: "domcontentloaded" });
await lenta2.waitForSelector(".mapa-inundacion-lienzo", { timeout: 30_000 });
await lenta2.waitForSelector('#tarjeta-mi-casa [data-accion="marcar"]', { timeout: 30_000 });
await lenta2.locator('#tarjeta-mi-casa [data-accion="marcar"]').click();
await lenta2.waitForTimeout(300);
await lenta2.keyboard.press("Escape");
await lenta2
  .waitForFunction(
    () => {
      const t = document.querySelector(".mi-casa-resultado")?.textContent ?? "";
      return /\d,\d{2}\s*m/.test(t);
    },
    { timeout: 40_000 },
  )
  .catch(() => {});
assert(
  (await lenta2.locator(SEL_MARCADOR).count()) === 1,
  "el punto guardado se restaura aunque se haya entrado al modo elección antes de que cargaran las capas",
);
assert(
  !((await lenta2.locator("#tarjeta-mi-casa").textContent()) ?? "").includes("Marcá tu casa en el mapa"),
  "y la tarjeta muestra su respuesta, no el estado inicial con el punto todavía en localStorage",
);
await lenta2.close();

// --- 11. El toque que llega antes que el módulo del mapa. La tarjeta pinta
// su botón enseguida, pero `map.ts` es un chunk aparte (~46 kB comprimidos):
// en 3G se puede tocar "Marcar mi casa" cuando todavía no hay a quién
// avisarle. La intención se anota y se aplica al resolver el import.
const lenta3 = await context.newPage();
// En dev Vite sirve el módulo como /src/map.ts; en un build, como un chunk.
await lenta3.route(/\/(src\/map\.ts|assets\/map-[^/]+\.js)/, async (route) => {
  await new Promise((r) => setTimeout(r, 5000));
  await route.continue();
});
await lenta3.goto(url, { waitUntil: "domcontentloaded" });
await lenta3.waitForSelector('#tarjeta-mi-casa [data-accion="marcar"]', { timeout: 30_000 });
assert(
  (await lenta3.locator(".mapa-inundacion-lienzo").count()) === 0,
  "control positivo: el módulo del mapa todavía NO cargó cuando se toca el botón",
);
await lenta3.locator('#tarjeta-mi-casa [data-accion="marcar"]').click();
await lenta3.waitForTimeout(300);
assert(
  ((await lenta3.locator(".mi-casa-resultado").textContent()) ?? "").includes("Tocá tu casa"),
  "el toque no se pierde: la tarjeta ya responde aunque el mapa no haya llegado",
);
await lenta3.waitForSelector(".mi-casa-hint", { state: "visible", timeout: 30_000 });
assert(true, "y al llegar el mapa, el modo elección queda encendido de verdad");
await lenta3.close();

await browser.close();
if (fallo) {
  console.error("\nHAY FALLAS");
  process.exit(1);
}
console.log("\nTodo OK");
