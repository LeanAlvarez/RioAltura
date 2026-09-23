import type { CapaCache, CapaIndex } from "../capas";
import {
  buscarAlturaInundacion,
  DISCLAIMER_MI_CASA,
  deriveMiCasaView,
  type MiCasaState,
  type MiCasaView,
  type PuntoMapa,
} from "../domain/miCasa";
import { borrarPunto, guardarPunto, leerPuntoGuardado, type StorageLike } from "../miCasaStorage";
import { precargarUmbral } from "./avisosTelegram";

/**
 * "Mi casa" (spec 015): a qué altura del puerto se moja el punto que el
 * vecino elige en el mapa.
 *
 * El gesto es explícito (C6): un botón enciende el modo elección del mapa y
 * recién ahí un click marca el punto. Antes marcaba en cualquier click, y
 * tocar el mapa para cualquier otra cosa movía la casa del vecino sin forma
 * de deshacerlo.
 *
 * La tarjeta se arma UNA vez (`renderEstructuraMiCasa`) y después sólo se
 * repintan sus partes (`partesMiCasa`). No es un detalle de rendimiento:
 * reescribir el `innerHTML` entero en cada cambio rompía tres cosas a la vez
 * -- la región `aria-live` nacía con el texto ya adentro (y los lectores de
 * pantalla no anuncian eso), el foco del teclado volvía a `<body>` en cada
 * acción, y el `<details>` de ayuda se plegaba solo justo cuando el vecino
 * estaba siguiendo sus pasos.
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
 * Hay una respuesta que mostrar. Antes de marcar ("sin-punto", "eligiendo") y
 * mientras busca no hay nada de qué advertir ni nada que borrar, así que el
 * mismo predicado decide el disclaimer (C5) y los botones (C6): nunca puede
 * aparecer una respuesta sin su disclaimer al lado.
 */
function hayRespuesta(kind: MiCasaView["kind"]): boolean {
  return kind !== "sin-punto" && kind !== "eligiendo" && kind !== "calculando";
}

export interface PartesMiCasa {
  /** `alert` para el error: es la única respuesta que conviene anunciar sin esperar. */
  rol: "status" | "alert";
  cuerpo: string;
  disclaimer: string;
  acciones: string;
}

/** Pure: estado ya derivado -> los tres pedazos variables de la tarjeta. No DOM. */
export function partesMiCasa(view: MiCasaView): PartesMiCasa {
  const disclaimer = hayRespuesta(view.kind)
    ? `<div class="mi-casa-disclaimer"><strong>${DISCLAIMER_MI_CASA}</strong></div>`
    : "";

  let botones = "";
  if (view.kind === "eligiendo") {
    botones = `<button type="button" class="mi-casa-boton" data-accion="cancelar">Cancelar</button>`;
  } else if (hayRespuesta(view.kind)) {
    botones =
      `<button type="button" class="mi-casa-boton mi-casa-boton-primario" data-accion="marcar">Elegir otro punto</button>` +
      `<button type="button" class="mi-casa-boton mi-casa-boton-borrar" data-accion="borrar">Borrar</button>`;
  } else if (view.kind === "sin-punto") {
    botones = `<button type="button" class="mi-casa-boton mi-casa-boton-primario" data-accion="marcar">📍 Marcar mi casa</button>`;
  }

  return {
    rol: view.kind === "error" ? "alert" : "status",
    cuerpo: renderCuerpo(view),
    disclaimer,
    acciones: botones,
  };
}

/**
 * Pure: el armazón fijo de la tarjeta, que se escribe una sola vez. Los
 * contenedores que quedan vacíos los llena `partesMiCasa` en cada cambio;
 * el `<details>` de ayuda (C7) vive acá justamente para que nunca se lo
 * lleve puesto un repintado.
 */
