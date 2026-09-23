/**
 * "Mi casa" (spec 015): a qué altura del puerto se moja un punto del mapa.
 *
 * C2 es la parte que importa: la coordenada nunca sale del dispositivo. No
 * hay endpoint ni ráster -- el navegador busca la respuesta con una búsqueda
 * binaria sobre las 43 capas GeoJSON que `map.ts` ya carga y cachea
 * (`CapaCache` de `capas.ts`), usando `pointInPolygon` (ray-casting,
 * even-odd) contra cada capa.
 *
 * `index.capas` viene ordenado ascendente por `h` (contrato de `capas.ts`) y
 * las capas están anidadas: toda el área que se moja a una altura h1 sigue
 * mojada a cualquier h2 > h1 (el modelo es un flood-fill por umbral de
 * elevación: cualquier celda alcanzable a h1 sigue estando por debajo del
 * umbral, y con el mismo camino de celdas vecinas, a h2). Esa monotonía es lo
 * que hace válida la búsqueda binaria: "¿el punto está mojado a esta altura?"
 * pasa de falso a verdadero una sola vez a lo largo del array, nunca vuelve a
 * false más arriba.
 */

import { formatAltura, type CapaCache, type CapaEntry, type CapaIndex } from "../capas";
import { pointInPolygon, type Position } from "./pointInPolygon";

/** Un punto del mapa, en el formato que ya entrega Leaflet (`e.latlng`). */
export interface PuntoMapa {
  lat: number;
  lng: number;
}

export type ResultadoMiCasa =
  | { kind: "fuera-de-area" }
  /** Ya bajo agua con el río en `alturaM` (la capa más baja modelada, `index.nivel_min`). */
  | { kind: "ya-inundado"; alturaM: number }
  /** No se moja ni con el río en `alturaMaximaModeladaM` (la capa más alta modelada). */
  | { kind: "seco"; alturaMaximaModeladaM: number }
  /** Se moja al llegar a `alturaM` (ya redondeada al escalón de la capa que lo encontró). */
  | { kind: "encontrado"; alturaM: number };

export class MiCasaError extends Error {}

function fueraDeArea(bbox: CapaIndex["bbox"], punto: PuntoMapa): boolean {
  const [oeste, sur, este, norte] = bbox;
  return punto.lng < oeste || punto.lng > este || punto.lat < sur || punto.lat > norte;
}

async function mojadoEnCapa(entry: CapaEntry, punto: PuntoMapa, cache: CapaCache): Promise<boolean> {
  const coleccion = await cache.get(entry);
  const posicion: Position = [punto.lng, punto.lat];
  return coleccion.features.some((feature) => pointInPolygon(posicion, feature.geometry));
}

/**
 * Búsqueda binaria sobre `index.capas` (ascendente por h, C2): encuentra el
 * índice más bajo cuya capa ya moja `punto`. Sobre 43 capas son
 * ceil(log2(43)) = 6 consultas -- ninguna de las cuales pasa la coordenada a
 * ningún lado, sólo pide un archivo GeoJSON estático que el mapa ya sirve.
 *
 * El resultado de la búsqueda distingue los 3 casos de borde de la spec sin
 * consultas extra: si nunca da verdadero, es "seco"; si ya da verdadero en la
 * capa más baja, es "ya-inundado"; el punto fuera del bbox modelado se
 * descarta antes, sin ninguna consulta de red.
 */
export async function buscarAlturaInundacion(
  index: CapaIndex,
  cache: CapaCache,
  punto: PuntoMapa,
): Promise<ResultadoMiCasa> {
  if (fueraDeArea(index.bbox, punto)) {
    return { kind: "fuera-de-area" };
  }

  const capas = index.capas;
  if (capas.length === 0) {
    throw new MiCasaError("index sin capas");
  }

  let lo = 0;
  let hi = capas.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const entry = capas[mid];
    if (!entry) break;
    const mojado = await mojadoEnCapa(entry, punto, cache);
    if (mojado) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  if (lo >= capas.length) {
    const maxima = capas[capas.length - 1];
    if (!maxima) throw new MiCasaError("index sin capas");
    return { kind: "seco", alturaMaximaModeladaM: maxima.h };
  }

  const encontrada = capas[lo];
  if (!encontrada) throw new MiCasaError("index sin capas");
  if (lo === 0) {
    return { kind: "ya-inundado", alturaM: encontrada.h };
  }
  return { kind: "encontrado", alturaM: encontrada.h };
}

