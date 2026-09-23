import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { getAlturasDiarias } from "../api/alturas";
import { getEstadisticas } from "../api/estadisticas";
import type { AlturaDiaria, Evento, RangoAlerta } from "../api/types";
import { formatDiaSemanaFecha, formatMetros, parseFechaLocal } from "../format";
import { PALETA, TRAZOS, leerVariableCss } from "../graficos/paleta";
import { crearTooltipGrafico } from "../graficos/tooltip";
import { onTemaCambia } from "../theme";

/**
 * `/alturas` rechaza rangos de más de 3 años (contracts/openapi.yaml). Se usa
 * casi todo ese margen para cubrir "desde el primer dato disponible" (spec
 * 007 T3): los datos cargados arrancan en 2023, hace bastante menos de 3 años.
 */
export const DIAS_HISTORICO_MAX = 1080;

function fechaISOLocal(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Pure: "hoy" -> rango `desde`/`hasta` que cubre el historial completo disponible. */
export function calcularRangoHistorico(hoy: Date, diasMax: number = DIAS_HISTORICO_MAX): { desde: string; hasta: string } {
  const desdeDate = new Date(hoy);
  desdeDate.setDate(desdeDate.getDate() - diasMax);
  return { desde: fechaISOLocal(desdeDate), hasta: fechaISOLocal(hoy) };
}

function fechaAEpochSegundos(fechaIso: string): number {
  return Math.floor(parseFechaLocal(fechaIso).getTime() / 1000);
}

const tooltipFechaFormatter = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * Pure (spec 019 D2): qué dice el tooltip en el día `idx`. En un gráfico que
 * abarca años, sin esto se ve que hubo una crecida grande y no se puede leer
 * a cuánto llegó ni cuándo fue.
 */
export function contenidoTooltipHistorial(series: HistorialSeries, idx: number): string | null {
  const x = series.x[idx];
  const altura = series.real[idx];
  if (x === undefined || altura === undefined) return null;
  const fecha = tooltipFechaFormatter.format(new Date(x * 1000));
  return `<strong>${fecha}</strong><div>${formatMetros(altura)}</div>`;
}

export interface HistorialSeries {
  x: number[];
  real: number[];
}

/** Pure: alturas diarias (ya ordenadas por fecha ascendente, contrato de `/alturas`) -> serie x/y. No DOM. */
export function buildHistorialSeries(alturas: readonly AlturaDiaria[]): HistorialSeries {
  return {
    x: alturas.map((a) => fechaAEpochSegundos(a.fecha)),
    real: alturas.map((a) => a.altura_m),
  };
}

export interface RangoSombreado {
  desde: number;
  hasta: number;
  max_m: number;
}

/** Pure: rangos de días en alerta -> epoch seconds, para sombrear el fondo del gráfico. */
export function buildRangosSombreados(diasEnAlerta: readonly RangoAlerta[]): RangoSombreado[] {
  return diasEnAlerta.map((r) => ({
    desde: fechaAEpochSegundos(r.desde),
    hasta: fechaAEpochSegundos(r.hasta),
    max_m: r.max_m,
  }));
}

export interface EventoPunto {
  x: number;
  y: number;
  etiqueta: string;
  fecha: string;
}

/** Pure: eventos de referencia -> puntos (x=epoch, y=altura) para marcar sobre la línea. No DOM. */
export function buildEventoPuntos(eventos: readonly Evento[]): EventoPunto[] {
  return eventos.map((e) => ({ x: fechaAEpochSegundos(e.fecha), y: e.altura_m, etiqueta: e.etiqueta, fecha: e.fecha }));
}

/**
 * Pure: alternativa de texto al gráfico (ítem 9, correcciones de diseño:
 * replicar "Ver como texto" — ya existía solo en el gráfico principal). No DOM.
 */
export function buildResumenTextoHistorial(alturas: readonly AlturaDiaria[], eventos: readonly EventoPunto[]): string {
  if (alturas.length === 0) return "Todavía no hay datos de altura real para graficar.";
  const valores = alturas.map((a) => a.altura_m);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const primero = alturas[0];
  const ultimo = alturas[alturas.length - 1];
  let texto = `Altura real: entre ${formatMetros(min)} y ${formatMetros(max)}`;
  if (primero && ultimo) {
    texto += `, desde ${formatDiaSemanaFecha(primero.fecha)} hasta ${formatDiaSemanaFecha(ultimo.fecha)}`;
  }
  texto += ".";
  if (eventos.length > 0) {
    texto += ` Crecidas de referencia: ${eventos.map((e) => `${e.etiqueta} (${formatMetros(e.y)})`).join(", ")}.`;
  }
  return texto;
}

export interface HistorialDeps {
  getAlturasDiarias: typeof getAlturasDiarias;
  getEstadisticas: typeof getEstadisticas;
}

const defaultDeps: HistorialDeps = { getAlturasDiarias, getEstadisticas };

const fechaEjeFormatter = new Intl.DateTimeFormat("es-AR", { month: "short", year: "2-digit" });
const fechaEventoFormatter = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric" });

/**
 * `colorFranja` ya viene con la opacidad aplicada (`--graf-franja-alerta`,
 * `color-mix` resuelto en `graficos/paleta.ts`): acá no hay que envolverlo
 * de nuevo.
 */
function construirHooks(rangos: RangoSombreado[], eventos: EventoPunto[], colorFranja: string, colorReal: string) {
  const drawClear = (u: uPlot): void => {
    const { ctx } = u;
    ctx.save();
    ctx.fillStyle = colorFranja;
    for (const r of rangos) {
      const x0 = Math.max(u.bbox.left, u.valToPos(r.desde, "x", true));
      const x1 = Math.min(u.bbox.left + u.bbox.width, u.valToPos(r.hasta, "x", true));
      if (x1 <= x0) continue;
      ctx.fillRect(x0, u.bbox.top, x1 - x0, u.bbox.height);
    }
    ctx.restore();
  };

  const draw = (u: uPlot): void => {
    const { ctx } = u;
    ctx.save();
    for (const ev of eventos) {
      const x = u.valToPos(ev.x, "x", true);
      const y = u.valToPos(ev.y, "y", true);
      if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) continue;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, 2 * Math.PI);
      ctx.fillStyle = colorReal;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = getComputedStyle(u.root).getPropertyValue("--card-bg") || "#ffffff";
      ctx.stroke();
    }
    ctx.restore();
  };

  return { drawClear: [drawClear], draw: [draw] };
}

