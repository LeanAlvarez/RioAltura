import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  type CapaCache,
  type CapaEntry,
  type CapaIndex,
  createCapaCache,
  createEstadoMapa,
  describeMostrando,
  type EstadoMapa,
  fetchCapaIndex,
  type MedicionActual,
  type VistaMapa,
} from "./capas";
// Import de sólo tipo (spec 015): sin ciclo de import en tiempo de ejecución,
// `domain/miCasa.ts` no importa nada de este módulo.
import type { PuntoMapa } from "./domain/miCasa";

// Colón, Entre Ríos. See specs/001-infra.md.
export const COLON_CENTER: L.LatLngTuple = [-32.215, -58.145];
export const COLON_ZOOM = 14;

const PUERTO_HIDROMETRO: L.LatLngTuple = [-32.2147, -58.137];

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ESRI_ATTRIBUTION =
  "Imagen: &copy; Esri, Maxar, Earthstar Geographics y la comunidad de usuarios de GIS";

export function createBaseLayers(): Record<string, L.TileLayer> {
  return {
    Satélite: L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: ESRI_ATTRIBUTION },
    ),
    Calles: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: OSM_ATTRIBUTION,
    }),
  };
}

// Matches --agua-1/2/3 in style.css. Duplicated as literal hex rather than read
// from CSS custom properties: Leaflet's SVG renderer sets `fill`/`stroke` as raw
// SVG presentation attributes, and relying on `var()` resolving there is an
// unnecessary risk for a value the domain rules (CLAUDE.md §5) never change.
const COLOR_CLASE: Record<1 | 2 | 3, string> = {
  1: "#9ecae1",
  2: "#3182bd",
  3: "#08519c",
};

/** Marcador de "Mi casa" (spec 015): naranja, bien distinto de las capas azules y del hidrómetro. */
const COLOR_MI_CASA = "#e6550d";

function estiloClase(clase: unknown): L.PathOptions {
  const c = clase === 2 || clase === 3 ? clase : 1;
  return {
    stroke: false,
    weight: 0,
    fillColor: COLOR_CLASE[c],
    fillOpacity: c === 3 ? 0.65 : 0.55,
  };
}

const fechaGeneradoFormatter = new Intl.DateTimeFormat("es-AR", { dateStyle: "short" });

function formatGenerado(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "";
  return `Mapa calculado el ${fechaGeneradoFormatter.format(fecha)}`;
}

export interface MapaInundacion {
  map: L.Map;
  setNivelActual(medicion: MedicionActual): void;
  setNivelPronosticado(h: number): void;
  /** Selecciona una altura por código (spec 007 T7: sincronización con la curva de hectáreas). */
  seleccionar(h: number): void;
  /** Se dispara con cada cambio de selección (slider, escenario o `seleccionar`), spec 007 T7. */
  onSeleccionCambia(listener: (h: number) => void): () => void;
  /**
   * Marca (o remarca) el punto de "Mi casa" en el mapa (spec 015). No calcula
   * nada -- sólo dibuja; el cálculo lo dispara quien escuche `onMiCasaClick`
   * o llame a esto directamente (p. ej. al restaurar el punto guardado).
   */
  marcarMiCasa(punto: PuntoMapa): void;
  /** Saca el marcador de "Mi casa" del mapa (spec 015, C6). No toca `localStorage`. */
  borrarMiCasa(): void;
  /** Se dispara con el click que marca el punto, sólo en modo elección (spec 015, C1/C2/C6). */
  onMiCasaClick(listener: (punto: PuntoMapa) => void): () => void;
  destroy(): void;
}

// Declared here (not vite-env.d.ts, which spec 006 does not own). `createMap`
// publishes the instance so anything outside the module graph can call
// `window.mapaInundacion?.setNivelPronosticado(h)`.
declare global {
  interface Window {
    mapaInundacion?: MapaInundacion;
  }
}

// Last map created. Spec 005 mounts this module through `components/mapa.ts`,
// which only holds the module namespace, so the level setters are re-exported
// below as module-level functions delegating to this instance.
let ultimaInstancia: MapaInundacion | null = null;

// Selection subscribers live at module scope, not per instance: the hectares
// card (spec 007 T7) subscribes through the module as soon as it mounts, which
// happens before `createMap` has run. A per-instance registry silently dropped
// those listeners, so the map never pushed its changes to the curve.
const nivelListeners = new Set<(h: number) => void>();
// Last selection pushed, replayed to late subscribers so both controls agree
// from the first paint instead of starting on different heights.
let ultimaSeleccion: number | null = null;

