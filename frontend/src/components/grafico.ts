import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { getAlturasDiarias } from "../api/alturas";
import { getPronostico, getPronosticoHistorico } from "../api/pronostico";
import type { AlturaDiaria, DiaPronostico, HistoricoDia } from "../api/types";
import { ALERTA_M, EVACUACION_EN_SECO_M, EVACUACION_M } from "../domain/dominio";
import { formatDiaSemanaFecha, formatMetros, formatRangoMetros, parseFechaLocal } from "../format";

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
 * Pure: aligns real levels, current forecast (band + centre) and optional
 * historical forecast onto one shared, sorted, de-duplicated x-axis (epoch
 * seconds), with `null` where a series has no data for that day. No DOM.
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
    pronosticoMin: fechasOrdenadas.map((f) => pronosticoPorFecha.get(f)?.altura_min_m ?? null),
    pronosticoMax: fechasOrdenadas.map((f) => pronosticoPorFecha.get(f)?.altura_max_m ?? null),
    pronosticoCentro: fechasOrdenadas.map((f) => pronosticoPorFecha.get(f)?.altura_est_m ?? null),
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
    const maxCentro = pronostico.reduce((m, d) => (d.altura_max_m > m.altura_max_m ? d : m));
    texto += ` Pronóstico: podría llegar a ${formatRangoMetros(maxCentro.altura_min_m, maxCentro.altura_max_m)} el ${formatDiaSemanaFecha(maxCentro.fecha)}.`;
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

const THRESHOLD_DEFS: ReadonlyArray<{ valor: number; label: string; variable: string; fallback: string }> = [
  { valor: EVACUACION_EN_SECO_M, label: "Evacuación en seco", variable: "--warn", fallback: "#a35d00" },
  { valor: ALERTA_M, label: "Alerta", variable: "--error", fallback: "#b3261e" },
  { valor: EVACUACION_M, label: "Evacuación", variable: "--danger", fallback: "#7a1014" },
];

/** Lee un color desde una custom property CSS, para que el gráfico se adapte a modo claro/oscuro. */
function leerColor(variable: string, fallback: string, referencia: HTMLElement): string {
  const valor = getComputedStyle(referencia).getPropertyValue(variable).trim();
  return valor || fallback;
}

function construirColores(referencia: HTMLElement) {
  return {
    real: leerColor("--fg", "#1c2430", referencia),
    pronostico: leerColor("--accent", "#1b6ea8", referencia),
    historico: leerColor("--muted", "#7a4fa3", referencia),
    thresholds: THRESHOLD_DEFS.map((t) => ({ ...t, color: leerColor(t.variable, t.fallback, referencia) })),
  };
}

function construirOpciones(width: number, mostrarHistorico: boolean, referencia: HTMLElement): uPlot.Options {
  const colores = construirColores(referencia);
  const uPlotSeries: uPlot.Series[] = [
    {},
    { label: "Altura real", stroke: colores.real, width: 2, points: { show: false } },
    { label: "Pronóstico (mín.)", stroke: "transparent", width: 0, points: { show: false } },
    {
      label: "Pronóstico (máx.)",
      stroke: colores.pronostico,
      fill: `color-mix(in srgb, ${colores.pronostico} 15%, transparent)`,
      width: 0,
      points: { show: false },
    },
    { label: "Pronóstico (centro)", stroke: colores.pronostico, width: 2, dash: [6, 4], points: { show: false } },
  ];

  if (mostrarHistorico) {
    uPlotSeries.push({
      label: "Pronóstico a 3 días (histórico)",
      stroke: colores.historico,
      width: 1,
      points: { show: false },
    });
  }

  for (const t of colores.thresholds) {
    uPlotSeries.push({
      label: t.label,
      stroke: t.color,
      width: 1,
      dash: [4, 4],
      points: { show: false },
    });
  }

  return {
    width,
    height: 260,
    scales: { x: { time: true } },
    series: uPlotSeries,
    bands: [{ series: [2, 3] }],
    axes: [{}, { label: "metros" }],
    legend: { show: true },
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

/**
 * Owns the range selector / historical toggle, fetches data (independently
 * of the other cards) and (re)draws the uPlot chart. Not unit-tested (uPlot
 * needs a real canvas); `buildChartSeries`/`buildResumenTexto` above carry
 * the tested logic.
 */
export function mountGrafico(container: HTMLElement, deps: GraficoDeps = defaultDeps): void {
  const estado: EstadoGrafico = { rango: 90, mostrarHistorico: false };
  let instancia: uPlot | null = null;

  container.innerHTML = `
    <h2>Evolución y pronóstico</h2>
    <div class="grafico-controles">
      <div class="rango-selector" role="group" aria-label="Rango de días">
        ${RANGOS.map((r) => `<button type="button" data-rango="${r}" aria-pressed="${r === estado.rango}">${r} días</button>`).join("")}
      </div>
      <label class="toggle-historico">
        <input type="checkbox" id="toggle-historico" />
        Mostrar pronóstico a 3 días que se hizo en su momento
      </label>
    </div>
    <div class="grafico-canvas" id="grafico-canvas"></div>
    <p class="grafico-estado" role="status" aria-live="polite"></p>
    <details class="grafico-alternativa">
      <summary>Ver como texto</summary>
      <p class="grafico-resumen"></p>
    </details>
  `;

  const canvasEl = container.querySelector<HTMLDivElement>("#grafico-canvas");
  const estadoEl = container.querySelector<HTMLParagraphElement>(".grafico-estado");
  const resumenEl = container.querySelector<HTMLParagraphElement>(".grafico-resumen");
  const toggleEl = container.querySelector<HTMLInputElement>("#toggle-historico");
  if (!canvasEl || !estadoEl || !resumenEl || !toggleEl) return;

  async function actualizar(): Promise<void> {
    if (!estadoEl || !canvasEl || !resumenEl) return;
    estadoEl.textContent = "Cargando…";

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
    estadoEl.textContent =
      pronosticoResult.kind === "ok" ? "" : "El pronóstico no está disponible; se muestra solo la altura real.";
    resumenEl.textContent = buildResumenTexto(alturasResult.data, dias);

    instancia?.destroy();
    const width = Math.max(280, canvasEl.clientWidth || container.clientWidth || 320);
    canvasEl.replaceChildren();
    instancia = new uPlot(
      construirOpciones(width, estado.mostrarHistorico, container),
      construirDatos(series, estado.mostrarHistorico),
      canvasEl,
    );
  }

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

  window.addEventListener("resize", () => {
    if (instancia && canvasEl) instancia.setSize({ width: Math.max(280, canvasEl.clientWidth), height: 260 });
  });

  void actualizar();
}