function renderListaEventos(container: HTMLUListElement, eventos: EventoPunto[]): void {
  container.innerHTML = eventos
    .map(
      (e) => `
        <li>
          <strong>${formatMetros(e.y)}</strong> — ${e.etiqueta}
          <span class="historial-evento-fecha">${fechaEventoFormatter.format(parseFechaLocal(e.fecha))}</span>
        </li>
      `,
    )
    .join("");
}

export interface MontajeHistorial {
  /** Desuscribe del cambio de tema y destruye la instancia de uPlot. */
  destroy(): void;
}

/**
 * Historial completo (spec 007 T3): desde el primer dato disponible hasta
 * hoy, con los eventos de referencia marcados y los días en alerta
 * sombreados. Carga sus datos de forma independiente (mismo patrón que
 * `mountGrafico`).
 */
export function mountHistorial(container: HTMLElement, deps: HistorialDeps = defaultDeps): MontajeHistorial {
  let instancia: uPlot | null = null;
  let ultimaSeries: HistorialSeries | null = null;
  let ultimosRangos: RangoSombreado[] = [];
  let ultimosPuntos: EventoPunto[] = [];

  container.innerHTML = `
    <h2>Historial completo</h2>
    <p class="card-subtitulo">Todos los datos de altura real cargados hasta hoy, con las crecidas de referencia marcadas.</p>
    <div class="grafico-canvas-wrap">
      <div class="grafico-canvas" id="historial-canvas"></div>
      <div class="grafico-tooltip" id="historial-tooltip" hidden></div>
    </div>
    <ul class="grafico-leyenda" aria-hidden="true">
      <li><span class="historial-leyenda-muestra historial-leyenda-muestra--banda"></span> Las franjas marcan los días en que hubo alerta</li>
      <li><span class="historial-leyenda-muestra historial-leyenda-muestra--punto"></span> Los puntos son las crecidas grandes</li>
    </ul>
    <p class="grafico-estado" role="status" aria-live="polite"></p>
    <ul class="historial-eventos" id="historial-eventos"></ul>
    <details class="grafico-alternativa">
      <summary>Ver como texto</summary>
      <p class="grafico-resumen"></p>
    </details>
  `;

  const canvasEl = container.querySelector<HTMLDivElement>("#historial-canvas");
  const estadoEl = container.querySelector<HTMLParagraphElement>(".grafico-estado");
  const eventosEl = container.querySelector<HTMLUListElement>("#historial-eventos");
  const resumenEl = container.querySelector<HTMLParagraphElement>(".grafico-resumen");
  const wrapEl = container.querySelector<HTMLDivElement>(".grafico-canvas-wrap");
  const tooltipEl = container.querySelector<HTMLDivElement>("#historial-tooltip");
  if (!canvasEl || !estadoEl || !eventosEl || !resumenEl || !wrapEl || !tooltipEl) {
    return { destroy(): void {} };
  }

  const tooltip = crearTooltipGrafico(wrapEl, tooltipEl, (idx) =>
    ultimaSeries ? contenidoTooltipHistorial(ultimaSeries, idx) : null,
  );

  /** (Re)dibuja a partir de los datos ya cargados, releyendo la paleta en cada llamada (reactividad al tema). */
  function dibujar(series: HistorialSeries, rangos: RangoSombreado[], puntos: EventoPunto[]): void {
    if (!canvasEl) return;
    const colorReal = leerVariableCss("--graf-altura-real", PALETA.light.alturaReal, container);
    const colorFranja = leerVariableCss("--graf-franja-alerta", PALETA.light.franjaAlerta, container);
    const colorEje = leerVariableCss("--graf-eje", PALETA.light.ejeTexto, container);
    const colorGrilla = leerVariableCss("--graf-grilla", PALETA.light.grilla, container);

    instancia?.destroy();
    tooltip.ocultar();
    canvasEl.replaceChildren();
    const width = Math.max(280, canvasEl.clientWidth || container.clientWidth || 320);
    instancia = new uPlot(
      {
        width,
        height: 240,
        // Reserva lugar para que el último rótulo del eje X no quede
        // cortado contra el borde del lienzo (menor, revisión de diseño;
        // mismo ajuste que `grafico.ts`).
        padding: [12, 28, 0, 0],
        scales: { x: { time: true } },
        series: [{}, { label: "Altura real", stroke: colorReal, width: TRAZOS.alturaReal.widthPx, points: { show: false } }],
        // L4/M4 (spec 008) + paleta v3: ejes >= 13 px, rol dedicado
        // `--graf-eje`/`--graf-grilla` (contraste AA en los dos temas) y
        // menos marcas en el eje X a 360 px.
        axes: [
          {
            font: "13px system-ui, sans-serif",
            stroke: colorEje,
            grid: { stroke: colorGrilla, width: 1 },
            ticks: { stroke: colorGrilla, width: 1 },
            space: width < 400 ? 70 : 50,
            values: (_u, splits) => splits.map((s) => fechaEjeFormatter.format(new Date(s * 1000))),
          },
          {
            label: "Altura (metros)",
            font: "13px system-ui, sans-serif",
            labelFont: "13px system-ui, sans-serif",
            stroke: colorEje,
            grid: { stroke: colorGrilla, width: 1 },
            ticks: { stroke: colorGrilla, width: 1 },
          },
        ],
        legend: { show: false },
        plugins: [tooltip.plugin],
        hooks: construirHooks(rangos, puntos, colorFranja, colorReal),
      },
      [series.x, series.real],
      canvasEl,
    );
  }

  async function cargar(): Promise<void> {
    if (!canvasEl || !estadoEl || !eventosEl || !resumenEl) return;
    estadoEl.textContent = "Cargando…";
    const ahora = new Date();
    const { desde, hasta } = calcularRangoHistorico(ahora);

    const [alturasResult, estadisticasResult] = await Promise.all([
      deps.getAlturasDiarias(desde, hasta),
      deps.getEstadisticas(),
    ]);

    if (alturasResult.kind !== "ok" || alturasResult.data.length === 0) {
      estadoEl.textContent = "No pudimos cargar el historial de altura real.";
      return;
    }

    const eventos = estadisticasResult.kind === "ok" ? estadisticasResult.data.eventos : [];
    const rangosAlerta = estadisticasResult.kind === "ok" ? estadisticasResult.data.dias_en_alerta : [];

    estadoEl.textContent = estadisticasResult.kind === "ok" ? "" : "No pudimos cargar los eventos de referencia.";

    const series = buildHistorialSeries(alturasResult.data);
    const rangos = buildRangosSombreados(rangosAlerta);
    const puntos = buildEventoPuntos(eventos);
    renderListaEventos(eventosEl, puntos);
    resumenEl.textContent = buildResumenTextoHistorial(alturasResult.data, puntos);

    ultimaSeries = series;
    ultimosRangos = rangos;
    ultimosPuntos = puntos;
    dibujar(series, rangos, puntos);
  }

  const desuscribirTema = onTemaCambia(() => {
    if (ultimaSeries) dibujar(ultimaSeries, ultimosRangos, ultimosPuntos);
  });

  function manejarResize(): void {
    if (instancia && canvasEl) instancia.setSize({ width: Math.max(280, canvasEl.clientWidth), height: 240 });
  }
  window.addEventListener("resize", manejarResize);

  void cargar();

  return {
    destroy(): void {
      desuscribirTema();
      window.removeEventListener("resize", manejarResize);
      instancia?.destroy();
      instancia = null;
    },
  };
}
