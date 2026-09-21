import type { HealthState } from "./api";

export interface HealthView {
  label: string;
  tone: "ok" | "warn" | "error" | "muted";
}

/**
 * Lenguaje llano (correcciones de diseño, spec 007): "API"/"en línea" es
 * jerga técnica que un vecino sin conocimientos de sistemas no necesita. No
 * lleva fecha/hora: la tarjeta "Hoy" ya muestra cuándo midió el INA (§6), y
 * mezclar ambos "Actualizado" confundía cuál dato era cuál.
 */
export function describeHealth(state: HealthState): HealthView {
  switch (state.kind) {
    case "loading":
      return { label: "Consultando…", tone: "muted" };
    case "unreachable":
      return { label: "Sin conexión con los datos", tone: "error" };
    case "ready":
      return state.health.db === "ok"
        ? { label: "Datos al día", tone: "ok" }
        : { label: "Datos al día, con problemas en la base", tone: "warn" };
  }
}

export function renderHealth(container: HTMLElement, state: HealthState): void {
  const view = describeHealth(state);
  container.dataset.tone = view.tone;
  container.replaceChildren();

  const label = document.createElement("strong");
  label.textContent = view.label;
  container.append(label);
}