function emitirSeleccion(h: number): void {
  ultimaSeleccion = h;
  for (const listener of nivelListeners) listener(h);
}

function suscribirSeleccion(listener: (h: number) => void): () => void {
  nivelListeners.add(listener);
  if (ultimaSeleccion !== null) listener(ultimaSeleccion);
  return () => nivelListeners.delete(listener);
}

// --- "Mi casa" (spec 015): mismo patrón module-scope que la selección de
// arriba, así `components/miCasa.ts` puede suscribirse sin depender de que
// `createMap` ya haya corrido (spec 007 ya resolvió este mismo problema para
// el slider/curva de hectáreas).

const miCasaClickListeners = new Set<(punto: PuntoMapa) => void>();

function emitirMiCasaClick(punto: PuntoMapa): void {
  for (const listener of miCasaClickListeners) listener(punto);
}

function suscribirMiCasaClick(listener: (punto: PuntoMapa) => void): () => void {
  miCasaClickListeners.add(listener);
  return () => miCasaClickListeners.delete(listener);
}

// Modo elección (spec 015, C6). Antes el handler de click marcaba "Mi casa"
// en CUALQUIER click del mapa: tocar para cerrar un popup o para mirar otra
// zona movía la casa del vecino, sin forma de deshacerlo. Ahora el click sólo
// marca mientras este flag está encendido, y lo enciende un botón explícito
// de la tarjeta. El flag vive a nivel de módulo (no por instancia) por el
// mismo motivo que la selección de altura: la tarjeta se monta antes de que
// `createMap` haya corrido.
const modoEleccionListeners = new Set<(activo: boolean) => void>();
let modoEleccionActivo = false;

function suscribirModoEleccion(listener: (activo: boolean) => void): () => void {
  modoEleccionListeners.add(listener);
  listener(modoEleccionActivo);
  return () => modoEleccionListeners.delete(listener);
}

/** `index`/`cache` recién creados por `createMap`, para que "Mi casa" reuse la misma caché que el mapa (C2). */
export interface CapaIndexListo {
  index: CapaIndex;
  cache: CapaCache;
}

let ultimoIndexListo: CapaIndexListo | null = null;
const indexListoListeners = new Set<(ctx: CapaIndexListo) => void>();

function emitirIndexListo(ctx: CapaIndexListo): void {
  ultimoIndexListo = ctx;
  for (const listener of indexListoListeners) listener(ctx);
}

function suscribirIndexListo(listener: (ctx: CapaIndexListo) => void): () => void {
  indexListoListeners.add(listener);
  if (ultimoIndexListo !== null) listener(ultimoIndexListo);
  return () => indexListoListeners.delete(listener);
}

interface Panel {
  render(vista: VistaMapa): void;
}

/**
 * Franja siempre visible, FUERA del `<details>` colapsable (correcciones de
 * diseño, spec 007 ítem 3): en mobile el panel arranca plegado (M2), así que
 * sin esto no había forma de saber a qué altura correspondían las manchas
 * azules del mapa, ni de leer la leyenda de profundidad — información que
 * dependía solo de abrir un acordeón (y, para el color, solo del color;
 * CLAUDE.md §7 lo prohíbe).
 */
function crearResumenSiempreVisible(container: HTMLElement, index: CapaIndex): Panel {
  const resumen = L.DomUtil.create("div", "mapa-inundacion-resumen", container);
  const mostrandoEl = L.DomUtil.create("p", "mapa-inundacion-mostrando", resumen);

  const leyenda = L.DomUtil.create("ul", "capas-leyenda", resumen);
  for (const clase of index.clases) {
    const item = L.DomUtil.create(
      "li",
      `capas-leyenda-item capas-leyenda-clase-${String(clase.clase)}`,
      leyenda,
    );
    item.textContent = clase.etiqueta;
  }

  return {
    render(vista) {
      mostrandoEl.textContent = describeMostrando(vista);
    },
  };
}

