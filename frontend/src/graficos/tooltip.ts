import type uPlot from "uplot";

/**
 * Capa de hover compartida por los gráficos de serie temporal (spec 019).
 *
 * `dataviz` la pide por defecto: un gráfico en HTML es interactivo, y sin
 * esto se ve la forma de la curva pero no se puede leer un valor. En el
 * historial completo, que abarca años, eso significaba ver que hubo una
 * crecida grande en mayo de 2024 sin poder leer a cuánto llegó.
 *
 * Es un plugin de uPlot y no un listener de `mousemove` a propósito: el hook
 * `setCursor` se dispara igual con mouse que con el dedo, así que no hace
 * falta duplicar la lógica para `touchmove` ni pelearse con el orden en que
 * uPlot actualiza su cursor.
 */

/** Cuánto se separa el tooltip del cursor, y del borde del lienzo. */
const SEPARACION_PX = 12;
const MARGEN_PX = 4;

export interface TooltipGrafico {
  /** Se pasa en `opts.plugins`. */
  readonly plugin: uPlot.Plugin;
  ocultar(): void;
}

/**
 * `contenido` recibe el índice apuntado y devuelve el HTML del tooltip, o
 * `null` si ese día no tiene ningún valor que mostrar (huecos de la serie).
 * Conviene que sea una función pura sobre las series ya calculadas: así se
 * testea sin DOM.
 */
export function crearTooltipGrafico(
  wrap: HTMLElement,
  tooltipEl: HTMLElement,
  contenido: (idx: number) => string | null,
): TooltipGrafico {
  function ocultar(): void {
    tooltipEl.hidden = true;
  }

  /**
   * `cursor.left`/`top` están en píxeles CSS relativos al ÁREA DE TRAZADO
   * (sin el eje Y ni sus números). El tooltip se posiciona relativo al wrap
   * del gráfico entero, así que hay que sumar la diferencia entre ambos
   * orígenes.
   */
  function offsetAreaTrazado(u: uPlot): { x: number; y: number } {
    const over = u.over.getBoundingClientRect();
    const caja = wrap.getBoundingClientRect();
    return { x: over.left - caja.left, y: over.top - caja.top };
  }

  function mostrar(u: uPlot): void {
    const idx = u.cursor.idx;
    if (idx === null || idx === undefined) {
      ocultar();
      return;
    }
    const html = contenido(idx);
    if (!html) {
      ocultar();
      return;
    }
    tooltipEl.innerHTML = html;
    tooltipEl.hidden = false;

    const offset = offsetAreaTrazado(u);
    const left = offset.x + (u.cursor.left ?? 0);
    const top = offset.y + (u.cursor.top ?? 0);
    // Pegado al borde, el tooltip se saldría del lienzo: se lo trae adentro.
    const maxLeft = wrap.clientWidth - tooltipEl.offsetWidth - MARGEN_PX;
    tooltipEl.style.left = `${String(Math.max(MARGEN_PX, Math.min(left + SEPARACION_PX, maxLeft)))}px`;
    tooltipEl.style.top = `${String(Math.max(MARGEN_PX, top - SEPARACION_PX))}px`;
  }

  const plugin: uPlot.Plugin = {
    hooks: {
      init: (u) => {
        u.over.addEventListener("mouseleave", ocultar);
        // Al soltar el dedo el cursor de uPlot no se mueve más, así que el
        // tooltip quedaría pegado sobre el gráfico.
        u.over.addEventListener("touchend", ocultar);
        u.over.addEventListener("touchcancel", ocultar);
      },
      setCursor: (u) => {
        mostrar(u);
      },
    },
  };

  return { plugin, ocultar };
}
