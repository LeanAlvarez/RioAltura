import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { getAlturasDiarias } from "../api/alturas";
import { getEstadisticas } from "../api/estadisticas";
import { getPronosticoHistorico } from "../api/pronostico";
import type { AlturaDiaria, ErrorPronostico, HistoricoDia } from "../api/types";
import { formatMetros, parseFechaLocal } from "../format";
import { LEAD_DIAS_COMPARADO, RANGO_PRECISION_DIAS } from "../domain/dominio";

function fechaISOLocal(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Pure: "hoy" -> rango `desde`/`hasta` usado para comparar pronóstico a 3 días vs lo que pasó. */
export function calcularRangoPrecision(hoy: Date, dias: number = RANGO_PRECISION_DIAS): { desde: string; hasta: string } {
  const desdeDate = new Date(hoy);
  desdeDate.setDate(desdeDate.getDate() - dias);
  return { desde: fechaISOLocal(desdeDate), hasta: fechaISOLocal(hoy) };
}

function fechaAEpochSegundos(fechaIso: string): number {
  return Math.floor(parseFechaLocal(fechaIso).getTime() / 1000);
}

export interface PrecisionSeries {
  x: number[];
  real: (number | null)[];
  pronosticado: (number | null)[];
}

/** Pure: alinea la altura real con el pronóstico a `lead` días hecho en su momento, por fecha. No DOM. */
export function buildPrecisionSeries(alturas: readonly AlturaDiaria[], historico: readonly HistoricoDia[]): PrecisionSeries {
  const fechas = new Set<string>();
  for (const a of alturas) fechas.add(a.fecha);
  for (const h of historico) fechas.add(h.fecha);
  const ordenadas = Array.from(fechas).sort();

  const realPorFecha = new Map(alturas.map((a) => [a.fecha, a.altura_m]));
  const pronosticoPorFecha = new Map(historico.map((h) => [h.fecha, h.altura_est_m]));

  return {
    x: ordenadas.map(fechaAEpochSegundos),
    real: ordenadas.map((f) => realPorFecha.get(f) ?? null),
    pronosticado: ordenadas.map((f) => pronosticoPorFecha.get(f) ?? null),
  };
}

/** Pure: "el pronóstico le erró medio metro en promedio", en lenguaje llano. No DOM. */
export function describeErrorPronostico(error: ErrorPronostico): string {
  if (error.mae_m === null || error.muestras === 0) {
    return "Todavía no hay suficientes días comparados para calcular el error del pronóstico.";
  }
  return `Mirando los últimos ${error.muestras} días, el pronóstico a ${error.lead_dias} días le erró ${formatMetros(error.mae_m)} en promedio, para arriba o para abajo.`;
}

/**
 * Pure: alternativa de texto al gráfico (ítem 9, correcciones de diseño:
 * replicar "Ver como texto" — ya existía solo en el gráfico principal). No DOM.
 */
export function buildResumenTextoPrecision(series: PrecisionSeries): string {
  const reales = series.real.filter((v): v is number => v !== null);
  if (reales.length === 0) return "Todavía no hay datos reales para comparar en este período.";
  const min = Math.min(...reales);
  const max = Math.max(...reales);
  return `Altura real en el período: entre ${formatMetros(min)} y ${formatMetros(max)}, comparada día a día con lo que decía el pronóstico hecho ${String(LEAD_DIAS_COMPARADO)} días antes.`;
}

export interface PrecisionDeps {
  getAlturasDiarias: typeof getAlturasDiarias;
  getPronosticoHistorico: typeof getPronosticoHistorico;
  getEstadisticas: typeof getEstadisticas;
}

const defaultDeps: PrecisionDeps = { getAlturasDiarias, getPronosticoHistorico, getEstadisticas };

function leerColor(variable: string, fallback: string, referencia: HTMLElement): string {
  const valor = getComputedStyle(referencia).getPropertyValue(variable).trim();
  return valor || fallback;
}

const fechaEjeFormatter = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" });

/**
 * "¿Cuánto acierta el pronóstico?" (spec 007 T4): pronóstico a 3 días hecho
 * en su momento vs lo que pasó, con el error promedio en una frase. Carga
 * sus datos de forma independiente.
 */
export function mountPrecision(container: HTMLElement, deps: PrecisionDeps = defaultDeps): void {
  let instancia: uPlot | null = null;

  container.innerHTML = `
    <h2>¿Cuánto acierta el pronóstico?</h2>
    <p class="precision-frase" id="precision-frase"></p>
    <div class="grafico-canvas" id="precision-canvas"></div>
    <ul class="grafico-leyenda" aria-hidden="true">
      <li><span class="grafico-leyenda-linea" style="--color-linea:var(--fg)"></span> Lo que midió el INA</li>
      <li><span class="grafico-leyenda-linea grafico-leyenda-linea--punteada" style="--color-linea:var(--muted)"></span> Lo que decía el pronóstico</li>
    </ul>
    <p class="grafico-estado" role="status" aria-live="polite"></p>
    <details class="grafico-alternativa">
      <summary>Ver como texto</summary>
      <p class="grafico-resumen"></p>
    </details>
  `;

  const fraseEl = container.querySelector<HTMLParagraphElement>("#precision-frase");
  const canvasEl = container.querySelector<HTMLDivElement>("#precision-canvas");
  const estadoEl = container.querySelector<HTMLParagraphElement>(".grafico-estado");
  const resumenEl = container.querySelector<HTMLParagraphElement>(".grafico-resumen");
  if (!fraseEl || !canvasEl || !estadoEl || !resumenEl) return;

  async function cargar(): Promise<void> {
    if (!fraseEl || !canvasEl || !estadoEl || !resumenEl) return;
    estadoEl.textContent = "Cargando…";
    const ahora = new Date();
    const { desde, hasta } = calcularRangoPrecision(ahora);

    const [alturasResult, historicoResult, estadisticasResult] = await Promise.all([
      deps.getAlturasDiarias(desde, hasta),
      deps.getPronosticoHistorico(LEAD_DIAS_COMPARADO, desde),
      deps.getEstadisticas(),
    ]);

    fraseEl.textContent =
      estadisticasResult.kind === "ok"
        ? describeErrorPronostico(estadisticasResult.data.error_pronostico)
        : "No pudimos calcular el error del pronóstico.";

    if (alturasResult.kind !== "ok" || historicoResult.kind !== "ok") {
      estadoEl.textContent = "No pudimos cargar la comparación día a día.";
      return;
    }
    estadoEl.textContent = "";

    const series = buildPrecisionSeries(alturasResult.data, historicoResult.data);
    resumenEl.textContent = buildResumenTextoPrecision(series);
    const colorReal = leerColor("--fg", "#1c2430", container);
    const colorPronostico = leerColor("--muted", "#7a4fa3", container);

    instancia?.destroy();
    canvasEl.replaceChildren();
    const width = Math.max(280, canvasEl.clientWidth || container.clientWidth || 320);
    instancia = new uPlot(
      {
        width,
        height: 220,
        scales: { x: { time: true } },
        series: [
          {},
          { label: "Altura real", stroke: colorReal, width: 2, points: { show: false } },
          {
            label: `Pronóstico a ${LEAD_DIAS_COMPARADO} días (histórico)`,
            stroke: colorPronostico,
            width: 1.5,
            dash: [5, 4],
            points: { show: false },
          },
        ],
        // L4/M4 (spec 008): ejes >= 13 px, contraste AA (--fg) y menos marcas
        // en el eje X a 360 px.
        axes: [
          {
            font: "13px system-ui, sans-serif",
            stroke: colorReal,
            space: width < 400 ? 70 : 50,
            values: (_u, splits) => splits.map((s) => fechaEjeFormatter.format(new Date(s * 1000))),
          },
          { label: "Altura (metros)", font: "13px system-ui, sans-serif", labelFont: "13px system-ui, sans-serif", stroke: colorReal },
        ],
        legend: { show: false },
      },
      [series.x, series.real, series.pronosticado],
      canvasEl,
    );
  }

  window.addEventListener("resize", () => {
    if (instancia && canvasEl) instancia.setSize({ width: Math.max(280, canvasEl.clientWidth), height: 220 });
  });

  void cargar();
}
