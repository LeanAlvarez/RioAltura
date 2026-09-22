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
 * Pure: posición X (en el mismo espacio de `escalarCurva`, `[0, width]`) que
 * le corresponde a una altura `h` dentro del rango `[hMin, hMax]` de la
 * curva. Se usa para ubicar la marca de "máximo observado" (G5) en el mismo
 * eje que los puntos de la curva, sin ser necesariamente uno de ellos. No
 * DOM.
 */
export function xParaAltura(h: number, hMin: number, hMax: number, width: number): number {
  const rango = hMax - hMin || 1;
  return ((h - hMin) / rango) * width;
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

/**
 * Alto del área de dibujo, en unidades del viewBox. El ANCHO se calcula del
 * contenedor en cada render: el SVG usa `preserveAspectRatio="none"`, así que
 * si el viewBox no acompaña al ancho real la escala se vuelve no uniforme y
 * el texto sale desparramado. Con la tarjeta a ancho completo eso llegaba a
 * estirar 4,5 veces a lo ancho mientras comprimía a lo alto.
 */
/** Ancho mínimo del área de dibujo, para que la curva se lea en un celular. */
const ANCHO_SVG_MIN = 260;
const ALTO_SVG_MIN = 120;
const ALTO_SVG_MAX = 220;
/** Proporción ancho/alto a la que tiende el dibujo en pantallas anchas. */
const RELACION_DIBUJO = 6;

/** Ancho del área de dibujo para un contenedor de `anchoContenedor` px. */
export function anchoDibujo(anchoContenedor: number, margenIzquierdo: number): number {
  return Math.max(ANCHO_SVG_MIN, Math.round(anchoContenedor - margenIzquierdo - 8));
}

/**
 * Alto del área de dibujo para un ancho dado.
 *
 * Crece con el ancho hasta un tope, para que la tarjeta a ancho completo no
 * quede con una franja de 120 px perdida en 1.800 px de ancho, pero tampoco
 * se convierta en un cartel. El SVG se dibuja después con exactamente estas
 * medidas en píxeles, así que la escala queda 1:1 y el texto no se deforma.
 */
export function altoDibujo(anchoDibujoPx: number): number {
  return Math.round(Math.min(ALTO_SVG_MAX, Math.max(ALTO_SVG_MIN, anchoDibujoPx / RELACION_DIBUJO)));
}
// Márgenes para los rótulos de eje (ítem 9, correcciones de diseño; L4 spec
// 008: >= 13 px de fuente, así que el margen crece un poco para que no se
// corten). La curva original no tenía ningún eje, así que ninguna de las dos
// escalas (metros / hectáreas) era legible sin adivinar.
/** Tamaño de fuente de las etiquetas del eje, igual que en `style.css`. */
const EJE_FONT_PX = 13;
/**
 * Ancho aproximado de un carácter de las etiquetas del eje, en múltiplos del
 * tamaño de fuente. Los dígitos y el separador de miles de la fuente del
 * sistema entran holgados en 0,62 em.
 */
const EJE_ANCHO_CARACTER_EM = 0.62;
/** Aire entre la etiqueta más larga y la curva. */
const EJE_HOLGURA_PX = 8;

/**
 * Margen izquierdo necesario para que la etiqueta más larga del eje Y entre
 * entera.
 *
 * Se calcula, no se fija: el máximo del eje crece con el rango de la
 * simulación (14.613 ha a 13 m, 26.094 ha a 20 m), y un margen hardcodeado le
 * recorta el primer dígito cada vez que los datos lo superan — "26.094 ha" se
 * leía "6.094 ha", errando por 20.000 hectáreas.
 */
export function margenEjeY(etiquetas: readonly string[]): number {
  const caracteres = etiquetas.reduce((max, etiqueta) => Math.max(max, etiqueta.length), 0);
  return Math.ceil(caracteres * EJE_FONT_PX * EJE_ANCHO_CARACTER_EM) + EJE_HOLGURA_PX;
}
const MARGEN_INFERIOR = 22;

/**
 * "Superficie afectada" (spec 007 T7): curva de hectáreas inundadas por
 * altura, sincronizada en los dos sentidos con el slider del mapa (se
 * conecta al módulo `map.ts` compartido, cargado en `mountMapa`, spec 006).
 */
export function mountSuperficieAfectada(container: HTMLElement, deps: SuperficieAfectadaDeps = defaultDeps): void {
  container.innerHTML = `
    <h2>Cuánta tierra se tapa de agua</h2>
    <p class="superficie-estado" role="status" aria-live="polite">Cargando…</p>
  `;
  const estadoEl = container.querySelector<HTMLParagraphElement>(".superficie-estado");

  void deps.fetchCapaIndex().then(
    (index) => {
      if (!estadoEl) return;
      const puntos = buildCurvaPuntos(index);
      const hectareasTodas = puntos.map((p) => p.hectareas);
      const haMin = Math.min(...hectareasTodas);
      const haMax = Math.max(...hectareasTodas);
      // El margen depende de las etiquetas, y el ancho de dibujo del margen:
      // este orden importa.
      const MARGEN_IZQUIERDO = margenEjeY([formatHectareas(haMax), formatHectareas(haMin)]);
      const ANCHO_SVG = anchoDibujo(container.clientWidth || 360, MARGEN_IZQUIERDO);
      const ALTO_SVG = altoDibujo(ANCHO_SVG);
      const escalados = escalarCurva(puntos, ANCHO_SVG, ALTO_SVG);
      const polylinePoints = escalados.map((p) => `${String(p.x)},${String(p.y)}`).join(" ");
      const anchoTotal = ANCHO_SVG + MARGEN_IZQUIERDO;
      const altoTotal = ALTO_SVG + MARGEN_INFERIOR;

      // G5 (revisión de diseño): sin esto, la curva mostraba 26.094 ha a 20 m
      // como si fuera un valor tan creíble como cualquier otro, sin ninguna
      // marca de que el río nunca pasó de 10 m (CLAUDE.md §5, "escenario
      // hipotético"). El valor sale de `index.json` (nunca hardcodeado); si
      // el índice todavía no lo trae (contrato opcional, ver `capas.ts`) o
      // cae fuera del rango simulado, no se dibuja nada.
      const hs = puntos.map((p) => p.h);
      const hMin = Math.min(...hs);
      const hMax = Math.max(...hs);
      const maximoObservadoM = index.crecida_maxima_observada_m;
      const marcaMaximoHtml =
        maximoObservadoM !== undefined &&
        Number.isFinite(maximoObservadoM) &&
        maximoObservadoM >= hMin &&
        maximoObservadoM <= hMax
          ? (() => {
              const x = MARGEN_IZQUIERDO + xParaAltura(maximoObservadoM, hMin, hMax, ANCHO_SVG);
              return `
                <line class="superficie-curva-maximo-linea" x1="${String(x)}" y1="0" x2="${String(x)}" y2="${String(ALTO_SVG)}" />
                <text class="superficie-curva-maximo-etiqueta" x="${String(x)}" y="10" text-anchor="middle">máximo observado</text>
              `;
            })()
          : "";

      container.innerHTML = `
        <h2>Cuánta tierra se tapa de agua</h2>
        <p class="card-subtitulo">Cuánto campo y ciudad quedaría bajo el agua según cuánto suba el río.</p>
        <svg class="superficie-svg" style="height:${String(altoTotal)}px" preserveAspectRatio="none" viewBox="0 0 ${String(anchoTotal)} ${String(altoTotal)}" role="img" aria-label="Curva de hectáreas inundadas según la altura del río">
          <text class="superficie-eje-etiqueta" x="${String(MARGEN_IZQUIERDO - 4)}" y="9" text-anchor="end">${formatHectareas(haMax)}</text>
          <text class="superficie-eje-etiqueta" x="${String(MARGEN_IZQUIERDO - 4)}" y="${String(ALTO_SVG)}" text-anchor="end">${formatHectareas(haMin)}</text>
          ${marcaMaximoHtml}
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
