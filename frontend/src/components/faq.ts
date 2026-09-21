import { fetchCapaIndex, formatAltura, type CapaIndex } from "../capas";
import { getEstadisticas } from "../api/estadisticas";
import type { FetchResult } from "../api/client";
import type { Estadisticas } from "../api/types";
import { UMBRALES } from "../domain/umbrales";
import { formatMetros } from "../format";
import { describeErrorPronostico } from "./precision";

/**
 * FAQ (spec 008, sección Q): acordeón antes del detalle técnico. Los datos
 * salen del código y de CLAUDE.md, nunca se inventan; lo que no tiene fuente
 * queda marcado PENDIENTE en la propia respuesta (ver `AUTOR` más abajo).
 */

export interface FaqItem {
  id: string;
  pregunta: string;
  respuestaHtml: string;
}

const NIVELES_HTML = UMBRALES.map(
  (u) =>
    `<strong>${formatMetros(u.alturaM)} — ${u.nombre}${u.terminoOficial ? ` (${u.terminoOficial})` : ""}:</strong> ${u.explicacion}`,
).join("<br>");

/**
 * Contenido estático de las 11 preguntas mínimas (spec 008, sección Q). Los
 * ids "precision" y "veinte-metros" arrancan con un texto provisorio: se
 * completan al vuelo con datos reales (ver `mountFaq`), porque dependen de
 * `/estadisticas` y de `capas/index.json`, que cambian con el tiempo.
 */
export function buildFaqEstaticas(): FaqItem[] {
  return [
    {
      id: "datos",
      pregunta: "¿De dónde salen los datos?",
      respuestaHtml:
        "La altura real del puerto la mide el INA (Instituto Nacional del Agua); si el INA no responde, se usa Prefectura Naval Argentina como respaldo. El pronóstico de caudal viene de Google Flood Forecasting API. El mapa de zonas inundables se hace con el modelo de elevación satelital Copernicus DEM.",
    },
    {
      id: "actualizacion",
      pregunta: "¿Cada cuánto se actualizan los datos?",
      respuestaHtml:
        "La altura real se revisa cada 1 hora y el pronóstico cada 6 horas. El INA a veces publica su dato con demora — por eso esta página siempre muestra la fecha y hora exacta de la última medición, nunca un dato viejo sin avisar. Google emite un pronóstico nuevo aproximadamente una vez por día.",
    },
    {
      id: "altura-puerto",
      pregunta: "¿Qué mide la altura del puerto?",
      respuestaHtml:
        "Es la altura del río en el hidrómetro de Prefectura Naval Argentina, en el puerto de Colón. El cero de ese hidrómetro está a −0,26 m IGN (nivel del mar), medido con GPS diferencial (INA-CARU, 2019).",
    },
    {
      id: "calculo-pronostico",
      pregunta: "¿Cómo se calcula el pronóstico en metros?",
      respuestaHtml:
        "Google Flood Forecasting da un caudal (en m³/s), no una altura. Ese caudal se convierte a metros del puerto con una curva de calibración propia, y después se ajusta (\"ancla\") para no contradecir lo que el río ya está midiendo hoy. El resultado siempre se muestra como un rango de ±1 m, nunca como un número exacto, porque el margen de error es real.",
    },
    {
      id: "precision",
      pregunta: "¿Qué tan preciso es?",
      respuestaHtml: "Calculando…",
    },
    {
      id: "niveles",
      pregunta: "¿Qué significan los niveles (6,80 / 7,10 / 7,90 m)?",
      respuestaHtml: NIVELES_HTML,
    },
    {
      id: "mapa",
      pregunta: "¿Cómo se hace el mapa de zonas inundables y qué limitaciones tiene?",
      respuestaHtml:
        "Se parte de un modelo de elevación satelital (Copernicus DEM, resolución de 30 m) y se calcula qué zonas quedan conectadas al río a cada altura. Es una aproximación: el DEM mide la superficie, así que incluye techos y árboles como si fueran terreno, y el mapa no modela defensas costeras, lluvia local ni el desagüe pluvial de la ciudad. Es orientativo, no un estudio hidráulico.",
    },
    {
      id: "veinte-metros",
      pregunta: "¿Por qué el mapa llega hasta niveles que nunca pasaron en Colón?",
      respuestaHtml: "Calculando…",
    },
    {
      id: "oficial",
      pregunta: "¿Es un aviso oficial?",
      respuestaHtml:
        'No. Es una herramienta orientativa e independiente. Los avisos oficiales son los de <a href="https://www.argentina.gob.ar/prefecturanaval" rel="noopener" target="_blank">Prefectura Naval Argentina</a>, <a href="https://www.caru.org.uy" rel="noopener" target="_blank">CARU</a>, <a href="https://www.ina.gob.ar" rel="noopener" target="_blank">INA</a> y Defensa Civil.',
    },
    {
      id: "privacidad",
      pregunta: "¿Guarda datos míos?",
      respuestaHtml:
        "No usa cookies de seguimiento ni analytics de terceros. Lo único que guarda en tu navegador es tu elección de tema claro/oscuro, y solo si tu navegador lo permite.",
    },
    {
      id: "autor",
      pregunta: "¿Quién lo hizo y cómo reporto un error?",
      respuestaHtml:
        'La hizo <a href="https://miraisoftware.net" rel="noopener" target="_blank">Mirai Software</a>, en y para la ciudad de Colón, Entre Ríos. <strong>PENDIENTE:</strong> todavía no hay un canal definido para reportar errores; lo agregamos apenas esté disponible.',
    },
  ];
}

