import type { FetchResult } from "../api/client";
import type { Pronostico, PronosticoAguasArriba } from "../api/types";
import { formatCaudal, formatDiaCorto } from "../format";

export interface FilaCaudal {
  dia: string;
  caudal: string;
}

export interface DetalleTecnicoView {
  emitidoColon: string | null;
  gaugeColon: string | null;
  filasColon: FilaCaudal[];
  emitidoAguasArriba: string | null;
  gaugeAguasArriba: string | null;
  filasAguasArriba: FilaCaudal[];
}

const emitidoFormatter = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });

function formatEmitido(iso: string): string | null {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;
  return emitidoFormatter.format(fecha);
}

/** Pure derivation: caudal (m³/s) del pronóstico de ambos gauges, solo para el detalle técnico colapsado (spec 007 T8). No DOM. */
export function deriveDetalleTecnicoView(
  pronostico: FetchResult<Pronostico>,
  aguasArriba: FetchResult<PronosticoAguasArriba>,
): DetalleTecnicoView {
  const colon = pronostico.kind === "ok" ? pronostico.data : null;
  const arriba = aguasArriba.kind === "ok" ? aguasArriba.data : null;

  return {
    emitidoColon: colon ? formatEmitido(colon.emitido) : null,
    gaugeColon: colon?.gauge_id ?? null,
    filasColon: (colon?.dias ?? []).map((d) => ({ dia: formatDiaCorto(d.fecha), caudal: formatCaudal(d.caudal_m3s) })),
    emitidoAguasArriba: arriba ? formatEmitido(arriba.emitido) : null,
    gaugeAguasArriba: arriba?.gauge_id ?? null,
    filasAguasArriba: (arriba?.dias ?? []).map((d) => ({ dia: formatDiaCorto(d.fecha), caudal: formatCaudal(d.caudal_m3s) })),
  };
}

function renderTabla(filas: FilaCaudal[]): string {
  if (filas.length === 0) return "<p class=\"card-info\">Sin datos.</p>";
  const filasHtml = filas
    .map((f) => `<tr><td>${f.dia}</td><td>${f.caudal}</td></tr>`)
    .join("");
  return `
    <table class="detalle-tabla">
      <thead><tr><th>Día</th><th>Caudal pronosticado</th></tr></thead>
      <tbody>${filasHtml}</tbody>
    </table>
  `;
}

export function renderDetalleTecnico(container: HTMLElement, view: DetalleTecnicoView): void {
  container.innerHTML = `
    <details class="detalle-tecnico">
      <summary>Detalle técnico</summary>
      <div class="detalle-tecnico-contenido">
        <h3>Colón</h3>
        <p class="card-subtitulo">
          Gauge: <code>${view.gaugeColon ?? "—"}</code>.
          Emitido: ${view.emitidoColon ?? "sin datos"}.
        </p>
        ${renderTabla(view.filasColon)}

        <h3>Aguas arriba (Concordia / Salto Grande)</h3>
        <p class="card-subtitulo">
          Gauge: <code>${view.gaugeAguasArriba ?? "—"}</code>.
          Emitido: ${view.emitidoAguasArriba ?? "sin datos"}.
        </p>
        ${renderTabla(view.filasAguasArriba)}

        <h3>Fuentes y metodología</h3>
        <p class="card-subtitulo">
          Caudal pronosticado: Google Flood Forecasting API. Altura real: INA (respaldo Prefectura Naval
          Argentina). Altura estimada: curva de calibración caudal → altura del puerto de Colón
          (R² 0,82, error p90 ≈ 1,1 m). El rango mostrado en las demás tarjetas es siempre una banda
          de ±1 m sobre esa curva, ajustada ("anclada") a la altura real de hoy cuando hay dato
          disponible. El nivel de aviso se calcula por caudal pronosticado a 3 días, no por la altura
          anclada.
        </p>
      </div>
    </details>
  `;
}

export interface DetalleTecnicoDeps {
  getPronostico: () => Promise<FetchResult<Pronostico>>;
  getPronosticoAguasArriba: () => Promise<FetchResult<PronosticoAguasArriba>>;
}

export function mountDetalleTecnico(container: HTMLElement, deps: DetalleTecnicoDeps): void {
  renderDetalleTecnico(container, deriveDetalleTecnicoView({ kind: "error" }, { kind: "error" }));
  void Promise.all([deps.getPronostico(), deps.getPronosticoAguasArriba()]).then(([pronostico, aguasArriba]) => {
    renderDetalleTecnico(container, deriveDetalleTecnicoView(pronostico, aguasArriba));
  });
}
