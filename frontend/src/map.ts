import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  createCapaCache,
  createEstadoMapa,
  fetchCapaIndex,
  type CapaCache,
  type CapaEntry,
  type CapaIndex,
  type EstadoMapa,
  type VistaMapa,
} from "./capas";

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
  return `Capas generadas el ${fechaGeneradoFormatter.format(fecha)}`;
}

export interface MapaInundacion {
  map: L.Map;
  setNivelActual(h: number): void;
  setNivelPronosticado(h: number): void;
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

interface Panel {
  render(vista: VistaMapa): void;
}

function crearPanel(container: HTMLElement, index: CapaIndex, estado: EstadoMapa): Panel {
  const panel = L.DomUtil.create("div", "capas-panel", container);
  L.DomEvent.disableClickPropagation(panel);
  L.DomEvent.disableScrollPropagation(panel);

  const lectura = L.DomUtil.create("div", "capas-lectura", panel);
  const alturaEl = L.DomUtil.create("strong", "capas-altura", lectura);
  const cotaEl = L.DomUtil.create("span", "capas-cota", lectura);
  const hectareasEl = L.DomUtil.create("span", "capas-hectareas", lectura);
  const mostrandoEl = L.DomUtil.create("span", "capas-mostrando", lectura);

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

  const leyenda = L.DomUtil.create("ul", "capas-leyenda", panel);
  for (const clase of index.clases) {
    const item = L.DomUtil.create(
      "li",
      `capas-leyenda-item capas-leyenda-clase-${String(clase.clase)}`,
      leyenda,
    );
    item.textContent = clase.etiqueta;
  }

  const generadoEl = L.DomUtil.create("p", "capas-generado", panel);
  generadoEl.textContent = formatGenerado(index.generado);

  const fueraDeRangoEl = L.DomUtil.create("div", "capas-fuera-rango", container);
  fueraDeRangoEl.setAttribute("role", "alert");
  fueraDeRangoEl.hidden = true;

  return {
    render(vista) {
      alturaEl.textContent = vista.textos.altura;
      cotaEl.textContent = vista.textos.cota;
      hectareasEl.textContent = vista.textos.hectareas;
      mostrandoEl.textContent = vista.textos.mostrando ?? "";
      slider.value = String(vista.seleccion);
      slider.setAttribute("aria-valuetext", vista.textos.altura);

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
  const map = L.map(container, { zoomControl: true }).setView(COLON_CENTER, COLON_ZOOM);
  const layers = createBaseLayers();

  layers["Satélite"]?.addTo(map);
  L.control.layers(layers, {}, { position: "topright", collapsed: true }).addTo(map);

  L.circleMarker(PUERTO_HIDROMETRO, {
    radius: 7,
    weight: 2,
    color: "#ffffff",
    fillColor: "#1c2430",
    fillOpacity: 1,
  })
    .addTo(map)
    .bindPopup("Hidrómetro del puerto de Colón");

  const avisoModelo = new L.Control({ position: "topleft" });
  avisoModelo.onAdd = () => {
    const div = L.DomUtil.create("div", "capas-aviso-modelo");
    div.textContent = "Modelo simplificado sobre elevación satelital. Orientativo.";
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  avisoModelo.addTo(map);

  let destroyed = false;
  let pendienteActual: number | null = null;
  let pendientePronosticado: number | null = null;

  // Until (or unless) index.json loads, the public API is a no-op that just
  // remembers the last requested values — spec 005 can call it unconditionally.
  let api: { setNivelActual(h: number): void; setNivelPronosticado(h: number): void } = {
    setNivelActual(h) {
      pendienteActual = h;
    },
    setNivelPronosticado(h) {
      pendientePronosticado = h;
    },
  };

  void fetchCapaIndex()
    .then((index) => {
      if (destroyed) return;

      const estado = createEstadoMapa(index);
      const cache = createCapaCache();
      const panel = crearPanel(container, index, estado);

      let capaActual: L.GeoJSON | null = null;
      let solicitudId = 0;
      const errorCapa = L.DomUtil.create("div", "capas-error", container);
      errorCapa.setAttribute("role", "status");
      errorCapa.hidden = true;

      estado.subscribe((vista) => {
        panel.render(vista);
        const miSolicitud = ++solicitudId;
        cache
          .get(vista.resuelto.entry)
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
            precargarVecinos(index, cache, vista.resuelto.entry);
          })
          .catch(() => {
            if (destroyed || miSolicitud !== solicitudId) return;
            // Keep the previous layer on screen; the readouts already show the
            // requested level, so say explicitly that the drawing is stale.
            errorCapa.textContent = `No se pudo cargar la capa de ${vista.textos.altura}`;
            errorCapa.hidden = false;
          });
      });

      api = {
        setNivelActual: estado.setNivelActual,
        setNivelPronosticado: estado.setNivelPronosticado,
      };
      if (pendienteActual !== null) estado.setNivelActual(pendienteActual);
      if (pendientePronosticado !== null) estado.setNivelPronosticado(pendientePronosticado);
    })
    .catch(() => {
      if (destroyed) return;
      const div = L.DomUtil.create("div", "capas-error", container);
      div.textContent = "Capas de inundación no disponibles";
    });

  const instancia: MapaInundacion = {
    map,
    setNivelActual(h) {
      api.setNivelActual(h);
    },
    setNivelPronosticado(h) {
      api.setNivelPronosticado(h);
    },
    destroy() {
      destroyed = true;
      if (ultimaInstancia === instancia) ultimaInstancia = null;
      if (window.mapaInundacion === instancia) delete window.mapaInundacion;
      map.remove();
    },
  };

  ultimaInstancia = instancia;
  window.mapaInundacion = instancia;
  return instancia;
}

/** Module-level setters used by spec 005's `mountMapa` (it only sees the module). */
export function setNivelActual(h: number): void {
  ultimaInstancia?.setNivelActual(h);
}

export function setNivelPronosticado(h: number): void {
  ultimaInstancia?.setNivelPronosticado(h);
}
