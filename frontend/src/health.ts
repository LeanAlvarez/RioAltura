import type { HealthState } from "./api";

export interface HealthView {
  label: string;
  detail: string;
  tone: "ok" | "warn" | "error" | "muted";
}

const timeFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
});

export function formatCheckedAt(date: Date, formatter: Intl.DateTimeFormat = timeFormatter): string {
  return `Actualizado: ${formatter.format(date)}`;
}

export function describeHealth(state: HealthState): HealthView {
  switch (state.kind) {
    case "loading":
      return { label: "Consultando la API…", detail: "", tone: "muted" };
    case "unreachable":
      return {
        label: "API no disponible",
        detail: formatCheckedAt(state.checkedAt),
        tone: "error",
      };
    case "ready":
      return state.health.db === "ok"
        ? { label: "API en línea", detail: formatCheckedAt(state.checkedAt), tone: "ok" }
        : {
            label: "API en línea, base de datos con problemas",
            detail: formatCheckedAt(state.checkedAt),
            tone: "warn",
          };
  }
}

export function renderHealth(container: HTMLElement, state: HealthState): void {
  const view = describeHealth(state);
  container.dataset.tone = view.tone;
  container.replaceChildren();

  const label = document.createElement("strong");
  label.textContent = view.label;
  container.append(label);

  if (view.detail) {
    const detail = document.createElement("small");
    detail.textContent = view.detail;
    container.append(detail);
  }
}
