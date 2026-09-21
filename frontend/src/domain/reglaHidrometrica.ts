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
 * Separación mínima (en % de alto de la regla) entre dos etiquetas de texto
 * consecutivas, para que no se superpongan. Los tres umbrales de Colón están
 * a menos de 1,1 m entre sí (6,80/7,10/7,90), así que casi siempre caen más
 * cerca que esto a la escala de la regla (mismo problema que resuelve
 * `posicionarEtiquetasUmbrales` en `components/grafico.ts`, acá en % en vez
 * de píxeles porque el alto real de la regla lo decide el CSS). El texto de
 * cada marca ocupa 2-3 líneas (ver `.regla-marca-texto` en style.css, con
 * `.regla-marcas` a `min-height: 12rem`), así que el mínimo es bastante más
 * grande que un simple salto de línea.
 */
const SEPARACION_MIN_ETIQUETA_PCT = 22;

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
 * Pure: empuja hacia arriba las etiquetas que quedarían a menos de
 * `SEPARACION_MIN_ETIQUETA_PCT` de la anterior, de abajo hacia arriba. La
 * marca (el tick) siempre queda en su posición exacta a escala; esto solo
 * mueve el texto para que se pueda leer.
 */
function separarEtiquetas(marcas: readonly PosicionBase[]): Map<string, number> {
  const ordenadas = [...marcas].sort((a, b) => a.posicionPct - b.posicionPct);
  const ajustadas: { id: string; pos: number }[] = [];
  for (const m of ordenadas) {
    const anterior = ajustadas[ajustadas.length - 1];
    const pos = anterior && m.posicionPct - anterior.pos < SEPARACION_MIN_ETIQUETA_PCT
      ? anterior.pos + SEPARACION_MIN_ETIQUETA_PCT
      : m.posicionPct;
    ajustadas.push({ id: m.id, pos: Math.min(100, pos) });
  }
  return new Map(ajustadas.map((a) => [a.id, a.pos]));
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
function marcaHtml(claseExtra: string, posicionPct: number, etiquetaPosicionPct: number, texto: string): string {
  return `
    <span class="regla-marca-tick${claseExtra}" style="bottom:${String(posicionPct)}%" aria-hidden="true"></span>
    <span class="regla-marca-texto${claseExtra}" style="bottom:${String(etiquetaPosicionPct)}%">${texto}</span>`;
}

export function buildReglaHidrometricaHtml(view: ReglaHidrometricaView): string {
  const marcasHtml = view.marcas
    .map((m) => marcaHtml("", m.posicionPct, m.etiquetaPosicionPct, `${formatMetros(m.alturaM)} — ${m.etiqueta}`))
    .join("");

  const hoyHtml = view.hoy
    ? marcaHtml(" regla-marca--hoy", view.hoy.posicionPct, view.hoy.etiquetaPosicionPct, `Hoy: ${view.hoy.texto}`)
    : "";

  return `
    <div class="regla-hidrometrica" role="img" aria-label="Regla hidrométrica del puerto de Colón, con los tres niveles de aviso y la altura de hoy">
      <div class="regla-hidrometrica-eje">
        <div class="regla-marcas">${marcasHtml}${hoyHtml}</div>
      </div>
    </div>
  `;
}
