import type { FetchResult } from "../api/client";
import type { UltimaAltura } from "../api/types";
import { describeDistanciaUmbral, describeEstado } from "../domain/estado";
import { buildReglaHidrometricaHtml, deriveReglaHidrometricaView } from "../domain/reglaHidrometrica";
import { formatMetros, formatMomentoMedicion, formatTendencia } from "../format";

export type EstadoHoyState = { kind: "loading" } | FetchResult<UltimaAltura>;

export type EstadoHoyView =
  | { kind: "loading" }
  | { kind: "error" }
  | {
      kind: "ready";
      alturaM: number;
      altura: string;
      estadoLabel: string;
      estadoTono: "ok" | "warn" | "error" | "danger";
      distanciaUmbral: string;
      tendencia: string;
      medicion: string;
    };

/** Pure derivation: state + current time -> what the card should show. No DOM. */
export function deriveEstadoHoyView(state: EstadoHoyState, ahora: Date): EstadoHoyView {
  if (state.kind === "loading") return { kind: "loading" };
  if (state.kind !== "ok") return { kind: "error" };

  const { data } = state;
  const fecha = new Date(data.fecha_hora);
  const estado = describeEstado(data.estado);

  return {
    kind: "ready",
    alturaM: data.altura_m,
    altura: formatMetros(data.altura_m),
    estadoLabel: estado.label,
    estadoTono: estado.tono,
    distanciaUmbral: describeDistanciaUmbral(data.altura_m),
    tendencia: formatTendencia(data.tendencia_24h_m),
    // Correcciones de diseño (spec 007, ítem 4): el atraso del INA es su
    // operación normal (CLAUDE.md, "Fuera de alcance"), no un aviso de
    // riesgo: se dice sin color de alarma y sin umbral interno. La
    // fecha/hora del dato sigue visible (CLAUDE.md §6).
    medicion: `Última medición del puerto: ${formatMomentoMedicion(fecha, ahora)}.`,
  };
}

const TITULO = "Hoy";

/**
 * L5 (spec 008): la regla hidrométrica va siempre junto a "Hoy", incluso
 * mientras carga o si falla la altura actual (sin la marca de hoy en esos
 * casos), para que la tarjeta no cambie de forma cuando llega el dato.
 */
export function renderEstadoHoy(container: HTMLElement, view: EstadoHoyView): void {
  if (view.kind === "loading") {
    container.innerHTML = `
      <div class="estado-hoy-layout">
        <div>
          <h2>${TITULO}</h2>
          <div class="skeleton" role="status" aria-label="Cargando ${TITULO}">
            <div class="skeleton-line skeleton-line--wide"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line skeleton-line--short"></div>
          </div>
        </div>
        ${buildReglaHidrometricaHtml(deriveReglaHidrometricaView(null))}
      </div>
    `;
    return;
  }
  if (view.kind === "error") {
    container.innerHTML = `
      <div class="estado-hoy-layout">
        <div>
          <h2>${TITULO}</h2>
          <p class="card-error" role="alert">No pudimos obtener la altura actual del río. Reintentá en unos minutos.</p>
        </div>
        ${buildReglaHidrometricaHtml(deriveReglaHidrometricaView(null))}
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="estado-hoy-layout">
      <div>
        <h2>${TITULO}</h2>
        <p class="altura-actual">${view.altura}</p>
        <p class="badge" data-tono="${view.estadoTono}">${view.estadoLabel}</p>
        <p class="umbral-distancia">${view.distanciaUmbral}</p>
        <p class="tendencia">${view.tendencia === "Estable" ? "No subió ni bajó en el último día" : `${view.tendencia} en las últimas 24 h`}</p>
        <p class="medicion">${view.medicion}</p>
      </div>
      ${buildReglaHidrometricaHtml(deriveReglaHidrometricaView(view.alturaM))}
    </div>
  `;
}