function crearPanel(container: HTMLElement, index: CapaIndex, estado: EstadoMapa): Panel {
  // Spec 007 M2: el panel es un `<details>` plegable *fuera* del lienzo del
  // mapa (ver `createMap`, que ya no lo pasa como hijo del contenedor de
  // Leaflet), así nunca tapa la ciudad.
  //
  // Defecto G2 (revisión de diseño): antes arrancaba plegado en mobile y
  // tablet (`< 900px`) para "priorizar el mapa" — pero eso dejaba el slider
  // y los escenarios invisibles justo donde más se usa la app (el celular),
  // así que se perdía la mitad del producto ("¿a qué altura se moja mi
  // casa?") detrás de un título que no explicaba qué hacía. Ahora arranca
  // abierto en cualquier ancho; sigue plegable para quien solo quiera ver el
  // mapa, con un texto que dice qué pasa al tocarlo y un chevron (ver
  // `.capas-panel-resumen::after` en style.css) en vez de depender del
  // triángulo nativo de `<summary>` (que `display:flex` ya le saca).
  const detalles = L.DomUtil.create("details", "capas-panel", container);
  detalles.open = true;
  const resumen = L.DomUtil.create("summary", "capas-panel-resumen", detalles);
  resumen.textContent = "Ver el mapa a otra altura";
  const panel = L.DomUtil.create("div", "capas-panel-contenido", detalles);
  L.DomEvent.disableClickPropagation(panel);
  L.DomEvent.disableScrollPropagation(panel);

  // "m IGN" (item 8, correcciones de diseño): jerga técnica de datum
  // geodésico que no aporta a la vista principal; vive en "Detalle técnico"
  // (detalleTecnico.ts) en vez de acá.
  const lectura = L.DomUtil.create("div", "capas-lectura", panel);
  const alturaEl = L.DomUtil.create("strong", "capas-altura", lectura);
  const hectareasEl = L.DomUtil.create("span", "capas-hectareas", lectura);
  const mostrandoEl = L.DomUtil.create("span", "capas-mostrando", lectura);

  // Spec 007 M3: texto explícito de a qué altura corresponde lo que se ve.
  const zonasEl = L.DomUtil.create("p", "capas-zonas", panel);

  const slider = L.DomUtil.create("input", "capas-slider", panel);
  slider.type = "range";
  slider.min = String(index.nivel_min);
  slider.max = String(index.nivel_max);
  slider.step = String(index.paso.hasta_1050);
  slider.setAttribute("aria-label", "Altura del puerto");
  slider.addEventListener("input", () => {
    estado.seleccionar(Number(slider.value), { porUsuario: true });
  });

  const escenariosEl = L.DomUtil.create("div", "capas-escenarios", panel);
  escenariosEl.setAttribute("role", "group");
  escenariosEl.setAttribute("aria-label", "Escenarios");

  // Menor (revisión de diseño): el degradé + flecha del borde derecho
  // (`.capas-escenarios::before/::after`) son un indicador de "hay más
  // chips", así que tienen que desaparecer cuando ya se llegó al final del
  // scroll (si no, quedan mintiendo que hay más).
  function actualizarIndicadorScroll(): void {
    const alFinal = escenariosEl.scrollLeft + escenariosEl.clientWidth >= escenariosEl.scrollWidth - 2;
    escenariosEl.classList.toggle("capas-escenarios--fin", alFinal);
  }
  escenariosEl.addEventListener("scroll", actualizarIndicadorScroll, { passive: true });

  const botones = new Map<string, HTMLButtonElement>();
  for (const escenario of estado.escenarios()) {
    const boton = L.DomUtil.create("button", "capas-escenario", escenariosEl);
    boton.type = "button";
    boton.textContent = escenario.etiqueta;
    boton.dataset.id = escenario.id;
    boton.addEventListener("click", () => {
      const actual = estado.escenarios().find((e) => e.id === escenario.id);
      if (!actual || actual.h === null || !actual.habilitado) return;
      estado.seleccionar(actual.h, { porUsuario: true });
    });
    botones.set(escenario.id, boton);
  }
  actualizarIndicadorScroll();

  // La leyenda de profundidad vive en `crearResumenSiempreVisible`, fuera de
  // este panel colapsable, para que se vea sin abrir nada (ítem 3).
  const generadoEl = L.DomUtil.create("p", "capas-generado", panel);
  generadoEl.textContent = formatGenerado(index.generado);

  // En flujo normal dentro del panel (no superpuesto sobre el mapa, spec 007 M2).
  const fueraDeRangoEl = L.DomUtil.create("div", "capas-fuera-rango", panel);
  fueraDeRangoEl.setAttribute("role", "alert");
  fueraDeRangoEl.hidden = true;
  panel.insertBefore(fueraDeRangoEl, lectura);

  return {
    render(vista) {
      const sinCapa = vista.seleccion === null || vista.textos.altura === null;
      alturaEl.textContent = vista.textos.altura ?? "";
      hectareasEl.textContent = vista.textos.hectareas ?? "";
      mostrandoEl.textContent = vista.textos.medicion ?? vista.textos.mostrando ?? "";
      zonasEl.textContent = sinCapa
        ? (vista.textos.sinSeleccion ?? "")
        : `Si el río llega a ${vista.textos.altura ?? ""}, estas zonas podrían inundarse.`;
      slider.disabled = sinCapa;
      if (vista.seleccion !== null) slider.value = String(vista.seleccion);
      slider.setAttribute("aria-valuetext", vista.textos.altura ?? "sin escenario elegido");

      for (const escenario of vista.escenarios) {
        const boton = botones.get(escenario.id);
        if (!boton) continue;
        boton.disabled = !escenario.habilitado;
        const activo = escenario.habilitado && escenario.h === vista.seleccion;
        boton.setAttribute("aria-pressed", String(activo));
      }

      if (vista.textos.fueraDeRango) {
        fueraDeRangoEl.hidden = false;
        fueraDeRangoEl.textContent = `⚠ ${vista.textos.fueraDeRango}`;
      } else {
        fueraDeRangoEl.hidden = true;
        fueraDeRangoEl.textContent = "";
      }
    },
  };
}

