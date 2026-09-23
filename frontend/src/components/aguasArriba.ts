import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { FetchResult } from "../api/client";
import { getPronostico, getPronosticoAguasArriba } from "../api/pronostico";
import type { DiaPronostico, PronosticoAguasArriba } from "../api/types";
import { calcularTendencia, formatDiaSemanaFecha, formatMetros, formatRangoMetros, parseFechaLocal, type Tendencia } from "../format";
import { PALETA, TRAZOS, fondoTrazoCss, leerVariableCss, propsTrazoUplot } from "../graficos/paleta";
import { crearTooltipGrafico, type TooltipGrafico } from "../graficos/tooltip";
import { onTemaCambia } from "../theme";
import { renderCardError, renderCardSkeleton } from "./card";

export type AguasArribaState = { kind: "loading" } | FetchResult<PronosticoAguasArriba>;

export type AguasArribaView =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error" }
  | { kind: "ready"; frase: string; tendencia: Tendencia | null };

/** Pure derivation: pronóstico del gauge aguas arriba -> qué mostrar (spec 007 T5). No DOM. */
export function deriveAguasArribaView(state: AguasArribaState): AguasArribaView {
  if (state.kind === "loading") return { kind: "loading" };
  if (state.kind === "unavailable") return { kind: "unavailable" };
  if (state.kind !== "ok") return { kind: "error" };

  const dias: readonly DiaPronostico[] = state.data.dias;
  const primero = dias[0];
  const ultimo = dias[dias.length - 1];
  if (!primero || !ultimo) {
    return { kind: "ready", frase: "Todavía no hay pronóstico aguas arriba.", tendencia: null };
  }

  const tendencia = calcularTendencia(ultimo.altura_anclada_m - primero.altura_anclada_m);
  const frase = `Aguas arriba (zona Concordia / Salto Grande), el río podría estar ${formatRangoMetros(
    ultimo.altura_anclada_min_m,
    ultimo.altura_anclada_max_m,
  )} el ${formatDiaSemanaFecha(ultimo.fecha)}. Lo que pasa allá llega a Colón unos días después.`;

  return { kind: "ready", frase, tendencia };
}

function fechaAEpochSegundos(fechaIso: string): number {
  return Math.floor(parseFechaLocal(fechaIso).getTime() / 1000);
}

const tooltipFechaFormatter = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

/**
 * Pure (spec 019 D2): qué dice el tooltip en el día `idx`. Las dos series
 * tienen huecos, así que un día sin ninguno de los dos valores no muestra
 * nada en vez de un tooltip vacío.
 */
export function contenidoTooltipAguasArriba(
  series: AguasArribaChartSeries,
  idx: number,
): string | null {
  const x = series.x[idx];
  if (x === undefined) return null;
  const colon = series.colon[idx] ?? null;
  const arriba = series.aguasArriba[idx] ?? null;
  if (colon === null && arriba === null) return null;
  const filas: string[] = [];
  if (colon !== null) filas.push(`<div>Colón ${formatMetros(colon)}</div>`);
  if (arriba !== null) filas.push(`<div>Aguas arriba ${formatMetros(arriba)}</div>`);
  const fecha = tooltipFechaFormatter.format(new Date(x * 1000));
  return `<strong>${fecha}</strong>${filas.join("")}`;
}

export interface AguasArribaChartSeries {
  x: number[];
  colon: (number | null)[];
  aguasArriba: (number | null)[];
}

/**
 * Pure: alinea el pronóstico de Colón y el de aguas arriba por fecha, en un
 * eje x único y ordenado (mismo patrón que `buildChartSeries`/
 * `buildPrecisionSeries`), con `null` donde a alguna de las dos series le
 * falta ese día. Usa el centro anclado (`altura_anclada_m`) de cada una,
 * igual que el resto de las líneas de pronóstico del dashboard. No DOM.
 */
export function buildAguasArribaChartSeries(
  colon: readonly DiaPronostico[] | null,
  aguasArriba: readonly DiaPronostico[] | null,
): AguasArribaChartSeries {
  const fechas = new Set<string>();
  for (const d of colon ?? []) fechas.add(d.fecha);
  for (const d of aguasArriba ?? []) fechas.add(d.fecha);
  const fechasOrdenadas = Array.from(fechas).sort();

  const colonPorFecha = new Map((colon ?? []).map((d) => [d.fecha, d.altura_anclada_m]));
  const aguasArribaPorFecha = new Map((aguasArriba ?? []).map((d) => [d.fecha, d.altura_anclada_m]));

  return {
    x: fechasOrdenadas.map(fechaAEpochSegundos),
    colon: fechasOrdenadas.map((f) => colonPorFecha.get(f) ?? null),
    aguasArriba: fechasOrdenadas.map((f) => aguasArribaPorFecha.get(f) ?? null),
  };
}

