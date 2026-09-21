import {
  INDICACIONES,
  QUE_HACER_HABILITADO,
  TELEFONOS,
  type IndicacionNivel,
  type Telefono,
} from "../config/queHacer";
import type { NivelAviso } from "../api/types";

export interface QueHacerView {
  titulo: string;
  pasos: readonly string[];
  telefonos: readonly Telefono[];
}

export interface QueHacerDeps {
  habilitado: boolean;
  indicaciones: readonly IndicacionNivel[];
  telefonos: readonly Telefono[];
}

const defaultDeps: QueHacerDeps = {
  habilitado: QUE_HACER_HABILITADO,
  indicaciones: INDICACIONES,
  telefonos: TELEFONOS,
};

/**
 * La tarjeta "qué hacer" para un nivel de aviso, o `null` cuando no hay nada
 * que mostrar: el flag apagado, o sin indicaciones confirmadas para ese nivel.
 * Devolver `null` es el caso normal hoy (ver `config/queHacer.ts`).
 */
export function deriveQueHacerView(
  nivel: NivelAviso,
  deps: QueHacerDeps = defaultDeps,
): QueHacerView | null {
  if (!deps.habilitado) return null;
  const indicacion = deps.indicaciones.find((i) => i.nivel === nivel);
  if (!indicacion || indicacion.pasos.length === 0) return null;
  return { titulo: indicacion.titulo, pasos: indicacion.pasos, telefonos: deps.telefonos };
}

export function renderQueHacer(container: HTMLElement, view: QueHacerView | null): void {
  if (view === null) {
    container.innerHTML = "";
    container.hidden = true;
    return;
  }
  container.hidden = false;
  const pasos = view.pasos.map((paso) => `<li>${paso}</li>`).join("");
  const telefonos = view.telefonos
    .map((t) => `<li><span class="telefono-nombre">${t.nombre}</span> ${t.numero}</li>`)
    .join("");
  container.innerHTML = `
    <h2>${view.titulo}</h2>
    <ol class="que-hacer-pasos">${pasos}</ol>
    ${telefonos === "" ? "" : `<ul class="que-hacer-telefonos">${telefonos}</ul>`}
  `;
}