export interface FaqDeps {
  getEstadisticas: typeof getEstadisticas;
  fetchCapaIndex: typeof fetchCapaIndex;
}

const defaultDeps: FaqDeps = { getEstadisticas, fetchCapaIndex };

export function renderFaq(container: HTMLElement, items: readonly FaqItem[]): void {
  const filas = items
    .map(
      (item) => `
        <details class="faq-item">
          <summary class="faq-pregunta">${item.pregunta}</summary>
          <div class="faq-respuesta" id="faq-respuesta-${item.id}">${item.respuestaHtml}</div>
        </details>`,
    )
    .join("");

  container.innerHTML = `
    <h2>Preguntas frecuentes</h2>
    <div class="faq-lista">${filas}</div>
  `;
}

/** Texto de la respuesta de precisión, a partir de `/estadisticas` (reusa la misma frase que la tarjeta "¿Cuánto acierta?"). */
export function describeFaqPrecision(estadisticas: FetchResult<Estadisticas>): string {
  if (estadisticas.kind !== "ok") return "No pudimos calcular la precisión del pronóstico en este momento.";
  const base = describeErrorPronostico(estadisticas.data.error_pronostico);
  return `${base} También puede fallar más si hay grandes descargas de la represa de Salto Grande, aguas arriba, que cambian el caudal más rápido de lo previsto. El detalle día a día está en la tarjeta "¿Cuánto acierta el pronóstico?".`;
}

/** Texto de la respuesta sobre el rango simulado del mapa, a partir de `capas/index.json` (nunca hardcodeado, ver CLAUDE.md). */
export function describeFaqVeinteMetros(index: CapaIndex): string {
  return `Para que puedas prepararte incluso para lo peor: hoy el mapa simula alturas hasta ${formatAltura(index.nivel_max)}, muy por encima de cualquier crecida ocurrida en Colón. La marca más alta jamás registrada son 10,00 m (crecida máxima observada, marca MOP, informe INA-CARU 2019); por encima de esa altura, el mapa muestra un escenario hipotético que nunca pasó.`;
}

/**
 * Completa las dos respuestas dinámicas (precisión y rango del mapa) una vez
 * que llegan sus datos, sin volver a dibujar todo el acordeón — así no se
 * cierran los `<details>` que el usuario ya haya abierto.
 */
export function mountFaq(container: HTMLElement, deps: FaqDeps = defaultDeps): void {
  renderFaq(container, buildFaqEstaticas());

  void deps.getEstadisticas().then((result) => {
    const el = container.querySelector<HTMLElement>("#faq-respuesta-precision");
    if (el) el.innerHTML = describeFaqPrecision(result);
  });

  void deps.fetchCapaIndex().then(
    (index) => {
      const el = container.querySelector<HTMLElement>("#faq-respuesta-veinte-metros");
      if (el) el.innerHTML = describeFaqVeinteMetros(index);
    },
    () => {
      const el = container.querySelector<HTMLElement>("#faq-respuesta-veinte-metros");
      if (el) el.textContent = "No pudimos cargar el rango simulado del mapa en este momento.";
    },
  );
}
