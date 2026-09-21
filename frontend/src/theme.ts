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

// --- Suscripción a cambios de tema (para que los gráficos se redibujen) --

type OyenteTema = (tema: Tema) => void;

const oyentesTema = new Set<OyenteTema>();

/**
 * Se notifica cada vez que el tema *efectivo* cambia de verdad — por el
 * toggle o porque el sistema cambió `prefers-color-scheme` mientras no hay
 * una elección explícita guardada. Cada gráfico se suscribe al montarse y
 * desuscribe al destruirse (la función devuelta): sin eso, quedaría un
 * listener vivo por cada gráfico ya destruido (memory leak).
 */
export function onTemaCambia(callback: OyenteTema): () => void {
  oyentesTema.add(callback);
  return () => {
    oyentesTema.delete(callback);
  };
}

/**
 * Pure (no toca DOM): notifica a los suscriptos de `onTemaCambia`. Exportada
 * para poder testear la mecánica de suscripción/notificación sin pasar por
 * `mountThemeToggle` (que sí toca `document`/`window` reales).
 */
export function notificarCambioTema(tema: Tema): void {
  for (const callback of oyentesTema) callback(tema);
}

/**
 * Aplica el tema inicial al `<html>` y engancha el botón del header (T1) para
 * alternarlo y guardarlo. También escucha cambios de `prefers-color-scheme`
 * mientras el usuario no eligió un tema explícito (T2: la elección explícita
 * siempre gana). No testeado unitariamente: toca `document`,
 * `window.matchMedia` y `localStorage` reales.
 */
export function mountThemeToggle(
  boton: HTMLButtonElement,
  root: HTMLElement = document.documentElement,
  storage: StorageLike = window.localStorage,
): void {
  let mql: MediaQueryList | null = null;
  let prefiereOscuro = false;
  try {
    mql = window.matchMedia("(prefers-color-scheme: dark)");
    prefiereOscuro = mql.matches;
  } catch {
    mql = null;
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
    notificarCambioTema(temaActual);
  });

  if (mql) {
    const manejarCambioSistema = (prefiereOscuroAhora: boolean): void => {
      // La elección explícita del usuario siempre gana (T2): un cambio del
      // tema del sistema con el navegador abierto no la pisa.
      if (leerTemaGuardado(storage) !== null) return;
      temaActual = prefiereOscuroAhora ? "dark" : "light";
      aplicarTemaAlDom(temaActual, root);
      actualizarBoton(boton, temaActual);
      notificarCambioTema(temaActual);
    };
    try {
      mql.addEventListener("change", (ev) => manejarCambioSistema(ev.matches));
    } catch {
      // Safari viejo: sin addEventListener en MediaQueryList. Sin listener,
      // la página sigue funcionando con el tema resuelto al cargar.
    }
  }
}
