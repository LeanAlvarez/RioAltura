/**
 * Fuente única de verdad de la paleta de los gráficos (uPlot), para claro y
 * oscuro. De acá salen:
 *  - Las custom properties CSS que consumen `grafico.ts`/`historial.ts`/
 *    `precision.ts`/`aguasArriba.ts` vía `getComputedStyle` en cada render
 *    (`montarEstilosPaleta`, llamada una sola vez desde `main.ts`).
 *  - El test de contraste WCAG (`paleta.test.ts`), que lee estos mismos
 *    valores: no hay forma de cambiar un color acá sin que ese test lo vea.
 *
 * Los anchos/patrones de trazo (`TRAZOS`) son los mismos en los dos temas —
 * solo el color cambia — así que viven en un objeto aparte, no dentro de
 * `PaletaTema`.
 */

import type { Tema } from "../theme";

// --- Contraste WCAG (pure, sin DOM) -----------------------------------

function linealizarCanal(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Pure: luminancia relativa WCAG de un color sólido `#rrggbb`. */
export function luminanciaRelativa(hex: string): number {
  const limpio = hex.replace("#", "");
  const r = Number.parseInt(limpio.slice(0, 2), 16);
  const g = Number.parseInt(limpio.slice(2, 4), 16);
  const b = Number.parseInt(limpio.slice(4, 6), 16);
  return 0.2126 * linealizarCanal(r) + 0.7152 * linealizarCanal(g) + 0.0722 * linealizarCanal(b);
}

/** Pure: ratio de contraste WCAG 2.x entre dos colores sólidos `#rrggbb` (sin transparencia). */
export function ratioContraste(hexA: string, hexB: string): number {
  const la = luminanciaRelativa(hexA);
  const lb = luminanciaRelativa(hexB);
  const [claro, oscuro] = la >= lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (oscuro + 0.05);
}

/** Texto de ejes y etiquetas: WCAG AA para texto normal. */
export const CONTRASTE_MIN_TEXTO = 4.5;
/** Líneas de datos (objetos gráficos, no texto): WCAG AA para "non-text contrast". */
export const CONTRASTE_MIN_LINEA = 3;

// --- Paleta por tema -----------------------------------------------------

export type RolLinea =
  | "alturaReal"
  | "pronostico"
  | "historico"
  | "evacuacionPreventiva"
  | "alerta"
  | "evacuacion";

/** Roles de texto: mínimo de contraste 4,5:1 (`CONTRASTE_MIN_TEXTO`). */
export const ROLES_TEXTO: readonly (keyof PaletaTema)[] = ["ejeTexto"];
/** Roles de línea de datos: mínimo de contraste 3:1 (`CONTRASTE_MIN_LINEA`). */
export const ROLES_LINEA: readonly RolLinea[] = [
  "alturaReal",
  "pronostico",
  "historico",
  "evacuacionPreventiva",
  "alerta",
  "evacuacion",
];

export interface PaletaTema {
  /** Fondo de tarjeta (`--card-bg`, style.css): referencia para los ratios de contraste. */
  readonly fondoTarjeta: string;
  readonly ejeTexto: string;
  readonly grilla: string;
  readonly alturaReal: string;
  readonly pronostico: string;
  /** Banda mín-máx del pronóstico: color de `pronostico` con opacidad ya aplicada (`color-mix`). */
  readonly pronosticoBanda: string;
  readonly historico: string;
  readonly evacuacionPreventiva: string;
  readonly alerta: string;
  readonly evacuacion: string;
  /** Franjas de días en alerta (historial): color propio, con opacidad ya aplicada. */
  readonly franjaAlerta: string;
}

function conOpacidad(hex: string, porcentajeOpacidad: number): string {
  return `color-mix(in srgb, ${hex} ${porcentajeOpacidad}%, transparent)`;
}

/** `--card-bg` de style.css: no es parte de la paleta nueva, pero el test de contraste la necesita como fondo. */
const FONDO_TARJETA: Record<Tema, string> = { light: "#ffffff", dark: "#1a2029" };

const BASE = {
  light: {
    ejeTexto: "#3D3D3D",
    grilla: "#E2E2E2",
    alturaReal: "#0C447C",
    pronostico: "#0F6E56",
    historico: "#534AB7",
    evacuacionPreventiva: "#BA7517",
    alerta: "#D85A30",
    evacuacion: "#A32D2D",
    franjaBase: "#EF9F27",
  },
  dark: {
    ejeTexto: "#D0D0D0",
    grilla: "#2E3A4F",
    alturaReal: "#85B7EB",
    pronostico: "#5DCAA5",
    historico: "#AFA9EC",
    evacuacionPreventiva: "#EF9F27",
    alerta: "#F0997B",
    evacuacion: "#F09595",
    franjaBase: "#EF9F27",
  },
} as const;

export const PALETA: Record<Tema, PaletaTema> = {
  light: {
    fondoTarjeta: FONDO_TARJETA.light,
    ejeTexto: BASE.light.ejeTexto,
    grilla: BASE.light.grilla,
    alturaReal: BASE.light.alturaReal,
    pronostico: BASE.light.pronostico,
    pronosticoBanda: conOpacidad(BASE.light.pronostico, 20),
    historico: BASE.light.historico,
    evacuacionPreventiva: BASE.light.evacuacionPreventiva,
    alerta: BASE.light.alerta,
    evacuacion: BASE.light.evacuacion,
    franjaAlerta: conOpacidad(BASE.light.franjaBase, 25),
  },
  dark: {
    fondoTarjeta: FONDO_TARJETA.dark,
    ejeTexto: BASE.dark.ejeTexto,
    grilla: BASE.dark.grilla,
    alturaReal: BASE.dark.alturaReal,
    pronostico: BASE.dark.pronostico,
    pronosticoBanda: conOpacidad(BASE.dark.pronostico, 25),
    historico: BASE.dark.historico,
    evacuacionPreventiva: BASE.dark.evacuacionPreventiva,
    alerta: BASE.dark.alerta,
    evacuacion: BASE.dark.evacuacion,
    franjaAlerta: conOpacidad(BASE.dark.franjaBase, 30),
  },
};

// --- Trazo (ancho + patrón de guiones): igual en los dos temas -----------

export interface TrazoLinea {
  readonly widthPx: number;
  /** Patrón `dash` de uPlot (y de la leyenda, ver `fondoTrazoCss`). `undefined` = línea sólida. */
  readonly dash?: readonly number[];
}

/**
 * Los tres umbrales llevan patrones de guiones distintos entre sí (y de
 * "Lo más probable"/"histórico"), para no depender solo del color
 * (CLAUDE.md §7): preventiva = guión medio, alerta = guión-punto, evacuación
 * = guión corto y apretado.
 */
export const TRAZOS: Record<RolLinea, TrazoLinea> = {
  alturaReal: { widthPx: 2.5 },
  pronostico: { widthPx: 2, dash: [8, 4] },
  historico: { widthPx: 2, dash: [1, 3] },
  evacuacionPreventiva: { widthPx: 1.5, dash: [4, 4] },
  alerta: { widthPx: 1.5, dash: [10, 3, 2, 3] },
  evacuacion: { widthPx: 1.5, dash: [2, 2] },
};

/**
 * Pure: `width`/`dash` para una `uPlot.Series`, sin la clave `dash` cuando
 * la línea es sólida (el proyecto compila con `exactOptionalPropertyTypes`:
 * `dash: undefined` no es asignable al tipo de uPlot, que espera `number[]`
 * o la clave ausente).
 */
export function propsTrazoUplot(trazo: TrazoLinea): { width: number; dash?: number[] } {
  return trazo.dash ? { width: trazo.widthPx, dash: [...trazo.dash] } : { width: trazo.widthPx };
}

/**
 * Pure: fondo CSS de la muestra de leyenda para un rol — sólido si la línea
 * no tiene `dash`, o un `repeating-linear-gradient` que reproduce el mismo
 * patrón que dibuja uPlot (mismos anchos en px), para que la leyenda
 * coincida de verdad con la línea (requisito 4: mismo color, grosor y
 * patrón).
 */
export function fondoTrazoCss(color: string, trazo: TrazoLinea): string {
  if (!trazo.dash || trazo.dash.length === 0) return color;
  let pos = 0;
  const stops: string[] = [];
  trazo.dash.forEach((segmento, i) => {
    const esColor = i % 2 === 0;
    const inicio = pos;
    const fin = pos + segmento;
    stops.push(`${esColor ? color : "transparent"} ${inicio}px ${fin}px`);
    pos = fin;
  });
  return `repeating-linear-gradient(to right, ${stops.join(", ")})`;
}

// --- Custom properties CSS, generadas desde la paleta de arriba ----------

const VARIABLES: Record<keyof Omit<PaletaTema, "fondoTarjeta">, string> = {
  ejeTexto: "--graf-eje",
  grilla: "--graf-grilla",
  alturaReal: "--graf-altura-real",
  pronostico: "--graf-pronostico",
  pronosticoBanda: "--graf-pronostico-banda",
  historico: "--graf-historico",
  evacuacionPreventiva: "--graf-evac-preventiva",
  alerta: "--graf-alerta",
  evacuacion: "--graf-evacuacion",
  franjaAlerta: "--graf-franja-alerta",
};

function declaracionesCss(paleta: PaletaTema): string {
  return (Object.keys(VARIABLES) as (keyof typeof VARIABLES)[])
    .map((rol) => `    ${VARIABLES[rol]}: ${paleta[rol]};`)
    .join("\n");
}

/**
 * Pure: hoja de estilos con las custom properties de los dos temas, en el
 * mismo esquema que `style.css` (claro por defecto, oscuro por
 * `prefers-color-scheme` o por `[data-theme="dark"]` explícito).
 */
export function generarCssPaleta(): string {
  return `:root {
${declaracionesCss(PALETA.light)}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${declaracionesCss(PALETA.dark)}
  }
}
:root[data-theme="dark"] {
${declaracionesCss(PALETA.dark)}
}
`;
}

const ESTILO_ID = "paleta-graficos-estilos";

/**
 * Inyecta (o actualiza) el `<style>` con las custom properties de la
 * paleta. Toca `document` de verdad: se llama una sola vez desde
 * `main.ts`, no tiene test unitario (mismo criterio que `mountThemeToggle`).
 */
export function montarEstilosPaleta(doc: Document = document): void {
  let tag = doc.getElementById(ESTILO_ID) as HTMLStyleElement | null;
  if (!tag) {
    tag = doc.createElement("style");
    tag.id = ESTILO_ID;
    doc.head.appendChild(tag);
  }
  tag.textContent = generarCssPaleta();
}

/** Lee una custom property CSS en `referencia`, con fallback si no está definida (o en tests sin CSS real). */
export function leerVariableCss(nombre: string, fallback: string, referencia: HTMLElement): string {
  const valor = getComputedStyle(referencia).getPropertyValue(nombre).trim();
  return valor || fallback;
}
