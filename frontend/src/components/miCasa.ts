import type { CapaCache, CapaIndex } from "../capas";
import {
  buscarAlturaInundacion,
  DISCLAIMER_MI_CASA,
  deriveMiCasaView,
  type MiCasaState,
  type MiCasaView,
  type PuntoMapa,
} from "../domain/miCasa";
import {
  borrarPunto,
  guardarPunto,
  leerPuntoGuardado,
  type StorageLike,
} from "../miCasaStorage";
import { precargarUmbral } from "./avisosTelegram";

/**
 * "Mi casa" (spec 015): a qué altura del puerto se moja el punto que el
 * vecino elige en el mapa.
 *
 * `renderMiCasa` es puro (sólo arma HTML a partir de una `MiCasaView` ya
 * calculada) y está testeado, mismo patrón que `estadoHoy.ts`/
 * `avisosTelegram.ts`. `mountMiCasa` es la capa fina que conecta con
 * `map.ts` (vía import dinámico, igual que `superficieAfectada.ts`, para no
 * romper la página si ese módulo no carga) y con `miCasaStorage.ts` -- toca
 * `document`/`window` reales y no tiene test unitario.
 *
 * El gesto es explícito (C6): un botón enciende el modo elección del mapa y
 * recién ahí un click marca el punto. Antes marcaba en cualquier click, y
 * tocar el mapa para cualquier otra cosa movía la casa del vecino sin forma
 * de deshacerlo.
 */

function renderCuerpo(view: MiCasaView): string {
  switch (view.kind) {
    case "sin-punto":
    case "eligiendo":
    case "calculando":
    case "error":
    case "fuera-de-area":
    case "seco":
      return `<p class="mi-casa-mensaje">${view.mensaje}</p>`;
    case "ya-inundado":
    case "encontrado":
      return `<p class="mi-casa-altura">${view.altura}</p><p class="mi-casa-mensaje">${view.mensaje}</p>`;
  }
}

/**
 * Sólo se muestra junto a una respuesta real (C5: "siempre, junto a la
 * respuesta"). Antes de marcar ("sin-punto", "eligiendo") no hay respuesta
 * todavía, así que no hay nada de qué advertir; en cuanto hay algún
 * resultado -- incluido "fuera de área" o un error -- se muestra, y nunca se
 * puede cerrar (el bloque no lleva ningún control).
 */
function muestraDisclaimer(kind: MiCasaView["kind"]): boolean {
  return kind !== "sin-punto" && kind !== "eligiendo" && kind !== "calculando";
}

function renderDisclaimer(): string {
  return `
    <div class="mi-casa-disclaimer">
      <strong>${DISCLAIMER_MI_CASA}</strong>
    </div>
  `;
}

/** Hay un punto marcado (aunque no se haya podido calcular su altura): se puede cambiar o borrar. */
function hayPunto(kind: MiCasaView["kind"]): boolean {
  return kind !== "sin-punto" && kind !== "eligiendo" && kind !== "calculando";
}

/**
 * Los botones son el arreglo de fondo de C6: el vecino ve qué puede hacer en
 * vez de tener que adivinar que un click en el mapa hace algo.
 */
function renderAcciones(kind: MiCasaView["kind"]): string {
  if (kind === "calculando") return "";
  const botones =
    kind === "eligiendo"
      ? `<button type="button" class="mi-casa-boton" data-accion="cancelar">Cancelar</button>`
      : hayPunto(kind)
        ? `<button type="button" class="mi-casa-boton mi-casa-boton-primario" data-accion="marcar">Elegir otro punto</button>` +
          `<button type="button" class="mi-casa-boton mi-casa-boton-borrar" data-accion="borrar">Borrar</button>`
        : `<button type="button" class="mi-casa-boton mi-casa-boton-primario" data-accion="marcar">📍 Marcar mi casa</button>`;
  return `<div class="mi-casa-acciones">${botones}</div>`;
}

/**
 * C7: explicarle al vecino cómo se usa, sin obligarlo a leerlo. `<details>`
 * nativo -- sin JS, accesible por teclado y plegado por defecto.
 */
function renderAyuda(): string {
  return `
    <details class="mi-casa-ayuda">
      <summary>¿Cómo se usa?</summary>
      <ol class="mi-casa-pasos">
        <li>Tocá <strong>"Marcar mi casa"</strong>.</li>
        <li>Tocá tu casa en el mapa.</li>
        <li>Te decimos a qué altura del río llega el agua ahí.</li>
      </ol>
      <p class="mi-casa-privacidad">
        El punto queda guardado <strong>sólo en este teléfono</strong>. No se envía a ningún lado.
      </p>
    </details>
  `;
}

/** Pure: sólo arma el HTML de la tarjeta a partir de una `MiCasaView` ya calculada. No lógica, no DOM real. */
export function renderMiCasa(container: HTMLElement, view: MiCasaView): void {
  const rol = view.kind === "error" ? "alert" : "status";
  container.innerHTML = `
    <h2>Mi casa</h2>
    <p class="card-subtitulo">A qué altura del río se moja el punto que elijas.</p>
    <div class="mi-casa-resultado" role="${rol}" aria-live="polite">${renderCuerpo(view)}</div>
    ${muestraDisclaimer(view.kind) ? renderDisclaimer() : ""}
    ${renderAcciones(view.kind)}
    ${renderAyuda()}
  `;
}