const TITULO = "Aguas arriba";
const FLECHAS: Record<Tendencia, string> = { sube: "▲", baja: "▼", estable: "→" };
const FLECHAS_TEXTO: Record<Tendencia, string> = { sube: "Sube", baja: "Baja", estable: "Estable" };

export function renderAguasArriba(container: HTMLElement, view: AguasArribaView): void {
  if (view.kind === "loading") {
    renderCardSkeleton(container, TITULO);
    return;
  }
  if (view.kind === "unavailable") {
    container.innerHTML = `
      <h2>${TITULO}</h2>
      <p class="card-info" role="status">Pronóstico aguas arriba no disponible por el momento.</p>
    `;
    return;
  }
  if (view.kind === "error") {
    renderCardError(container, TITULO, "No pudimos obtener el pronóstico aguas arriba.");
    return;
  }

  const tendenciaHtml = view.tendencia
    ? `<p class="tendencia">${FLECHAS[view.tendencia]} ${FLECHAS_TEXTO[view.tendencia]} en los próximos días</p>`
    : "";

  // El mini gráfico (Colón vs aguas arriba) se monta aparte, si hay datos de
  // las dos series (ver `mountAguasArriba`); el placeholder queda siempre
  // acá para no dejar un hueco vacío en la tarjeta (diagnóstico de esta
  // tarea: hoy queda con mucho espacio libre debajo del texto).
  container.innerHTML = `
    <h2>${TITULO}</h2>
    <p class="frase-pronostico">${view.frase}</p>
    ${tendenciaHtml}
    <div class="aguas-arriba-chart-wrap">
      <div class="grafico-canvas-wrap">
        <div class="grafico-canvas" id="aguas-arriba-canvas"></div>
        <div class="grafico-tooltip" id="aguas-arriba-tooltip" hidden></div>
      </div>
      <ul class="grafico-leyenda" id="aguas-arriba-leyenda" aria-hidden="true"></ul>
    </div>
  `;
}

const fechaEjeAguasArribaFormatter = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" });

/**
 * (Re)dibuja el mini gráfico "Colón vs aguas arriba", releyendo la paleta
 * en cada llamada (reactividad al tema). Reusa los roles `pronostico`
 * (Colón, verde discontinuo) e `historico` (aguas arriba, violeta
 * punteado) de `graficos/paleta.ts`: mismos tokens que el resto del
 * dashboard, con patrones de guiones ya distintos entre sí.
 */
function dibujarMiniChart(
  canvasEl: HTMLDivElement,
  leyendaEl: HTMLUListElement,
  referenciaColores: HTMLElement,
  series: AguasArribaChartSeries,
  ref: { instancia: uPlot | null },
  tooltip: TooltipGrafico | null,
): void {
  /*
   * Acá el COLOR ES EL LUGAR y el GUIÓN ES EL TIPO de dato. Las dos líneas
   * son pronósticos, así que las dos van punteadas; lo que las distingue es
   * dónde se mide. Colón se queda con el azul que en toda la app significa
   * "acá", y aguas arriba con el verde.
   *
   * Antes leían `--graf-pronostico` y `--graf-historico`, que desde la spec
   * 018 son EL MISMO COLOR: las dos líneas quedaban idénticas salvo por el
   * patrón de guiones. Dos lugares distintos sí son identidad y merecen hue
   * propio (`dataviz`, paleta categórica).
   */
  const colorColon = leerVariableCss("--graf-altura-real", PALETA.light.alturaReal, referenciaColores);
  const colorAguasArriba = leerVariableCss("--graf-pronostico", PALETA.light.pronostico, referenciaColores);
  const colorEje = leerVariableCss("--graf-eje", PALETA.light.ejeTexto, referenciaColores);
  const colorGrilla = leerVariableCss("--graf-grilla", PALETA.light.grilla, referenciaColores);

  leyendaEl.innerHTML = `
    <li><span class="grafico-leyenda-linea" style="background:${fondoTrazoCss(colorColon, TRAZOS.pronostico)};height:${TRAZOS.pronostico.widthPx}px"></span> Colón</li>
    <li><span class="grafico-leyenda-linea" style="background:${fondoTrazoCss(colorAguasArriba, TRAZOS.historico)};height:${TRAZOS.historico.widthPx}px"></span> Aguas arriba</li>
  `;

  ref.instancia?.destroy();
  canvasEl.replaceChildren();
  const width = Math.max(240, canvasEl.clientWidth || referenciaColores.clientWidth || 280);
  ref.instancia = new uPlot(
    {
      width,
      height: 150,
      // Reserva lugar para que el último rótulo del eje X no quede cortado
      // contra el borde del lienzo (menor, revisión de diseño; mismo ajuste
      // que `grafico.ts`), con menos margen que el resto por ser un
      // mini-gráfico angosto.
      padding: [8, 20, 0, 0],
      scales: { x: { time: true } },
      series: [
        {},
        {
          label: "Colón",
          stroke: colorColon,
          points: { show: false },
          ...propsTrazoUplot(TRAZOS.pronostico),
        },
        {
          label: "Aguas arriba",
          stroke: colorAguasArriba,
          points: { show: false },
          ...propsTrazoUplot(TRAZOS.historico),
        },
      ],
      axes: [
        {
          font: "13px system-ui, sans-serif",
          stroke: colorEje,
          grid: { stroke: colorGrilla, width: 1 },
          ticks: { stroke: colorGrilla, width: 1 },
          values: (_u, splits) => splits.map((s) => fechaEjeAguasArribaFormatter.format(new Date(s * 1000))),
        },
        {
          font: "13px system-ui, sans-serif",
          stroke: colorEje,
          grid: { stroke: colorGrilla, width: 1 },
          ticks: { stroke: colorGrilla, width: 1 },
        },
      ],
      legend: { show: false },
      plugins: tooltip ? [tooltip.plugin] : [],
    },
    [series.x, series.colon, series.aguasArriba],
    canvasEl,
  );
}