export function renderEstructuraMiCasa(): string {
  return `
    <h2>Mi casa</h2>
    <p class="card-subtitulo">A qué altura del río se moja el punto que elijas.</p>
    <div class="mi-casa-resultado" role="status" aria-live="polite"></div>
    <div class="mi-casa-disclaimer-wrap"></div>
    <div class="mi-casa-acciones"></div>
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

interface MiCasaMapModule {
  onCapaIndexListo?: (listener: (ctx: { index: CapaIndex; cache: CapaCache }) => void) => () => void;
  onCapaIndexError?: (listener: () => void) => () => void;
  onMiCasaClick?: (listener: (punto: PuntoMapa) => void) => () => void;
  onModoEleccionMiCasaCambia?: (listener: (activo: boolean) => void) => () => void;
  marcarMiCasa?: (punto: PuntoMapa) => void;
  borrarMiCasa?: () => void;
  setModoEleccionMiCasa?: (activo: boolean) => void;
}

export interface MontajeMiCasa {
  destroy(): void;
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
): MontajeMiCasa {
  let state: MiCasaState = { kind: "sin-punto" };
  // Último estado que correspondía a un punto marcado: si el vecino entra al
  // modo elección y lo cancela, la tarjeta vuelve acá en vez de perder la
  // respuesta que ya tenía.
  let estadoConPunto: MiCasaState | null = null;
  // El punto que el vecino marcó (o el restaurado). Distinto de
  // `estadoConPunto`: existe aunque el cálculo todavía no haya terminado, y
  // es lo que decide si hay que restaurar el guardado o no.
  let puntoMarcado: PuntoMapa | null = null;
  let ctx: { index: CapaIndex; cache: CapaCache } | null = null;
  let mapa: MiCasaMapModule | null = null;
  // El módulo del mapa se importa aparte (son ~46 kB comprimidos) y la
  // tarjeta ya pintó su botón mucho antes de que llegue. En 3G el vecino lo
  // toca y todavía no hay a quién avisarle: se anota la intención y se
  // aplica en cuanto el módulo resuelve, en vez de tragarse el toque.
  let eleccionPendiente = false;
  const bajas: Array<() => void> = [];

  container.innerHTML = renderEstructuraMiCasa();
  const resultadoEl = container.querySelector<HTMLElement>(".mi-casa-resultado");
  const disclaimerEl = container.querySelector<HTMLElement>(".mi-casa-disclaimer-wrap");
  const accionesEl = container.querySelector<HTMLElement>(".mi-casa-acciones");
  if (!resultadoEl || !disclaimerEl || !accionesEl) return { destroy(): void {} };

  function pintar(view: MiCasaView): void {
    if (!resultadoEl || !disclaimerEl || !accionesEl) return;
    const partes = partesMiCasa(view);

    resultadoEl.setAttribute("role", partes.rol);
    // `role="alert"` ya implica `assertive`; dejarle encima un `aria-live`
    // explícito lo degradaría a `polite`.
    if (partes.rol === "alert") resultadoEl.removeAttribute("aria-live");
    else resultadoEl.setAttribute("aria-live", "polite");
    resultadoEl.innerHTML = partes.cuerpo;
    disclaimerEl.innerHTML = partes.disclaimer;

    // Si el foco estaba en el botón que acaba de desaparecer, se lo pasamos
    // al que ocupa su lugar. Sin esto, quien navega por teclado vuelve al
    // principio del documento en cada acción.
    const teniaFoco = accionesEl.contains(document.activeElement);
    accionesEl.innerHTML = partes.acciones;
    if (teniaFoco) accionesEl.querySelector("button")?.focus();
  }

  function actualizar(nuevo: MiCasaState): void {
    if (hayRespuesta(nuevo.kind)) estadoConPunto = nuevo;
    // Mientras el vecino está eligiendo, nada le pisa la pantalla: un cálculo
    // que llega tarde (la restauración del punto guardado, por ejemplo) queda
    // en `estadoConPunto` y se muestra cuando termine de elegir. El camino
    // normal de marcado no pasa por acá: `map.ts` apaga el modo antes de
    // avisar del click.
    if (state.kind === "eligiendo" && nuevo.kind !== "eligiendo") return;
    state = nuevo;
    const view = deriveMiCasaView(state);
    pintar(view);
    if (telegramContainer && (view.kind === "encontrado" || view.kind === "ya-inundado")) {
      precargarUmbral(telegramContainer, view.alturaM);
    }
  }

  actualizar(state);

  async function calcular(punto: PuntoMapa, yaGuardado = false): Promise<void> {
    puntoMarcado = punto;
    // Se guarda apenas se marca (C3), independiente del resultado: es "el
    // punto marcado", no "el punto que dio una altura calculable".
    if (!yaGuardado) guardarPunto(punto, storage);
    actualizar({ kind: "calculando" });
    // Las capas todavía no llegaron (3G): el punto queda anotado y se calcula
    // en cuanto lleguen, en vez de mostrar un error que no es tal.
    if (!ctx) return;
    try {
      actualizar(await buscarAlturaInundacion(ctx.index, ctx.cache, punto));
    } catch {
      actualizar({ kind: "error" });
    }
  }

  function borrar(): void {
    borrarPunto(storage);
    mapa?.setModoEleccionMiCasa?.(false);
    mapa?.borrarMiCasa?.();
    estadoConPunto = null;
    puntoMarcado = null;
    actualizar({ kind: "sin-punto" });
  }

  // Delegación: un único listener en la tarjeta, que sobrevive a cada
  // repintado de los botones.
  function alClickear(e: MouseEvent): void {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const boton = target.closest("[data-accion]");
    if (!boton) return;
    switch (boton.getAttribute("data-accion")) {
      case "marcar":
        if (mapa?.setModoEleccionMiCasa) mapa.setModoEleccionMiCasa(true);
        else {
          eleccionPendiente = true;
          actualizar({ kind: "eligiendo" });
        }
        break;
      case "cancelar":
        eleccionPendiente = false;
        if (mapa?.setModoEleccionMiCasa) mapa.setModoEleccionMiCasa(false);
        else actualizar(estadoConPunto ?? { kind: "sin-punto" });
        break;
      case "borrar":
        borrar();
        break;
    }
  }
  container.addEventListener("click", alClickear);

  void loadMapModule()
    .then((mod) => {
      mapa = mod;
      // Antes de suscribirse: así el replay de la suscripción ya trae el modo
      // encendido y la tarjeta no parpadea entre "eligiendo" y "sin punto".
      if (eleccionPendiente) {
        eleccionPendiente = false;
        mod.setModoEleccionMiCasa?.(true);
      }
      if (typeof mod.onCapaIndexListo === "function") {
        bajas.push(
          mod.onCapaIndexListo((listo) => {
            ctx = listo;
            // Si el vecino ya marcó algo (incluso antes de que llegaran las
            // capas), eso gana sobre el punto guardado.
            if (puntoMarcado) {
              void calcular(puntoMarcado, true);
              return;
            }
            const guardado = leerPuntoGuardado(storage);
            if (guardado) {
              mod.marcarMiCasa?.(guardado);
              void calcular(guardado, true);
            }
          }),
        );
      }
      if (typeof mod.onCapaIndexError === "function") {
        bajas.push(
          mod.onCapaIndexError(() => {
            // Sin capas no se puede calcular nunca: decirlo en vez de dejar
            // la tarjeta en "Buscando…" para siempre.
            if (puntoMarcado) actualizar({ kind: "error" });
          }),
        );
      }
      if (typeof mod.onMiCasaClick === "function") {
        bajas.push(
          mod.onMiCasaClick((punto) => {
            void calcular(punto);
          }),
        );
      }
      if (typeof mod.onModoEleccionMiCasaCambia === "function") {
        bajas.push(
          mod.onModoEleccionMiCasaCambia((activo) => {
            if (activo) {
              actualizar({ kind: "eligiendo" });
              return;
            }
            // Se apagó el modo sin marcar (botón Cancelar o Escape): se
            // vuelve a lo que había antes.
            if (state.kind === "eligiendo") {
              state = { kind: "sin-punto" };
              actualizar(estadoConPunto ?? { kind: "sin-punto" });
            }
          }),
        );
      }
    })
    .catch(() => {
      // El mapa no cargó (spec 006 defensivo, ver `components/mapa.ts`): la
      // tarjeta vuelve a su estado inicial en vez de quedarse esperando un
      // click que nadie va a escuchar, y el resto de la página sigue igual.
      eleccionPendiente = false;
      if (state.kind === "eligiendo") {
        state = { kind: "sin-punto" };
        actualizar(estadoConPunto ?? { kind: "sin-punto" });
      }
    });

  return {
    destroy(): void {
      container.removeEventListener("click", alClickear);
      for (const baja of bajas) baja();
      bajas.length = 0;
    },
  };
}
