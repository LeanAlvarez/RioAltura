import { UMBRALES } from "./umbrales";
import { formatMetros } from "../format";

/**
 * Regla hidrométrica vertical (spec 008, L5): escala con los tres umbrales
 * posicionados a escala y la altura de hoy marcada. Cálculo puro y testeable
 * (ver `reglaHidrometrica.test.ts`); el render solo arma HTML a partir de acá.
 *
 * Nunca solo color (CLAUDE.md §7): cada marca lleva su texto (nombre + altura),
 * y la marca de hoy además lleva la palabra "Hoy".
 */

/** Margen por encima/debajo de los extremos, para que ninguna marca quede pegada al borde. */
const MARGEN_ESCALA_M = 0.5;

/**
 * Separación mínima (en % de alto de la regla) entre dos etiquetas
 * consecutivas.
 *
 * La regla muestra SÓLO el número de cada umbral, no su nombre: los tres
 * umbrales de Colón están a 0,30 m y 0,80 m entre sí sobre una escala de
 * unos 4 m, así que tres nombres de dos renglones no entran al lado de sus
 * marcas por más que se los separe — la versión anterior los corría tanto
 * que "Alerta" terminaba al lado de la marca de 6,80 y "Evacuación
 * preventiva" flotaba en el vacío, que es justo lo que el defecto G1 de la
 * revisión de diseño reportaba. Los nombres y su explicación viven en la
 * tarjeta "¿Qué significa cada nivel?", que está al lado.
 *
 * Con una sola línea corta ("7,90 m") alcanza una separación chica, y las
 * etiquetas quedan pegadas a su marca en vez de desplazadas.
 */
const SEPARACION_MIN_ETIQUETA_PCT = 7;

/**
 * Margen (en % de alto de la regla) que ninguna etiqueta de texto puede
 * cruzar, ni por arriba ni por abajo (defecto G1 de la revisión de diseño,
 * medido en navegador a 1920 px: la etiqueta de "Evacuación" podía terminar
 * flotando por encima de donde empieza la barra, porque la versión anterior
 * solo evitaba que las etiquetas se pisaran entre sí, sin reservar lugar
 * para que la más alta (o la más baja) entrara entera dentro del eje). Una
 * etiqueta de hasta 3 líneas a 0,8125rem/1.15 de interlineado mide como
 * mucho ~45 px; sobre el `min-height: 12rem` (192 px) de `.regla-marcas` eso
 * son ~23,4 % de alto total, así que el margen tiene que ser al menos la
 * mitad de eso (la etiqueta se centra sobre su posición) para que quepa
 * completa. 15 % deja margen de sobra incluso en ese peor caso.
 */
const MARGEN_BORDE_ETIQUETA_PCT = 15;

export interface EscalaRegla {
  minM: number;
  maxM: number;
}

/** Pure: umbrales + altura de hoy (si hay) -> rango [min, max] de la regla. No DOM. */
export function calcularEscalaRegla(
  umbrales: readonly { alturaM: number }[],
  alturaHoyM: number | null,
): EscalaRegla {
  const alturas = umbrales.map((u) => u.alturaM);
  if (alturaHoyM !== null) alturas.push(alturaHoyM);
  const base = alturas.length > 0 ? alturas : [0];
  const minM = Math.max(0, Math.min(...base) - MARGEN_ESCALA_M);
  const maxM = Math.max(...base) + MARGEN_ESCALA_M;
  return { minM, maxM };
}

/** Pure: valor en metros -> posición porcentual (0 abajo, 100 arriba) dentro de la escala. No DOM. */
export function posicionEnEscala(valorM: number, escala: EscalaRegla): number {
  const rango = escala.maxM - escala.minM;
  if (rango <= 0) return 0;
  const pct = ((valorM - escala.minM) / rango) * 100;
  return Math.min(100, Math.max(0, pct));
}

interface PosicionBase {
  id: string;
  posicionPct: number;
}