// --- View (pure, textos ya formateados en español rioplatense) -----------

export type MiCasaState =
  | { kind: "sin-punto" }
  | { kind: "calculando" }
  | { kind: "error" }
  | ResultadoMiCasa;

export type MiCasaView =
  | { kind: "sin-punto"; mensaje: string }
  | { kind: "calculando"; mensaje: string }
  | { kind: "error"; mensaje: string }
  | { kind: "fuera-de-area"; mensaje: string }
  | { kind: "ya-inundado"; alturaM: number; altura: string; mensaje: string }
  | { kind: "seco"; alturaMaximaModeladaM: number; alturaMaximaModelada: string; mensaje: string }
  | { kind: "encontrado"; alturaM: number; altura: string; mensaje: string };

/**
 * Texto exacto de la spec 015, sección C5 -- no se parafrasea. Se muestra
 * siempre junto a la respuesta (cualquier `view.kind` salvo "sin-punto" y
 * "calculando", que todavía no tienen respuesta que mostrar), y nunca se
 * puede cerrar (`components/miCasa.ts` no le pone ningún botón).
 */
export const DISCLAIMER_MI_CASA =
  "Es un cálculo aproximado, no una medición de tu casa. Usa una imagen satelital de 30 metros " +
  "que incluye techos y árboles, y no conoce el umbral de tu puerta, el nivel del piso, las " +
  "defensas ni los desagües. Puede errar por metros. Ante una crecida, seguí a Prefectura y a " +
  "Defensa Civil.";

/** Pure: estado de "mi casa" -> qué mostrar. No DOM (ver `components/miCasa.ts`). */
export function deriveMiCasaView(state: MiCasaState): MiCasaView {
  switch (state.kind) {
    case "sin-punto":
      return { kind: "sin-punto", mensaje: "Tocá el mapa en tu casa (o donde quieras) para saber a qué altura del río se moja." };
    case "calculando":
      return { kind: "calculando", mensaje: "Buscando…" };
    case "error":
      return { kind: "error", mensaje: "No pudimos calcular la altura para ese punto. Probá tocar el mapa de nuevo." };
    case "fuera-de-area":
      return {
        kind: "fuera-de-area",
        mensaje: "Ese punto queda fuera del área que mapeamos. No podemos calcular a qué altura se moja.",
      };
    case "ya-inundado": {
      const altura = formatAltura(state.alturaM);
      return {
        kind: "ya-inundado",
        alturaM: state.alturaM,
        altura,
        mensaje: `Ese punto ya queda bajo agua con el río en su nivel habitual (desde los ${altura}). Es zona que se inunda seguido.`,
      };
    }
    case "seco": {
      const alturaMaximaModelada = formatAltura(state.alturaMaximaModeladaM);
      return {
        kind: "seco",
        alturaMaximaModeladaM: state.alturaMaximaModeladaM,
        alturaMaximaModelada,
        mensaje: `Con los datos que tenemos, ese punto no se moja ni con el río en ${alturaMaximaModelada} — la altura más alta que probamos. Es una buena noticia, pero no una garantía: el modelo no conoce la lluvia local ni los desagües de la ciudad.`,
      };
    }
    case "encontrado": {
      const altura = formatAltura(state.alturaM);
      return {
        kind: "encontrado",
        alturaM: state.alturaM,
        altura,
        mensaje: `Ese punto se moja cuando el río llega a los ${altura}.`,
      };
    }
  }
}
