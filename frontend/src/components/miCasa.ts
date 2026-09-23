import type { CapaCache, CapaIndex } from "../capas";
import {
  buscarAlturaInundacion,
  DISCLAIMER_MI_CASA,
  deriveMiCasaView,
  type MiCasaState,
  type MiCasaView,
  type PuntoMapa,
} from "../domain/miCasa";
import { guardarPunto, leerPuntoGuardado, type StorageLike } from "../miCasaStorage";
import { precargarUmbral } from "./avisosTelegram";

/**
 * "Mi casa" (spec 015): a qué altura del puerto se moja el punto que el
 * vecino toca en el mapa.
 *
 * `renderMiCasa` es puro (sólo arma HTML a partir de una `MiCasaView` ya
 * calculada) y está testeado, mismo patrón que `estadoHoy.ts`/
 * `avisosTelegram.ts`. `mountMiCasa` es la capa fina que conecta con
 * `map.ts` (vía import dinámico, igual que `superficieAfectada.ts`, para no
 * romper la página si ese módulo no carga) y con `miCasaStorage.ts` -- toca
 * `document`/`window` reales y no tiene test unitario.
 */

function renderCuerpo(view: MiCasaView): string {
  switch (view.kind) {
    case "sin-punto":
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
 * respuesta"). Antes de tocar el mapa ("sin-punto") no hay respuesta
 * todavía, así que no hay nada de qué advertir; en cuanto hay algún
 * resultado -- incluido "fuera de área" o un error -- se muestra, y nunca se
 * puede cerrar (no tiene ningún botón).
 */
function muestraDisclaimer(kind: MiCasaView["kind"]): boolean {
  return kind !== "sin-punto" && kind !== "calculando";
}

function renderDisclaimer(): string {
  return `
    <div class="mi-casa-disclaimer">
      <strong>${DISCLAIMER_MI_CASA}</strong>
    </div>
  `;
}

/** Pure: sólo arma el HTML de la tarjeta a partir de una `MiCasaView` ya calculada. No lógica, no DOM real. */
export function renderMiCasa(container: HTMLElement, view: MiCasaView): void {
  const rol = view.kind === "error" ? "alert" : "status";
  container.innerHTML = `
    <h2>Mi casa</h2>
    <p class="card-subtitulo">Tocá el mapa para saber a qué altura del río se moja el punto que elijas.</p>
    <div class="mi-casa-resultado" role="${rol}" aria-live="polite">${renderCuerpo(view)}</div>
    ${muestraDisclaimer(view.kind) ? renderDisclaimer() : ""}
  `;
}

interface MiCasaMapModule {
  onCapaIndexListo?: (listener: (ctx: { index: CapaIndex; cache: CapaCache }) => void) => () => void;
  onMiCasaClick?: (listener: (punto: PuntoMapa) => void) => () => void;
  marcarMiCasa?: (punto: PuntoMapa) => void;
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
  let ctx: { index: CapaIndex; cache: CapaCache } | null = null;

  function actualizar(nuevo: MiCasaState): void {
    state = nuevo;
    const view = deriveMiCasaView(state);
    renderMiCasa(container, view);
    if (telegramContainer && (view.kind === "encontrado" || view.kind === "ya-inundado")) {
      precargarUmbral(telegramContainer, view.alturaM);
    }
  }

  actualizar(state);

  async function calcular(punto: PuntoMapa): Promise<void> {
    // Se guarda apenas se toca el mapa (C3), independiente del resultado: es
    // "el punto marcado", no "el punto que dio una altura calculable".
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

  void loadMapModule()
    .then((mod) => {
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
    })
    .catch(() => {
      // El mapa no cargó (spec 006 defensivo, ver `components/mapa.ts`): la
      // tarjeta se queda en "sin-punto", sin romper el resto de la página.
    });
}