/**
 * Pure: separa las etiquetas de texto que quedarían pisadas entre sí, sin
 * dejar que ninguna se salga de la barra (defecto G1: antes solo se hacía la
 * primera pasada de abajo hacia arriba, sin reservar margen contra el borde
 * superior, así que la etiqueta más alta podía terminar flotando fuera de
 * la regla). Algoritmo estándar de dos pasadas para "declutter" de
 * etiquetas en un eje:
 *
 * 1. De abajo hacia arriba: cada etiqueta se separa al menos
 *    `SEPARACION_MIN_ETIQUETA_PCT` de la anterior, nunca por debajo de
 *    `MARGEN_BORDE_ETIQUETA_PCT`.
 * 2. De arriba hacia abajo: recorta lo anterior para que ninguna quede por
 *    encima de `100 - MARGEN_BORDE_ETIQUETA_PCT`, empujando hacia abajo en
 *    cascada si hace falta (siempre respetando la separación mínima).
 *
 * La marca (el tick) siempre queda en su posición exacta a escala; esto solo
 * mueve el texto. Cuando el texto se separa del tick, `buildReglaHidrometricaHtml`
 * dibuja una línea guía entre los dos para que la asociación no quede
 * ambigua (ninguna etiqueta puede quedar "flotando" sin que se sepa de qué
 * marca es).
 */
function separarEtiquetas(marcas: readonly PosicionBase[]): Map<string, number> {
  const ordenadas = [...marcas].sort((a, b) => a.posicionPct - b.posicionPct);
  const n = ordenadas.length;
  if (n === 0) return new Map();

  const primera = ordenadas[0];
  const adelante: number[] = [Math.max(primera?.posicionPct ?? 0, MARGEN_BORDE_ETIQUETA_PCT)];
  for (let i = 1; i < n; i++) {
    const actual = ordenadas[i];
    const anterior = adelante[i - 1] ?? MARGEN_BORDE_ETIQUETA_PCT;
    adelante.push(Math.max(actual?.posicionPct ?? 0, anterior + SEPARACION_MIN_ETIQUETA_PCT));
  }

  const atras: number[] = [...adelante];
  atras[n - 1] = Math.min(adelante[n - 1] ?? 0, 100 - MARGEN_BORDE_ETIQUETA_PCT);
  for (let i = n - 2; i >= 0; i--) {
    atras[i] = Math.min(adelante[i] ?? 0, (atras[i + 1] ?? 100) - SEPARACION_MIN_ETIQUETA_PCT);
  }

  return new Map(ordenadas.map((m, i) => [m.id, atras[i] ?? m.posicionPct]));
}

export interface MarcaRegla {
  id: string;
  etiqueta: string;
  alturaM: number;
  /** Posición exacta a escala (para el tick). */
  posicionPct: number;
  /** Posición del texto, separada para no superponerse con las vecinas. */
  etiquetaPosicionPct: number;
}

export interface ReglaHidrometricaView {
  escala: EscalaRegla;
  marcas: MarcaRegla[];
  hoy: { alturaM: number; texto: string; posicionPct: number; etiquetaPosicionPct: number } | null;
}

/**
 * Pure derivation: altura de hoy (o null mientras carga) -> vista completa de
 * la regla, con los tres umbrales de `domain/umbrales.ts` (valores y nombres
 * que no se tocan, CLAUDE.md §5) y la marca de hoy. No DOM.
 */
export function deriveReglaHidrometricaView(alturaHoyM: number | null): ReglaHidrometricaView {
  const escala = calcularEscalaRegla(UMBRALES, alturaHoyM);

  const base: PosicionBase[] = UMBRALES.map((u) => ({ id: u.id, posicionPct: posicionEnEscala(u.alturaM, escala) }));
  if (alturaHoyM !== null) base.push({ id: "hoy", posicionPct: posicionEnEscala(alturaHoyM, escala) });
  const etiquetasSeparadas = separarEtiquetas(base);

  const marcas = UMBRALES.map((u) => {
    const posicionPct = posicionEnEscala(u.alturaM, escala);
    return {
      id: u.id,
      etiqueta: u.nombre,
      alturaM: u.alturaM,
      posicionPct,
      etiquetaPosicionPct: etiquetasSeparadas.get(u.id) ?? posicionPct,
    };
  });

  const hoy =
    alturaHoyM === null
      ? null
      : {
          alturaM: alturaHoyM,
          texto: formatMetros(alturaHoyM),
          posicionPct: posicionEnEscala(alturaHoyM, escala),
          etiquetaPosicionPct: etiquetasSeparadas.get("hoy") ?? posicionEnEscala(alturaHoyM, escala),
        };

  return { escala, marcas, hoy };
}

