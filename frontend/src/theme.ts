/**
 * Tema claro/oscuro (spec 008, T1/T2). Por defecto sigue `prefers-color-scheme`;
 * la elección del usuario se guarda en `localStorage`, siempre con `try/catch`
 * porque puede fallar en ventana privada o con cookies bloqueadas — la página
 * tiene que andar igual si eso pasa (T2).
 *
 * Las funciones puras (lectura/escritura/resolución de tema) están acá y
 * testeadas; `mountThemeToggle` es la única parte que toca `document`/`window`
 * de verdad y no tiene test unitario (mismo criterio que `mountGrafico`, que
 * necesita un canvas real).
 */

export type Tema = "light" | "dark";

const STORAGE_KEY = "rioaltura-tema";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function esTema(valor: string | null): valor is Tema {
  return valor === "light" || valor === "dark";
}

/** Pure-ish: lee el tema guardado. Nunca lanza (T2): si `storage` falla, devuelve null. */
export function leerTemaGuardado(storage: StorageLike): Tema | null {
  try {
    const valor = storage.getItem(STORAGE_KEY);
    return esTema(valor) ? valor : null;
  } catch {
    return null;
  }
}

/** Pure-ish: guarda el tema elegido. Nunca lanza (T2): si `storage` falla, no hace nada. */
export function guardarTemaElegido(tema: Tema, storage: StorageLike): void {
  try {
    storage.setItem(STORAGE_KEY, tema);
  } catch {
    // Ventana privada, cookies bloqueadas, cuota llena: la elección no
    // persiste, pero la página sigue funcionando con el tema elegido en esta
    // sesión (T2).
  }
}

/** Pure: resuelve el tema inicial — lo guardado tiene prioridad; si no hay nada, sigue el sistema. */
export function resolverTemaInicial(storage: StorageLike, prefiereOscuroDelSistema: boolean): Tema {
  return leerTemaGuardado(storage) ?? (prefiereOscuroDelSistema ? "dark" : "light");
}

/** Pure: el otro tema. */
export function alternarTema(actual: Tema): Tema {
  return actual === "dark" ? "light" : "dark";
}

const ETIQUETAS: Record<Tema, { icono: string; ariaLabel: string }> = {
  light: { icono: "🌙", ariaLabel: "Cambiar a tema oscuro" },
  dark: { icono: "☀️", ariaLabel: "Cambiar a tema claro" },
};

function aplicarTemaAlDom(tema: Tema, root: HTMLElement): void {
  root.dataset.theme = tema;
}

function actualizarBoton(boton: HTMLButtonElement, tema: Tema): void {
  const etiqueta = ETIQUETAS[tema];
  boton.setAttribute("aria-label", etiqueta.ariaLabel);
  boton.setAttribute("aria-pressed", String(tema === "dark"));
  boton.textContent = etiqueta.icono;
}

/**
 * Aplica el tema inicial al `<html>` y engancha el botón del header (T1) para
 * alternarlo y guardarlo. No testeado unitariamente: toca `document`,
 * `window.matchMedia` y `localStorage` reales.
 */
export function mountThemeToggle(
  boton: HTMLButtonElement,
  root: HTMLElement = document.documentElement,
  storage: StorageLike = window.localStorage,
): void {
  let prefiereOscuro = false;
  try {
    prefiereOscuro = window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    prefiereOscuro = false;
  }

  let temaActual = resolverTemaInicial(storage, prefiereOscuro);
  aplicarTemaAlDom(temaActual, root);
  actualizarBoton(boton, temaActual);

  boton.addEventListener("click", () => {
    temaActual = alternarTema(temaActual);
    aplicarTemaAlDom(temaActual, root);
    actualizarBoton(boton, temaActual);
    guardarTemaElegido(temaActual, storage);
  });
}