interface MiCasaMapModule {
  onCapaIndexListo?: (listener: (ctx: { index: CapaIndex; cache: CapaCache }) => void) => () => void;
  onMiCasaClick?: (listener: (punto: PuntoMapa) => void) => () => void;
  onModoEleccionMiCasaCambia?: (listener: (activo: boolean) => void) => () => void;
  marcarMiCasa?: (punto: PuntoMapa) => void;
  borrarMiCasa?: () => void;
  setModoEleccionMiCasa?: (activo: boolean) => void;
}

/**
 * Conecta la tarjeta con el mapa y con `localStorage`. `telegramContainer`
 * es opcional (C4): si se pasa, precarga su input de umbral en cuanto hay
 * una altura calculada (spec 011, `precargarUmbral`).
 */
export function mountMiCasa(
  container: HTMLElement,
  telegramContainer?: HTMLElement,
  storage: StorageLike = window.localStorage,
  loadMapModule: () => Promise<MiCasaMapModule> = () => import("../map"),
): void {
  let state: MiCasaState = { kind: "sin-punto" };
  // Último estado que correspondía a un punto marcado. Si el vecino entra al
  // modo elección y lo cancela, la tarjeta vuelve acá en vez de perder la
  // respuesta que ya tenía.
  let estadoConPunto: MiCasaState | null = null;
  let ctx: { index: CapaIndex; cache: CapaCache } | null = null;
  let mapa: MiCasaMapModule | null = null;

  function actualizar(nuevo: MiCasaState): void {
    state = nuevo;
    if (nuevo.kind !== "sin-punto" && nuevo.kind !== "eligiendo" && nuevo.kind !== "calculando") {
      estadoConPunto = nuevo;
    }
    const view = deriveMiCasaView(state);
    renderMiCasa(container, view);
    if (telegramContainer && (view.kind === "encontrado" || view.kind === "ya-inundado")) {
      precargarUmbral(telegramContainer, view.alturaM);
    }
  }

  actualizar(state);

  async function calcular(punto: PuntoMapa): Promise<void> {
    // Se guarda apenas se marca (C3), independiente del resultado: es "el
    // punto marcado", no "el punto que dio una altura calculable".
    guardarPunto(punto, storage);
    if (!ctx) {
      actualizar({ kind: "error" });
      return;
    }
    actualizar({ kind: "calculando" });
    try {
      const resultado = await buscarAlturaInundacion(ctx.index, ctx.cache, punto);
      actualizar(resultado);
    } catch {
      actualizar({ kind: "error" });
    }
  }

  function borrar(): void {
    borrarPunto(storage);
    mapa?.borrarMiCasa?.();
    mapa?.setModoEleccionMiCasa?.(false);
    estadoConPunto = null;
    actualizar({ kind: "sin-punto" });
  }

  // Delegación: un único listener en la tarjeta, que sobrevive a cada
  // `innerHTML = ...` de `renderMiCasa` (los botones se recrean en cada
  // render, así que no se les puede colgar el handler directamente).
  container.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const boton = target.closest("[data-accion]");
    if (!boton) return;
    switch (boton.getAttribute("data-accion")) {
      case "marcar":
        mapa?.setModoEleccionMiCasa?.(true);
        break;
      case "cancelar":
        mapa?.setModoEleccionMiCasa?.(false);
        break;
      case "borrar":
        borrar();
        break;
    }
  });

  void loadMapModule()
    .then((mod) => {
      mapa = mod;
      if (typeof mod.onCapaIndexListo === "function") {
        mod.onCapaIndexListo((listo) => {
          ctx = listo;
          // Restaurar el punto guardado (C3), sólo si el vecino todavía no
          // marcó nada en esta sesión (no pisar un click real reciente).
          if (state.kind === "sin-punto") {
            const guardado = leerPuntoGuardado(storage);
            if (guardado) {
              mod.marcarMiCasa?.(guardado);
              void calcular(guardado);
            }
          }
        });
      }
      if (typeof mod.onMiCasaClick === "function") {
        mod.onMiCasaClick((punto) => {
          void calcular(punto);
        });
      }
      if (typeof mod.onModoEleccionMiCasaCambia === "function") {
        mod.onModoEleccionMiCasaCambia((activo) => {
          if (activo) {
            actualizar({ kind: "eligiendo" });
            return;
          }
          // Se apagó el modo. Si fue porque marcó un punto, `calcular` ya
          // movió la tarjeta a "calculando" y no hay nada que hacer; si fue
          // un cancelar (botón o Escape), se vuelve a lo que había antes.
          if (state.kind === "eligiendo") {
            actualizar(estadoConPunto ?? { kind: "sin-punto" });
          }
        });
      }
    })
    .catch(() => {
      // El mapa no cargó (spec 006 defensivo, ver `components/mapa.ts`): la
      // tarjeta se queda en "sin-punto", sin romper el resto de la página.
    });
}