export interface MontajeMiniChartAguasArriba {
  destroy(): void;
}

function mountMiniChartAguasArriba(container: HTMLElement, series: AguasArribaChartSeries): MontajeMiniChartAguasArriba {
  const canvasEl = container.querySelector<HTMLDivElement>("#aguas-arriba-canvas");
  const leyendaEl = container.querySelector<HTMLUListElement>("#aguas-arriba-leyenda");
  const wrapEl = container.querySelector<HTMLDivElement>(".grafico-canvas-wrap");
  const tooltipEl = container.querySelector<HTMLDivElement>("#aguas-arriba-tooltip");
  if (!canvasEl || !leyendaEl) return { destroy(): void {} };

  const tooltip =
    wrapEl && tooltipEl
      ? crearTooltipGrafico(wrapEl, tooltipEl, (idx) => contenidoTooltipAguasArriba(series, idx))
      : null;

  const ref: { instancia: uPlot | null } = { instancia: null };
  dibujarMiniChart(canvasEl, leyendaEl, container, series, ref, tooltip);

  const desuscribirTema = onTemaCambia(() => {
    tooltip?.ocultar();
    dibujarMiniChart(canvasEl, leyendaEl, container, series, ref, tooltip);
  });

  function manejarResize(): void {
    if (ref.instancia && canvasEl) ref.instancia.setSize({ width: Math.max(240, canvasEl.clientWidth), height: 150 });
  }
  window.addEventListener("resize", manejarResize);

  return {
    destroy(): void {
      desuscribirTema();
      window.removeEventListener("resize", manejarResize);
      ref.instancia?.destroy();
      ref.instancia = null;
    },
  };
}

export interface AguasArribaDeps {
  getPronosticoAguasArriba: typeof getPronosticoAguasArriba;
  getPronostico: typeof getPronostico;
}

const defaultDeps: AguasArribaDeps = { getPronosticoAguasArriba, getPronostico };

export interface MontajeAguasArriba {
  /** Desuscribe del cambio de tema y destruye la instancia de uPlot del mini gráfico, si llegó a montarse. */
  destroy(): void;
}

export function mountAguasArriba(container: HTMLElement, deps: AguasArribaDeps = defaultDeps): MontajeAguasArriba {
  renderAguasArriba(container, deriveAguasArribaView({ kind: "loading" }));

  let chart: MontajeMiniChartAguasArriba | null = null;

  void Promise.all([deps.getPronosticoAguasArriba(), deps.getPronostico()]).then(([aguasArribaResult, colonResult]) => {
    renderAguasArriba(container, deriveAguasArribaView(aguasArribaResult));

    // El mini gráfico necesita las dos series (spec: "pronóstico aguas
    // arriba vs. Colón"); si alguna de las dos no está disponible, se queda
    // solo con el texto (degradación elegante, CLAUDE.md §6).
    if (aguasArribaResult.kind === "ok" && colonResult.kind === "ok") {
      const series = buildAguasArribaChartSeries(colonResult.data.dias, aguasArribaResult.data.dias);
      chart = mountMiniChartAguasArriba(container, series);
    }
  });

  return {
    destroy(): void {
      chart?.destroy();
    },
  };
}
