// spec 015, T9/C2: la prueba más importante de "Mi casa" es que la coordenada
// que el vecino toca nunca sale del dispositivo. Este script intercepta TODO
// el tráfico de red (registrado ANTES de page.goto, para no perderse nada),
// clickea el mapa, y verifica que:
//   1. ninguna URL ni body de request contiene la lat/lng clickeada;
//   2. la búsqueda pide a lo sumo ~6 capas GeoJSON, no las 43.
//
// Uso: URL=http://127.0.0.1:5203 node scripts/verificar-mi-casa-privacidad.mjs
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

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

/** @type {{url: string, postData: string | null, timestamp: number}[]} */
const requests = [];
// Registrado ANTES de page.goto a propósito: así no se pierde ni la primera
// carga de index.html.
page.on("request", (req) => {
  requests.push({ url: req.url(), postData: req.postData(), timestamp: Date.now() });
});

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".mapa-inundacion-lienzo", { timeout: 30_000 });
// Deja que index.json + la primera capa (altura de hoy o placeholder) terminen de cargar.
await page.waitForSelector(".leaflet-overlay-pane path, .capas-error", { timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(1000);

const antesDelClickIdx = requests.length;

const lienzoBox = await page.locator(".mapa-inundacion-lienzo").boundingBox();
if (!lienzoBox) {
  console.error("No se encontró el lienzo del mapa (.mapa-inundacion-lienzo)");
  process.exit(1);
}
const clickX = Math.round(lienzoBox.x + lienzoBox.width * 0.5);
const clickY = Math.round(lienzoBox.y + lienzoBox.height * 0.4);

// Lat/lng exactas que va a recibir el click handler (spec 015 map.ts), leídas
// de la instancia real de Leaflet -- así comparamos contra el valor exacto,
// no una aproximación nuestra.
const puntoClickeado = await page.evaluate(
  ([x, y, lx, ly]) => {
    const mapa = window.mapaInundacion;
    if (!mapa) return null;
    const rect = document.querySelector(".mapa-inundacion-lienzo")?.getBoundingClientRect();
    if (!rect) return null;
    const containerPoint = [x - lx, y - ly];
    const latlng = mapa.map.containerPointToLatLng(containerPoint);
    return { lat: latlng.lat, lng: latlng.lng };
  },
  [clickX, clickY, lienzoBox.x, lienzoBox.y],
);
assert(puntoClickeado !== null, "el mapa expone window.mapaInundacion con un método containerPointToLatLng utilizable");

await page.mouse.click(clickX, clickY);

// Espera a que "Mi casa" termine de calcular (deja de decir "Buscando…" / "Tocá el mapa").
await page
  .waitForFunction(
    () => {
      const el = document.querySelector(".mi-casa-resultado");
      const texto = el?.textContent ?? "";
      return texto.length > 0 && !texto.includes("Buscando") && !texto.includes("Tocá el mapa");
    },
    { timeout: 20_000 },
  )
  .catch(() => {});
await page.waitForTimeout(500);

const resultadoHtml = await page.locator("#tarjeta-mi-casa").innerHTML();
const disclaimerVisible = resultadoHtml.includes("Es un cálculo aproximado");
const tieneAltura = /\d,\d{2} m/.test(resultadoHtml);
console.log("--- Resultado de la tarjeta Mi casa ---");
console.log((await page.locator(".mi-casa-resultado").innerText()).trim());
assert(disclaimerVisible, "el disclaimer fijo (C5) aparece junto a la respuesta");
assert(!resultadoHtml.includes("<button"), "el disclaimer no tiene ningún botón para cerrarlo");

// --- 1. La coordenada nunca viaja -------------------------------------------------
const despuesDelClick = requests.slice(antesDelClickIdx);
console.log(`\n${String(despuesDelClick.length)} requests después del click.`);

if (puntoClickeado) {
  // Varias representaciones decimales, para no depender de con cuántos
  // decimales el navegador redondeó: 6, 5 y 4 decimales.
  const candidatos = [];
  for (const valor of [puntoClickeado.lat, puntoClickeado.lng]) {
    for (const decimales of [6, 5, 4, 3]) {
      candidatos.push(valor.toFixed(decimales));
      candidatos.push(valor.toFixed(decimales).replace(".", ","));
    }
  }
  const candidatosUnicos = [...new Set(candidatos)];

  let filtracion = null;
  for (const req of despuesDelClick) {
    for (const candidato of candidatosUnicos) {
      if (req.url.includes(candidato) || (req.postData ?? "").includes(candidato)) {
        filtracion = { req, candidato };
        break;
      }
    }
    if (filtracion) break;
  }
  assert(
    filtracion === null,
    "ninguna URL ni body de las requests posteriores al click contiene la lat/lng clickeada",
  );
  if (filtracion) {
    console.error(`  Filtración encontrada: "${filtracion.candidato}" en ${filtracion.req.url}`);
  }
  console.log(`  Punto clickeado (nunca debería aparecer en ninguna request): lat=${String(puntoClickeado.lat)}, lng=${String(puntoClickeado.lng)}`);
} else {
  fallo = true;
  console.error("✗ no se pudo determinar la lat/lng clickeada; no se puede verificar la no-filtración");
}

// --- 2. A lo sumo ~6 capas consultadas, no 43 -------------------------------------
const pedidosDeCapas = despuesDelClick
  .map((r) => r.url)
  .filter((u) => /\/capas\/h_\d{4}\.geojson(\?|$)/.test(u));
const pedidosUnicos = [...new Set(pedidosDeCapas)];
console.log(`\nCapas GeoJSON pedidas después del click: ${String(pedidosUnicos.length)} (${pedidosUnicos.map((u) => u.split("/").pop()).join(", ")})`);
assert(pedidosUnicos.length <= 6, "se consultan a lo sumo 6 capas después del click (ceil(log2(43))), no las 43");

await browser.close();

if (fallo) {
  console.error("\nFALLÓ la verificación de privacidad de Mi casa.");
  process.exit(1);
}
console.log("\nOK: la coordenada de Mi casa nunca sale del dispositivo.");