/**
 * Pure: arma el HTML de la regla (string, sin tocar el DOM) para incrustarlo
 * dentro de la tarjeta "Hoy" (`components/estadoHoy.ts`).
 */
/**
 * Tick y texto se dibujan como dos elementos independientes (no anidados),
 * ambos posicionados en % del mismo eje (`.regla-marcas`): el tick siempre a
 * escala exacta, el texto en la posición ya separada para no superponerse
 * (ver `separarEtiquetas`). Anidarlos habría requerido mezclar dos `%`
 * relativos a alturas distintas (la del eje completo vs. la de la marca).
 */
function marcaHtml(
  claseExtra: string,
  posicionPct: number,
  etiquetaPosicionPct: number,
  texto: string,
  nombreAccesible?: string,
): string {
  // El nombre del umbral no se dibuja (no entra junto a marcas tan juntas),
  // pero sí tiene que llegar a un lector de pantalla: sin él la regla sería
  // una lista de números sin significado.
  const titulo = nombreAccesible === undefined ? "" : ` title="${nombreAccesible}"`;
  const etiquetaAria =
    nombreAccesible === undefined ? "" : ` aria-label="${texto} — ${nombreAccesible}"`;
  return `
    <span class="regla-marca-tick${claseExtra}" style="bottom:${String(posicionPct)}%" aria-hidden="true"></span>
    <span class="regla-marca-texto${claseExtra}" style="bottom:${String(etiquetaPosicionPct)}%"${titulo}${etiquetaAria}>${texto}</span>`;
}

/**
 * Umbral (en puntos porcentuales) a partir del cual se considera que el
 * texto se movió de su marca y hace falta una línea guía (defecto G1): por
 * debajo de esto la diferencia no se nota a simple vista y dibujar una línea
 * sería ruido.
 */
const GUIA_UMBRAL_PCT = 0.5;

/**
 * Pure: línea guía SVG entre el tick (a `posicionPct`, escala exacta) y su
 * etiqueta (a `etiquetaPosicionPct`, ya separada), o cadena vacía si no hubo
 * desplazamiento. Arreglo de G1: antes una etiqueta desplazada quedaba sin
 * ninguna marca visual de a qué tick pertenecía (ver diagnóstico en el
 * comentario de `separarEtiquetas`). Coordenadas en el mismo `viewBox 0 0
 * 100 100` que `regla-guias` en style.css: x1/x2 son aproximaciones del
 * centro del tick (izquierda del eje) y el inicio del texto, en % del ancho
 * de `.regla-hidrometrica` (9rem): tick en 0,3rem/9rem y texto en
 * 0,8rem/9rem.
 */
function lineaGuiaSvg(claseExtra: string, posicionPct: number, etiquetaPosicionPct: number): string {
  if (Math.abs(posicionPct - etiquetaPosicionPct) < GUIA_UMBRAL_PCT) return "";
  const y1 = 100 - posicionPct;
  const y2 = 100 - etiquetaPosicionPct;
  return `<line class="regla-marca-guia${claseExtra}" x1="3.3" y1="${String(y1)}" x2="8.9" y2="${String(y2)}" />`;
}

export function buildReglaHidrometricaHtml(view: ReglaHidrometricaView): string {
  const marcasHtml = view.marcas
    .map((m) =>
      marcaHtml("", m.posicionPct, m.etiquetaPosicionPct, formatMetros(m.alturaM), m.etiqueta),
    )
    .join("");

  const hoyHtml = view.hoy
    ? marcaHtml(" regla-marca--hoy", view.hoy.posicionPct, view.hoy.etiquetaPosicionPct, `Hoy: ${view.hoy.texto}`)
    : "";

  const guiasHtml =
    view.marcas.map((m) => lineaGuiaSvg("", m.posicionPct, m.etiquetaPosicionPct)).join("") +
    (view.hoy ? lineaGuiaSvg(" regla-marca--hoy", view.hoy.posicionPct, view.hoy.etiquetaPosicionPct) : "");

  return `
    <div class="regla-hidrometrica" role="img" aria-label="Regla hidrométrica del puerto de Colón, con los tres niveles de aviso y la altura de hoy">
      <div class="regla-hidrometrica-eje">
        <div class="regla-marcas">
          <svg class="regla-guias" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${guiasHtml}</svg>
          ${marcasHtml}${hoyHtml}
        </div>
      </div>
    </div>
  `;
}
