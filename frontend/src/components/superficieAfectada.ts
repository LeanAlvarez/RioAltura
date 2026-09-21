import { fetchCapaIndex, formatAltura, formatHectareas, resolveNivel, SELECCION_INICIAL, type CapaIndex } from "../capas";

export interface PuntoCurva {
  h: number;
  hectareas: number;
}

/** Pure: index.json -> puntos (altura, hectáreas) de la curva, en el orden del contrato (ascendente por h). No DOM. */
export function buildCurvaPuntos(index: CapaIndex): PuntoCurva[] {
  return index.capas.map((c) => ({ h: c.h, hectareas: c.hectareas }));
}

export interface PuntoSvg {
  x: number;
  y: number;
}

/**
 * Pure: escala los puntos (h, hectáreas) a coordenadas SVG (`width`x`height`),
 * con y invertido (más hectáreas = más arriba). No DOM.
 */
export function escalarCurva(puntos: readonly PuntoCurva[], width: number, height: number): PuntoSvg[] {
  if (puntos.length === 0) return [];
  const hs = puntos.map((p) => p.h);
  const has = puntos.map((p) => p.hectareas);
  const hMin = Math.min(...hs);
  const hMax = Math.max(...hs);
  const haMin = Math.min(...has);
  const haMax = Math.max(...has, haMin + 1); // evita división por cero si todas las hectáreas son iguales
  const rangoH = hMax - hMin || 1;
  const rangoHa = haMax - haMin;

  return puntos.map((p) => ({
    x: ((p.h - hMin) / rangoH) * width,
    y: height - ((p.hectareas - haMin) / rangoHa) * height,
  }));
}

/** Pure: "si el río llega a X m, aproximadamente Y ha podrían quedar bajo el agua" (spec 007 T7). No DOM. */
export function describeSuperficie(index: CapaIndex, seleccionM: number): string {
  const resuelto = resolveNivel(index, seleccionM);
  return `Si el río llega a ${formatAltura(resuelto.mostrado)}, aproximadamente ${formatHectareas(resuelto.entry.hectareas)} podrían quedar bajo el agua.`;
}

interface MapModuleConSeleccion {
  seleccionar?: (h: number) => void;
  onSeleccionCambia?: (cb: (h: number) => void) => () => void;
}

export interface SuperficieAfectadaDeps {
  fetchCapaIndex: typeof fetchCapaIndex;
  loadMapModule: () => Promise<MapModuleConSeleccion>;
}

const defaultDeps: SuperficieAfectadaDeps = {
  fetchCapaIndex,
  loadMapModule: () => import("../map"),
};

const ANCHO_SVG = 320;
const ALTO_SVG = 120;
// Márgenes para los rótulos de eje (ítem 9, correcciones de diseño; L4 spec
// 008: >= 13 px de fuente, así que el margen crece un poco para que no se
// corten). La curva original no tenía ningún eje, así que ninguna de las dos
// escalas (metros / hectáreas) era legible sin adivinar.
const MARGEN_IZQUIERDO = 58;
const MARGEN_INFERIOR = 22;

/**
 * "Superficie afectada" (spec 007 T7): curva de hectáreas inundadas por
 * altura, sincronizada en los dos sentidos con el slider del mapa (se
 * conecta al módulo `map.ts` compartido, cargado en `mountMapa`, spec 006).
 */
export function mountSuperficieAfectada(container: HTMLElement, deps: SuperficieAfectadaDeps = defaultDeps): void {
  container.innerHTML = `
    <h2>Superficie afectada</h2>
    <p class="superficie-estado" role="status" aria-live="polite">Cargando…</p>
  `;
  const estadoEl = container.querySelector<HTMLParagraphElement>(".superficie-estado");

  void deps.fetchCapaIndex().then(
    (index) => {
      if (!estadoEl) return;
      const puntos = buildCurvaPuntos(index);
      const escalados = escalarCurva(puntos, ANCHO_SVG, ALTO_SVG);
      const polylinePoints = escalados.map((p) => `${String(p.x)},${String(p.y)}`).join(" ");
      const hectareasTodas = puntos.map((p) => p.hectareas);
      const haMin = Math.min(...hectareasTodas);
      const haMax = Math.max(...hectareasTodas);
      const anchoTotal = ANCHO_SVG + MARGEN_IZQUIERDO;
      const altoTotal = ALTO_SVG + MARGEN_INFERIOR;

      container.innerHTML = `
        <h2>Superficie afectada</h2>
        <p class="card-subtitulo">Hectáreas que podrían inundarse según la altura del puerto.</p>
        <svg class="superficie-svg" viewBox="0 0 ${String(anchoTotal)} ${String(altoTotal)}" role="img" aria-label="Curva de hectáreas inundadas según la altura del río">
          <text class="superficie-eje-etiqueta" x="${String(MARGEN_IZQUIERDO - 4)}" y="9" text-anchor="end">${formatHectareas(haMax)}</text>
          <text class="superficie-eje-etiqueta" x="${String(MARGEN_IZQUIERDO - 4)}" y="${String(ALTO_SVG)}" text-anchor="end">${formatHectareas(haMin)}</text>
          <g transform="translate(${String(MARGEN_IZQUIERDO)}, 0)">
            <polyline points="${polylinePoints}" class="superficie-curva-linea" />
            <circle class="superficie-curva-punto" r="4" cx="0" cy="0" />
          </g>
          <text class="superficie-eje-etiqueta" x="${String(MARGEN_IZQUIERDO)}" y="${String(altoTotal - 2)}" text-anchor="start">${formatAltura(index.nivel_min)}</text>
          <text class="superficie-eje-etiqueta" x="${String(anchoTotal)}" y="${String(altoTotal - 2)}" text-anchor="end">${formatAltura(index.nivel_max)}</text>
        </svg>
        <input type="range" class="superficie-slider" min="${String(index.nivel_min)}" max="${String(index.nivel_max)}" step="${String(index.paso.hasta_1050)}" value="${String(SELECCION_INICIAL)}" aria-label="Altura del puerto" />
        <p class="superficie-texto"></p>
      `;

      const puntoEl = container.querySelector<SVGCircleElement>(".superficie-curva-punto");
      const sliderEl = container.querySelector<HTMLInputElement>(".superficie-slider");
      const textoEl = container.querySelector<HTMLParagraphElement>(".superficie-texto");
      if (!puntoEl || !sliderEl || !textoEl) return;

      let sincronizando = false;

      function actualizar(h: number): void {
        if (!puntoEl || !sliderEl || !textoEl) return;
        const resuelto = resolveNivel(index, h);
        const puntoResuelto = escalarCurva([{ h: resuelto.entry.h, hectareas: resuelto.entry.hectareas }], ANCHO_SVG, ALTO_SVG)[0];
        if (puntoResuelto) {
          puntoEl.setAttribute("cx", String(puntoResuelto.x));
          puntoEl.setAttribute("cy", String(puntoResuelto.y));
        }
        sliderEl.value = String(h);
        textoEl.textContent = describeSuperficie(index, h);
      }

      actualizar(Number(sliderEl.value));

      void deps.loadMapModule().then((mod) => {
        if (typeof mod.onSeleccionCambia === "function") {
          mod.onSeleccionCambia((h) => {
            sincronizando = true;
            actualizar(h);
            sincronizando = false;
          });
        }

        sliderEl.addEventListener("input", () => {
          if (sincronizando) return;
          const h = Number(sliderEl.value);
          actualizar(h);
          mod.seleccionar?.(h);
        });
      });
    },
    () => {
      if (estadoEl) estadoEl.textContent = "No pudimos cargar la superficie afectada.";
    },
  );
}