function precargarVecinos(index: CapaIndex, cache: CapaCache, entry: CapaEntry): void {
  const i = index.capas.findIndex((c) => c.archivo === entry.archivo);
  if (i === -1) return;
  const antes = index.capas[i - 1];
  const despues = index.capas[i + 1];
  if (antes) void cache.get(antes);
  if (despues) void cache.get(despues);
}

export function createMap(container: HTMLElement): MapaInundacion {
  // Spec 007 M2: el panel de controles vive en un contenedor propio, fuera
  // del lienzo que Leaflet gestiona, para que nunca quede superpuesto sobre
  // la ciudad (antes L.map(container) convertía toda la tarjeta en el mapa,
  // y el panel se dibujaba encima como overlay).
  container.classList.add("mapa-inundacion-root");
  const lienzo = L.DomUtil.create("div", "mapa-inundacion-lienzo", container);
  // Entre el lienzo y el panel plegable a propósito (ítem 3): siempre
  // visible, sin depender de que el usuario abra el panel de controles.
  const resumenWrap = L.DomUtil.create("div", "mapa-inundacion-resumen-wrap", container);
  const panelWrap = L.DomUtil.create("div", "mapa-inundacion-panel-wrap", container);

  const map = L.map(lienzo, { zoomControl: true }).setView(COLON_CENTER, COLON_ZOOM);
  const layers = createBaseLayers();

  layers["Satélite"]?.addTo(map);
  L.control.layers(layers, {}, { position: "topright", collapsed: true }).addTo(map);

  // Rótulo permanente (ítem 9, correcciones de diseño): el punto blanco y
  // azul no decía qué era hasta hacer click.
  L.circleMarker(PUERTO_HIDROMETRO, {
    radius: 7,
    weight: 2,
    color: "#ffffff",
    fillColor: "#1c2430",
    fillOpacity: 1,
  })
    .addTo(map)
    .bindTooltip("Hidrómetro del puerto de Colón", {
      // "left", no "right": el hidrómetro está cerca del borde este de la
      // vista inicial del mapa (verificado a 360 px); con "right" el rótulo
      // se salía del lienzo y quedaba cortado.
      permanent: true,
      direction: "left",
      offset: [-8, 0],
      className: "hidrometro-tooltip",
    })
    .bindPopup("Hidrómetro del puerto de Colón");

  const avisoModelo = new L.Control({ position: "topleft" });
  avisoModelo.onAdd = () => {
    const div = L.DomUtil.create("div", "capas-aviso-modelo");
    div.textContent = "Es un cálculo aproximado hecho con imágenes satelitales. Puede fallar.";
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  avisoModelo.addTo(map);

  let destroyed = false;
  // Suscripciones y listeners globales que hay que soltar en `destroy()`.
  const limpiezas: Array<() => void> = [];
  // Escape cancela el modo elección (C6): la salida estándar para quien lo
  // encendió sin querer, sin tener que encontrar el botón de cancelar.
  function cancelarConEscape(e: KeyboardEvent): void {
    if (e.key === "Escape") setModoEleccionMiCasa(false);
  }
  document.addEventListener("keydown", cancelarConEscape);

  let pendienteActual: MedicionActual | null = null;
  let pendientePronosticado: number | null = null;
  let pendienteSeleccion: number | null = null;
  let pendienteMiCasa: PuntoMapa | null = null;

  // Until (or unless) index.json loads, the public API is a no-op that just
  // remembers the last requested values — spec 005 can call it unconditionally.
  let api: {
    setNivelActual(medicion: MedicionActual): void;
    setNivelPronosticado(h: number): void;
    seleccionar(h: number): void;
    marcarMiCasa(punto: PuntoMapa): void;
    borrarMiCasa(): void;
  } = {
    setNivelActual(medicion) {
      pendienteActual = medicion;
    },
    setNivelPronosticado(h) {
      pendientePronosticado = h;
    },
    seleccionar(h) {
      pendienteSeleccion = h;
    },
    marcarMiCasa(punto) {
      pendienteMiCasa = punto;
    },
    borrarMiCasa() {
      pendienteMiCasa = null;
    },
  };

  void fetchCapaIndex()
    .then((index) => {
      if (destroyed) return;

      const estado = createEstadoMapa(index);
      const cache = createCapaCache();
      emitirIndexListo({ index, cache });
      const resumen = crearResumenSiempreVisible(resumenWrap, index);
      const panel = crearPanel(panelWrap, index, estado);

      // "Mi casa" (spec 015): un único marcador que se remarca en cada click
      // o al restaurar el punto guardado, nunca uno nuevo por click.
      let miCasaMarker: L.CircleMarker | null = null;
      // Cartel del modo elección (C6): dentro del lienzo, sin eventos de
      // puntero, para no comerse el click que justamente está esperando.
      const miCasaHint = L.DomUtil.create("div", "mi-casa-hint", lienzo);
      miCasaHint.setAttribute("role", "status");
      miCasaHint.textContent = "Tocá tu casa en el mapa";
      miCasaHint.hidden = true;

      function marcarMiCasaEnMapa(punto: PuntoMapa): void {
        const latlng: L.LatLngTuple = [punto.lat, punto.lng];
        if (miCasaMarker) {
          miCasaMarker.setLatLng(latlng);
          return;
        }
        miCasaMarker = L.circleMarker(latlng, {
          radius: 9,
          weight: 2,
          color: "#ffffff",
          fillColor: COLOR_MI_CASA,
          fillOpacity: 1,
        })
          .addTo(map)
          .bindTooltip("Mi casa", {
            permanent: true,
            direction: "top",
            offset: [0, -9],
            className: "mi-casa-tooltip",
          })
          .bindPopup("Mi casa");
      }
      function borrarMiCasaDelMapa(): void {
        if (!miCasaMarker) return;
        miCasaMarker.remove();
        miCasaMarker = null;
      }

      const desuscribirModo = suscribirModoEleccion((activo) => {
        miCasaHint.hidden = !activo;
        lienzo.classList.toggle("eligiendo-mi-casa", activo);
      });

      map.on("click", (e: L.LeafletMouseEvent) => {
        // C6: fuera del modo elección, un click en el mapa no marca ni mueve
        // nada. El mapa se navega sin riesgo de perder el punto guardado.
        if (!modoEleccionActivo) return;
        const punto: PuntoMapa = { lat: e.latlng.lat, lng: e.latlng.lng };
        marcarMiCasaEnMapa(punto);
        emitirMiCasaClick(punto);
        // El modo es de un solo uso: marcar lo apaga.
        setModoEleccionMiCasa(false);
      });

      let capaActual: L.GeoJSON | null = null;
      let solicitudId = 0;
      const errorCapa = L.DomUtil.create("div", "capas-error", lienzo);
      errorCapa.setAttribute("role", "status");
      errorCapa.hidden = true;

      estado.subscribe((vista) => {
        resumen.render(vista);
        panel.render(vista);
        if (vista.seleccion === null || vista.resuelto === null) {
          // Nothing chosen yet: leave the map bare instead of drawing a guess.
          if (capaActual) {
            map.removeLayer(capaActual);
            capaActual = null;
          }
          return;
        }
        const resuelto = vista.resuelto;
        emitirSeleccion(vista.seleccion);
        const miSolicitud = ++solicitudId;
        cache
          .get(resuelto.entry)
          .then((coleccion) => {
            if (destroyed || miSolicitud !== solicitudId) return;
            const nuevaCapa = L.geoJSON(coleccion as unknown as Parameters<typeof L.geoJSON>[0], {
              interactive: false,
              style: (feature) => estiloClase(feature?.properties?.clase as unknown),
            });
            nuevaCapa.addTo(map);
            const anterior = capaActual;
            capaActual = nuevaCapa;
            if (anterior) map.removeLayer(anterior);
            errorCapa.hidden = true;
            precargarVecinos(index, cache, resuelto.entry);
          })
          .catch(() => {
            if (destroyed || miSolicitud !== solicitudId) return;
            // Keep the previous layer on screen; the readouts already show the
            // requested level, so say explicitly that the drawing is stale.
            errorCapa.textContent = `No se pudo cargar la capa de ${vista.textos.altura ?? ""}`;
            errorCapa.hidden = false;
          });
      });

      api = {
        setNivelActual: estado.setNivelActual,
        setNivelPronosticado: estado.setNivelPronosticado,
        seleccionar: (h) => estado.seleccionar(h, { porUsuario: true }),
        marcarMiCasa: marcarMiCasaEnMapa,
        borrarMiCasa: borrarMiCasaDelMapa,
      };
      if (pendienteActual !== null) estado.setNivelActual(pendienteActual);
      if (pendientePronosticado !== null) estado.setNivelPronosticado(pendientePronosticado);
      if (pendienteSeleccion !== null) estado.seleccionar(pendienteSeleccion, { porUsuario: true });
      if (pendienteMiCasa !== null) marcarMiCasaEnMapa(pendienteMiCasa);
      limpiezas.push(desuscribirModo);
    })
    .catch(() => {
      if (destroyed) return;
      const div = L.DomUtil.create("div", "capas-error", lienzo);
      div.textContent = "Capas de inundación no disponibles";
    });

  const instancia: MapaInundacion = {
    map,
    setNivelActual(medicion) {
      api.setNivelActual(medicion);
    },
    setNivelPronosticado(h) {
      api.setNivelPronosticado(h);
    },
    seleccionar(h) {
      api.seleccionar(h);
    },
    onSeleccionCambia(listener) {
      return suscribirSeleccion(listener);
    },
    marcarMiCasa(punto) {
      api.marcarMiCasa(punto);
    },
    borrarMiCasa() {
      api.borrarMiCasa();
    },
    onMiCasaClick(listener) {
      return suscribirMiCasaClick(listener);
    },
    destroy() {
      destroyed = true;
      setModoEleccionMiCasa(false);
      document.removeEventListener("keydown", cancelarConEscape);
      for (const limpiar of limpiezas) limpiar();
      limpiezas.length = 0;
      if (ultimaInstancia === instancia) {
        ultimaInstancia = null;
        ultimaSeleccion = null;
      }
      if (window.mapaInundacion === instancia) delete window.mapaInundacion;
      map.remove();
    },
  };

  ultimaInstancia = instancia;
  window.mapaInundacion = instancia;
  return instancia;
}

/** Module-level setters used by spec 005's `mountMapa` (it only sees the module). */
export function setNivelActual(medicion: MedicionActual): void {
  ultimaInstancia?.setNivelActual(medicion);
}

export function setNivelPronosticado(h: number): void {
  ultimaInstancia?.setNivelPronosticado(h);
}

/** Module-level API used by spec 007's `mountSuperficieAfectada` (it only sees the module). */
export function seleccionar(h: number): void {
  ultimaInstancia?.seleccionar(h);
}

export function onSeleccionCambia(listener: (h: number) => void): () => void {
  return suscribirSeleccion(listener);
}

/** Module-level API used by spec 015's `components/miCasa.ts` (it only sees the module). */
export function marcarMiCasa(punto: PuntoMapa): void {
  ultimaInstancia?.marcarMiCasa(punto);
}

export function onMiCasaClick(listener: (punto: PuntoMapa) => void): () => void {
  return suscribirMiCasaClick(listener);
}

export function borrarMiCasa(): void {
  ultimaInstancia?.borrarMiCasa();
}

/** Enciende o apaga el modo elección (spec 015, C6). Lo llama el botón de la tarjeta. */
export function setModoEleccionMiCasa(activo: boolean): void {
  if (modoEleccionActivo === activo) return;
  modoEleccionActivo = activo;
  for (const listener of modoEleccionListeners) listener(activo);
}

export function onModoEleccionMiCasaCambia(listener: (activo: boolean) => void): () => void {
  return suscribirModoEleccion(listener);
}

/** Se dispara (con replay del último valor) en cuanto `index.json` y la `CapaCache` del mapa están listos. */
export function onCapaIndexListo(listener: (ctx: CapaIndexListo) => void): () => void {
  return suscribirIndexListo(listener);
}
