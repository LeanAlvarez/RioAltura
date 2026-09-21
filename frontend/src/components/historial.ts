import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { getAlturasDiarias } from "../api/alturas";
import { getEstadisticas } from "../api/estadisticas";
import type { AlturaDiaria, Evento, RangoAlerta } from "../api/types";
import { formatDiaSemanaFecha, formatMetros, parseFechaLocal } from "../format";

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

function leerColor(variable: string, fallback: string, referencia: HTMLElement): string {
  const valor = getComputedStyle(referencia).getPropertyValue(variable).trim();
  return valor || fallback;
}

function construirHooks(rangos: RangoSombreado[], eventos: EventoPunto[], colorAviso: string, colorReal: string) {
  const drawClear = (u: uPlot): void => {
    const { ctx } = u;
    ctx.save();
    ctx.fillStyle = `color-mix(in srgb, ${colorAviso} 18%, transparent)`;
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

/**
 * Historial completo (spec 007 T3): desde el primer dato disponible hasta
 * hoy, con los eventos de referencia marcados y los días en alerta
 * sombreados. Carga sus datos de forma independiente (mismo patrón que
 * `mountGrafico`).
 */
export function mountHistorial(container: HTMLElement, deps: HistorialDeps = defaultDeps): void {
  let instancia: uPlot | null = null;

  container.innerHTML = `
    <h2>Historial completo</h2>
    <p class="card-subtitulo">Todos los datos de altura real cargados hasta hoy, con las crecidas de referencia marcadas.</p>
    <div class="grafico-canvas" id="historial-canvas"></div>
    <ul class="grafico-leyenda" aria-hidden="true">
      <li><span class="historial-leyenda-muestra historial-leyenda-muestra--banda"></span> Franja: días en alerta o evacuación</li>
      <li><span class="historial-leyenda-muestra historial-leyenda-muestra--punto"></span> Punto: crecida de referencia</li>
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
  if (!canvasEl || !estadoEl || !eventosEl || !resumenEl) return;

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

    const colorReal = leerColor("--fg", "#1c2430", container);
    const colorAviso = leerColor("--warn", "#a35d00", container);

    instancia?.destroy();
    canvasEl.replaceChildren();
    const width = Math.max(280, canvasEl.clientWidth || container.clientWidth || 320);
    instancia = new uPlot(
      {
        width,
        height: 240,
        scales: { x: { time: true } },
        series: [{}, { label: "Altura real", stroke: colorReal, width: 1.5, points: { show: false } }],
        axes: [
          { values: (_u, splits) => splits.map((s) => fechaEjeFormatter.format(new Date(s * 1000))) },
          { label: "Altura (metros)" },
        ],
        legend: { show: false },
        hooks: construirHooks(rangos, puntos, colorAviso, colorReal),
      },
      [series.x, series.real],
      canvasEl,
    );
  }

  window.addEventListener("resize", () => {
    if (instancia && canvasEl) instancia.setSize({ width: Math.max(280, canvasEl.clientWidth), height: 240 });
  });

  void cargar();
}
