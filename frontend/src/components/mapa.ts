/**
 * Mounts the flood map defensively. `map.ts` belongs to spec 006 — this
 * module only dynamically imports it and, if it exposes `setNivelPronosticado`,
 * calls it with the maximum estimated level. If the module or that export
 * does not exist yet (or throws), the page still works: a placeholder is
 * shown instead.
 */

export interface MapModule {
  createMap?: (container: HTMLElement) => unknown;
  setNivelPronosticado?: (nivelM: number) => void;
  setNivelActual?: (nivelM: number) => void;
}

function renderPlaceholder(container: HTMLElement): void {
  container.innerHTML = `
    <p class="map-placeholder">El mapa de inundación estará disponible próximamente.</p>
  `;
}

export async function mountMapa(
  container: HTMLElement,
  nivelMaximoM: number | null,
  nivelActualM: number | null = null,
  loadModule: () => Promise<MapModule> = () => import("../map"),
): Promise<void> {
  let mod: MapModule;
  try {
    mod = await loadModule();
  } catch {
    renderPlaceholder(container);
    return;
  }

  if (typeof mod.createMap !== "function") {
    renderPlaceholder(container);
    return;
  }

  try {
    mod.createMap(container);
  } catch {
    renderPlaceholder(container);
    return;
  }

  if (nivelMaximoM !== null && typeof mod.setNivelPronosticado === "function") {
    try {
      mod.setNivelPronosticado(nivelMaximoM);
    } catch {
      // El mapa ya se montó; no tumbamos la página por esto.
    }
  }

  if (nivelActualM !== null && typeof mod.setNivelActual === "function") {
    try {
      mod.setNivelActual(nivelActualM);
    } catch {
      // El mapa ya se montó; no tumbamos la página por esto.
    }
  }
}
