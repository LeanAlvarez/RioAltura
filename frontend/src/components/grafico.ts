import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { getAlturasDiarias } from "../api/alturas";
import { getPronostico, getPronosticoHistorico } from "../api/pronostico";
import type { AlturaDiaria, DiaPronostico, HistoricoDia } from "../api/types";
import { ALERTA_M, EVACUACION_EN_SECO_M, EVACUACION_M } from "../domain/dominio";
import { formatDiaSemanaFecha, formatMetros, formatRangoMetros, parseFechaLocal } from "../format";
import { PALETA, TRAZOS, fondoTrazoCss, leerVariableCss, propsTrazoUplot, type RolLinea } from "../graficos/paleta";
import { onTemaCambia } from "../theme";

export type RangoDias = 30 | 90 | 365;
export const RANGOS: readonly RangoDias[] = [30, 90, 365];

function fechaISOLocal(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Pure: rango en días + "hoy" -> parámetros `desde`/`hasta` para `/api/alturas`. */
export function calcularRangoFechas(rango: RangoDias, hoy: Date): { desde: string; hasta: string } {
  const desdeDate = new Date(hoy);
  desdeDate.setDate(desdeDate.getDate() - rango);
  return { desde: fechaISOLocal(desdeDate), hasta: fechaISOLocal(hoy) };
}

function fechaAEpochSegundos(fechaIso: string): number {
  return Math.floor(parseFechaLocal(fechaIso).getTime() / 1000);
}

export interface ChartSeries {
  x: number[];
  real: (number | null)[];
  pronosticoMin: (number | null)[];
  pronosticoMax: (number | null)[];
  pronosticoCentro: (number | null)[];
  historico: (number | null)[];
}

/**
 * Pure: aligns real levels, current forecast (anchored band + centre, spec
 * 007 C2) and optional historical forecast onto one shared, sorted,
 * de-duplicated x-axis (epoch seconds), with `null` where a series has no
 * data for that day. No DOM.
 */
export function buildChartSeries(
  alturas: readonly AlturaDiaria[],
  pronostico: readonly DiaPronostico[] | null,
  historico: readonly HistoricoDia[] | null,
): ChartSeries {
  const fechas = new Set<string>();
  for (const a of alturas) fechas.add(a.fecha);
  for (const d of pronostico ?? []) fechas.add(d.fecha);
  for (const d of historico ?? []) fechas.add(d.fecha);

  const fechasOrdenadas = Array.from(fechas).sort();
  const x = fechasOrdenadas.map(fechaAEpochSegundos);

  const realPorFecha = new Map(alturas.map((a) => [a.fecha, a.altura_m]));
  const pronosticoPorFecha = new Map((pronostico ?? []).map((d) => [d.fecha, d]));
  const historicoPorFecha = new Map((historico ?? []).map((d) => [d.fecha, d.altura_est_m]));

  return {
    x,
    real: fechasOrdenadas.map((f) => realPorFecha.get(f) ?? null),
    pronosticoMin: fechasOrdenadas.map((f) => pronosticoPorFecha.get(f)?.altura_anclada_min_m ?? null),
    pronosticoMax: fechasOrdenadas.map((f) => pronosticoPorFecha.get(f)?.altura_anclada_max_m ?? null),
    pronosticoCentro: fechasOrdenadas.map((f) => pronosticoPorFecha.get(f)?.altura_anclada_m ?? null),
    historico: fechasOrdenadas.map((f) => historicoPorFecha.get(f) ?? null),
  };
}

/** Pure: resumen textual (alternativa accesible al gráfico). No DOM. */
export function buildResumenTexto(alturas: readonly AlturaDiaria[], pronostico: readonly DiaPronostico[] | null): string {
  if (alturas.length === 0) return "Todavía no hay datos de altura real para graficar.";
  const valores = alturas.map((a) => a.altura_m);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const ultimo = alturas[alturas.length - 1];
  let texto = `Altura real: entre ${formatMetros(min)} y ${formatMetros(max)} en el período mostrado`;
  if (ultimo) texto += `, ${formatMetros(ultimo.altura_m)} el último dato (${formatDiaSemanaFecha(ultimo.fecha)})`;
  texto += ".";
  if (pronostico && pronostico.length > 0) {
    const maxCentro = pronostico.reduce((m, d) => (d.altura_anclada_max_m > m.altura_anclada_max_m ? d : m));
    texto += ` Pronóstico: podría llegar a ${formatRangoMetros(maxCentro.altura_anclada_min_m, maxCentro.altura_anclada_max_m)} el ${formatDiaSemanaFecha(maxCentro.fecha)}.`;
  }
  return texto;
}

export interface GraficoDeps {
  getAlturasDiarias: typeof getAlturasDiarias;
  getPronostico: typeof getPronostico;
  getPronosticoHistorico: typeof getPronosticoHistorico;
}

const defaultDeps: GraficoDeps = { getAlturasDiarias, getPronostico, getPronosticoHistorico };

interface EstadoGrafico {
  rango: RangoDias;
  mostrarHistorico: boolean;
}

/**
 * Cada umbral tiene su propio rol de paleta (`graficos/paleta.ts`), con un
 * patrón de guiones distinto de los otros dos y del resto de las líneas del
 * gráfico: nunca depende solo del color (CLAUDE.md §7).
 */
const THRESHOLD_DEFS: ReadonlyArray<{ valor: number; label: string; rol: RolLinea; variable: string }> = [
  { valor: EVACUACION_EN_SECO_M, label: "Evacuación preventiva", rol: "evacuacionPreventiva", variable: "--graf-evac-preventiva" },
  { valor: ALERTA_M, label: "Alerta", rol: "alerta", variable: "--graf-alerta" },
  { valor: EVACUACION_M, label: "Evacuación", rol: "evacuacion", variable: "--graf-evacuacion" },
];

/** Lee la paleta de gráficos vigente desde las custom properties CSS (spec 008 v3: reactivo al tema, se relee en cada render). */
function construirColores(referencia: HTMLElement) {
  return {
    real: leerVariableCss("--graf-altura-real", PALETA.light.alturaReal, referencia),
    pronostico: leerVariableCss("--graf-pronostico", PALETA.light.pronostico, referencia),
    pronosticoBanda: leerVariableCss("--graf-pronostico-banda", PALETA.light.pronosticoBanda, referencia),
    historico: leerVariableCss("--graf-historico", PALETA.light.historico, referencia),
    eje: leerVariableCss("--graf-eje", PALETA.light.ejeTexto, referencia),
    grilla: leerVariableCss("--graf-grilla", PALETA.light.grilla, referencia),
    thresholds: THRESHOLD_DEFS.map((t) => ({
      ...t,
      color: leerVariableCss(t.variable, PALETA.light[t.rol], referencia),
    })),
  };
}

const fechaEjeFormatter = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" });
const metrosEjeFormatter = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

const ALTO_ETIQUETA_UMBRAL = 20;

interface EtiquetaUmbralEl {
  el: HTMLDivElement;
  valor: number;
}

/**
 * Crea un `<div>` por umbral, pegado al margen derecho del gráfico (spec 007
 * T2: "umbrales etiquetados"). Son elementos de HTML normales —no texto
 * dibujado en el canvas— para no tener que reproducir a mano la conversión
 * de coordenadas de uPlot (canvas pixels vs. CSS pixels según densidad de
 * pantalla); solo se les recalcula la posición `top` en cada redibujado.
 */
function crearEtiquetasUmbrales(
  wrapEl: HTMLElement,
  colores: ReturnType<typeof construirColores>,
): EtiquetaUmbralEl[] {
  wrapEl.querySelectorAll(".grafico-umbral-etiqueta").forEach((el) => el.remove());
  return colores.thresholds.map((t) => {
    const el = document.createElement("div");
    el.className = "grafico-umbral-etiqueta";
    el.style.color = t.color;
    // El número va primero (menor, revisión de diseño a 360 px): con el
    // nombre adelante, el `text-overflow: ellipsis` de `.grafico-umbral-etiqueta`
    // cortaba justo el número al final ("Evacuación preventiva (6,…"), que es
    // el dato. Así, si algo se corta, se corta el nombre, nunca la altura.
    el.textContent = `${metrosEjeFormatter.format(t.valor)} m — ${t.label}`;
    wrapEl.appendChild(el);
    return { el, valor: t.valor };
  });
}

/**
 * Los tres umbrales de Colón están a menos de 1,1 m entre sí (6,80 / 7,10 /
 * 7,90): a la escala del gráfico casi siempre caen a menos de una línea de
 * texto de distancia, así que se separan verticalmente lo mínimo necesario
 * para no superponerse.
 */
function posicionarEtiquetasUmbrales(u: uPlot, wrapEl: HTMLElement, etiquetas: readonly EtiquetaUmbralEl[]): void {
  const wrapRect = wrapEl.getBoundingClientRect();
  const overRect = u.over.getBoundingClientRect();
  const offsetTop = overRect.top - wrapRect.top;
  const alto = overRect.height;

  const posiciones = etiquetas
    .map((e) => ({ ...e, top: offsetTop + u.valToPos(e.valor, "y", false) }))
    .filter((e) => e.top >= offsetTop - 1 && e.top <= offsetTop + alto + 1)
    .sort((a, b) => a.top - b.top);

  for (let i = 1; i < posiciones.length; i++) {
    const actual = posiciones[i];
    const anterior = posiciones[i - 1];
    if (!actual || !anterior) continue;
    if (actual.top - anterior.top < ALTO_ETIQUETA_UMBRAL) actual.top = anterior.top + ALTO_ETIQUETA_UMBRAL;
  }

  for (const e of etiquetas) e.el.hidden = true;
  for (const p of posiciones) {
    p.el.hidden = false;
    p.el.style.top = `${p.top}px`;
  }
}

function construirOpciones(
  width: number,
  mostrarHistorico: boolean,
  colores: ReturnType<typeof construirColores>,
): uPlot.Options {
  const uPlotSeries: uPlot.Series[] = [
    {},
    { label: "Altura real", stroke: colores.real, width: TRAZOS.alturaReal.widthPx, points: { show: false } },
    { label: "Pronóstico (mín.)", stroke: "transparent", width: 0, points: { show: false } },
    {
      label: "Pronóstico (máx.)",
      stroke: colores.pronostico,
      fill: colores.pronosticoBanda,
      width: 0,
      points: { show: false },
    },
    {
      label: "Pronóstico (centro)",
      stroke: colores.pronostico,
      points: { show: false },
      ...propsTrazoUplot(TRAZOS.pronostico),
    },
  ];

  if (mostrarHistorico) {
    uPlotSeries.push({
      label: "Pronóstico a 3 días (histórico)",
      stroke: colores.historico,
      points: { show: false },
      ...propsTrazoUplot(TRAZOS.historico),
    });
  }

  for (const t of colores.thresholds) {
    uPlotSeries.push({
      label: t.label,
      stroke: t.color,
      points: { show: false },
      ...propsTrazoUplot(TRAZOS[t.rol]),
    });
  }

  return {
    width,
    height: 280,
    // Right padding = 28 (no 12): a 1920 px, el último rótulo del eje X
    // (p.ej. "26 sep") quedaba cortado por el borde del lienzo (menor,
    // revisión de diseño) porque uPlot centra la etiqueta sobre su marca y
    // no reservaba lugar para la mitad que sobresale del último tick.
    padding: [12, 28, 0, 0],
    scales: { x: { time: true } },
    series: uPlotSeries,
    bands: [{ series: [2, 3] }],
    // L4 (spec 008) + paleta v3: ejes >= 13 px, con el rol dedicado
    // `--graf-eje` (contraste AA en los dos temas, ver paleta.test.ts) y
    // grilla en `--graf-grilla`. M4: a 360 px, menos marcas en el eje X (más
    // espacio mínimo entre ticks) para que no se amontonen.
    axes: [
      {
        font: "13px system-ui, sans-serif",
        stroke: colores.eje,
        grid: { stroke: colores.grilla, width: 1 },
        ticks: { stroke: colores.grilla, width: 1 },
        size: 40,
        space: width < 400 ? 70 : 50,
        values: (_u, splits) => splits.map((s) => fechaEjeFormatter.format(new Date(s * 1000))),
      },
      {
        label: "Altura (metros)",
        font: "13px system-ui, sans-serif",
        labelFont: "13px system-ui, sans-serif",
        stroke: colores.eje,
        grid: { stroke: colores.grilla, width: 1 },
        ticks: { stroke: colores.grilla, width: 1 },
        values: (_u, splits) => splits.map((s) => metrosEjeFormatter.format(s)),
      },
    ],
    cursor: { points: { show: true } },
    // La leyenda de uPlot muestra "--" hasta que hay cursor: se elimina y se
    // escribe una propia en el DOM (ver `construirLeyenda`). Los umbrales
    // etiquetados también se dibujan aparte, como HTML (ver
    // `crearEtiquetasUmbrales`/`posicionarEtiquetasUmbrales`).
    legend: { show: false },
  };
}

function construirDatos(series: ChartSeries, mostrarHistorico: boolean): uPlot.AlignedData {
  const data: (number | null)[][] = [
    series.x,
    series.real,
    series.pronosticoMin,
    series.pronosticoMax,
    series.pronosticoCentro,
  ];
  if (mostrarHistorico) data.push(series.historico);
  for (const t of THRESHOLD_DEFS) data.push(series.x.map(() => t.valor));
  return data as unknown as uPlot.AlignedData;
}

interface LeyendaItem {
  label: string;
  /** Fondo CSS ya resuelto (sólido o `repeating-linear-gradient`, ver `fondoTrazoCss`): la muestra siempre coincide con la línea. */
  fondo: string;
  widthPx: number;
}

/** Leyenda propia (reemplaza la de uPlot, que solo muestra "--" hasta pasar el cursor). */
function construirItemsLeyenda(colores: ReturnType<typeof construirColores>, mostrarHistorico: boolean): LeyendaItem[] {
  const items: LeyendaItem[] = [
    { label: "Altura real", fondo: colores.real, widthPx: TRAZOS.alturaReal.widthPx },
    { label: "Entre lo mínimo y lo máximo", fondo: colores.pronosticoBanda, widthPx: TRAZOS.alturaReal.widthPx },
    {
      label: "Lo más probable",
      fondo: fondoTrazoCss(colores.pronostico, TRAZOS.pronostico),
      widthPx: TRAZOS.pronostico.widthPx,
    },
  ];
  if (mostrarHistorico) {
    items.push({
      label: "Pronóstico a 3 días (histórico)",
      fondo: fondoTrazoCss(colores.historico, TRAZOS.historico),
      widthPx: TRAZOS.historico.widthPx,
    });
  }
  for (const t of colores.thresholds) {
    const trazo = TRAZOS[t.rol];
    items.push({ label: t.label, fondo: fondoTrazoCss(t.color, trazo), widthPx: trazo.widthPx });
  }
  return items;
}

function renderLeyenda(container: HTMLElement, items: LeyendaItem[]): void {
  container.innerHTML = items
    .map(
      (item) => `
        <li>
          <span class="grafico-leyenda-linea" style="background:${item.fondo};height:${item.widthPx}px"></span>
          ${item.label}
        </li>
      `,
    )
    .join("");
}

const tooltipFechaFormatter = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", month: "short" });

/** Contenido del tooltip para el índice `idx` de `series`, o null si no hay ningún valor ese día. */
function contenidoTooltip(series: ChartSeries, idx: number): string | null {
  const xIdx = series.x[idx];
  if (xIdx === undefined) return null;
  const fecha = tooltipFechaFormatter.format(new Date(xIdx * 1000));
  const partes: string[] = [];
  const real = series.real[idx];
  if (real !== null && real !== undefined) partes.push(`Altura real: ${formatMetros(real)}`);
  const min = series.pronosticoMin[idx];
  const max = series.pronosticoMax[idx];
  if (min !== null && min !== undefined && max !== null && max !== undefined) {
    partes.push(`Pronóstico: ${formatRangoMetros(min, max)}`);
  }
  if (partes.length === 0) return null;
  return `<strong>${fecha}</strong><br>${partes.join("<br>")}`;
}

export interface MontajeGrafico {
  /** Desuscribe del cambio de tema y destruye la instancia de uPlot. Evita memory leaks al desmontar la tarjeta. */
  destroy(): void;
}

/**
 * Owns the range selector / historical toggle, fetches data (independently
 * of the other cards) and (re)draws the uPlot chart. Not unit-tested (uPlot
 * needs a real canvas); `buildChartSeries`/`buildResumenTexto` above carry
 * the tested logic.
 */
export function mountGrafico(container: HTMLElement, deps: GraficoDeps = defaultDeps): MontajeGrafico {
  const estado: EstadoGrafico = { rango: 90, mostrarHistorico: false };
  let instancia: uPlot | null = null;
  let ultimaSeries: ChartSeries | null = null;
  let umbralesActuales: EtiquetaUmbralEl[] = [];

  container.innerHTML = `
    <h2>Evolución y pronóstico</h2>
    <div class="grafico-controles">
      <div class="rango-selector" role="group" aria-label="Rango de días">
        ${RANGOS.map((r) => `<button type="button" data-rango="${r}" aria-pressed="${r === estado.rango}">${r} días</button>`).join("")}
      </div>
      <label class="toggle-historico">
        <input type="checkbox" id="toggle-historico" />
        Ver qué decía el pronóstico esos días
      </label>
    </div>
    <div class="grafico-canvas-wrap">
      <div class="grafico-canvas" id="grafico-canvas"></div>
      <div class="grafico-tooltip" id="grafico-tooltip" hidden></div>
    </div>
    <ul class="grafico-leyenda" id="grafico-leyenda" aria-hidden="true"></ul>
    <p class="grafico-estado" role="status" aria-live="polite"></p>
    <details class="grafico-alternativa">
      <summary>Ver como texto</summary>
      <p class="grafico-resumen"></p>
    </details>
  `;

  const canvasEl = container.querySelector<HTMLDivElement>("#grafico-canvas");
  const canvasWrapEl = container.querySelector<HTMLDivElement>(".grafico-canvas-wrap");
  const tooltipEl = container.querySelector<HTMLDivElement>("#grafico-tooltip");
  const leyendaEl = container.querySelector<HTMLUListElement>("#grafico-leyenda");
  const estadoEl = container.querySelector<HTMLParagraphElement>(".grafico-estado");
  const resumenEl = container.querySelector<HTMLParagraphElement>(".grafico-resumen");
  const toggleEl = container.querySelector<HTMLInputElement>("#toggle-historico");
  if (!canvasEl || !canvasWrapEl || !tooltipEl || !leyendaEl || !estadoEl || !resumenEl || !toggleEl) {
    return { destroy(): void {} };
  }

  function mostrarTooltip(idx: number, left: number, top: number): void {
    if (!ultimaSeries || !tooltipEl || !canvasWrapEl) return;
    const contenido = contenidoTooltip(ultimaSeries, idx);
    if (!contenido) {
      tooltipEl.hidden = true;
      return;
    }
    tooltipEl.innerHTML = contenido;
    tooltipEl.hidden = false;
    const maxLeft = canvasWrapEl.clientWidth - tooltipEl.offsetWidth - 4;
    tooltipEl.style.left = `${Math.max(4, Math.min(left + 12, maxLeft))}px`;
    tooltipEl.style.top = `${Math.max(4, top - 12)}px`;
  }

  function ocultarTooltip(): void {
    if (tooltipEl) tooltipEl.hidden = true;
  }

  /**
   * `cursor.left`/`top` y `.u-over`'s propio rect están en CSS pixels
   * *relativos al área de trazado* (sin el eje Y ni sus números). El
   * tooltip, en cambio, se posiciona relativo a `.grafico-canvas-wrap`
   * (todo el gráfico). Este es el desplazamiento entre ambos orígenes.
   */
  function offsetAreaTrazadoEnWrap(): { x: number; y: number } {
    if (!instancia || !canvasWrapEl) return { x: 0, y: 0 };
    const overRect = instancia.over.getBoundingClientRect();
    const wrapRect = canvasWrapEl.getBoundingClientRect();
    return { x: overRect.left - wrapRect.left, y: overRect.top - wrapRect.top };
  }

  /**
   * (Re)dibuja el gráfico a partir de `series` ya calculada, releyendo la
   * paleta de colores en cada llamada (spec 008 v3: reactividad al tema).
   * Se usa tanto después de un fetch nuevo como al cambiar de tema (sin
   * volver a pedir los datos).
   */
  function dibujar(series: ChartSeries): void {
    if (!canvasEl || !canvasWrapEl || !leyendaEl) return;

    const colores = construirColores(container);
    renderLeyenda(leyendaEl, construirItemsLeyenda(colores, estado.mostrarHistorico));

    instancia?.destroy();
    const width = Math.max(280, canvasEl.clientWidth || container.clientWidth || 320);
    canvasEl.replaceChildren();
    instancia = new uPlot(
      construirOpciones(width, estado.mostrarHistorico, colores),
      construirDatos(series, estado.mostrarHistorico),
      canvasEl,
    );

    instancia.over.addEventListener("mouseleave", ocultarTooltip);
    instancia.over.addEventListener("mousemove", () => {
      if (!instancia) return;
      const idx = instancia.cursor.idx;
      if (idx === null || idx === undefined) return;
      const offset = offsetAreaTrazadoEnWrap();
      mostrarTooltip(idx, offset.x + (instancia.cursor.left ?? 0), offset.y + (instancia.cursor.top ?? 0));
    });
    // Táctil: uPlot no traduce touch a cursor por defecto; se calcula el
    // índice más cercano a mano a partir de la posición X tocada.
    instancia.over.addEventListener(
      "touchstart",
      (ev) => {
        if (!instancia || !ultimaSeries) return;
        const touch = ev.touches[0];
        if (!touch) return;
        const rect = instancia.over.getBoundingClientRect();
        const left = touch.clientX - rect.left;
        const top = touch.clientY - rect.top;
        const valorX = instancia.posToVal(left, "x");
        let idx = 0;
        let mejor = Infinity;
        ultimaSeries.x.forEach((x, i) => {
          const dist = Math.abs(x - valorX);
          if (dist < mejor) {
            mejor = dist;
            idx = i;
          }
        });
        const offset = offsetAreaTrazadoEnWrap();
        mostrarTooltip(idx, offset.x + left, offset.y + top);
      },
      { passive: true },
    );

    const etiquetasUmbrales = crearEtiquetasUmbrales(canvasWrapEl, colores);
    umbralesActuales = etiquetasUmbrales;
    // uPlot dimensiona el canvas en el frame siguiente a la construcción:
    // medir el área de trazado en el mismo tick da alto/ancho en cero.
    requestAnimationFrame(() => {
      if (!instancia || !canvasWrapEl) return;
      posicionarEtiquetasUmbrales(instancia, canvasWrapEl, umbralesActuales);
    });
  }

  async function actualizar(): Promise<void> {
    if (!estadoEl || !canvasEl || !canvasWrapEl || !resumenEl || !leyendaEl) return;
    estadoEl.textContent = "Cargando…";
    ocultarTooltip();

    const ahora = new Date();
    const { desde, hasta } = calcularRangoFechas(estado.rango, ahora);

    const [alturasResult, pronosticoResult, historicoResult] = await Promise.all([
      deps.getAlturasDiarias(desde, hasta),
      deps.getPronostico(),
      estado.mostrarHistorico ? deps.getPronosticoHistorico(3, desde) : Promise.resolve(null),
    ]);

    if (alturasResult.kind !== "ok") {
      estadoEl.textContent = "No pudimos cargar la serie de altura real.";
      canvasEl.replaceChildren();
      instancia?.destroy();
      instancia = null;
      return;
    }

    const dias = pronosticoResult.kind === "ok" ? pronosticoResult.data.dias : null;
    const historico = historicoResult && historicoResult.kind === "ok" ? historicoResult.data : null;

    const series = buildChartSeries(alturasResult.data, dias, historico);
    ultimaSeries = series;
    estadoEl.textContent =
      pronosticoResult.kind === "ok" ? "" : "El pronóstico no está disponible; se muestra solo la altura real.";
    resumenEl.textContent = buildResumenTexto(alturasResult.data, dias);

    dibujar(series);
  }

  const desuscribirTema = onTemaCambia(() => {
    if (ultimaSeries) dibujar(ultimaSeries);
  });

  container.querySelectorAll<HTMLButtonElement>("[data-rango]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rango = Number(btn.dataset.rango) as RangoDias;
      estado.rango = rango;
      container.querySelectorAll<HTMLButtonElement>("[data-rango]").forEach((b) => {
        b.setAttribute("aria-pressed", String(b === btn));
      });
      void actualizar();
    });
  });

  toggleEl.addEventListener("change", () => {
    estado.mostrarHistorico = toggleEl.checked;
    void actualizar();
  });

  function manejarResize(): void {
    if (!instancia || !canvasEl || !canvasWrapEl) return;
    instancia.setSize({ width: Math.max(280, canvasEl.clientWidth), height: 280 });
    posicionarEtiquetasUmbrales(instancia, canvasWrapEl, umbralesActuales);
  }
  window.addEventListener("resize", manejarResize);

  void actualizar();

  return {
    destroy(): void {
      desuscribirTema();
      window.removeEventListener("resize", manejarResize);
      instancia?.destroy();
      instancia = null;
    },
  };
}
