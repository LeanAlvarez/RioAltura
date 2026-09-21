import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Colón, Entre Ríos. See specs/001-infra.md.
export const COLON_CENTER: L.LatLngTuple = [-32.215, -58.145];
export const COLON_ZOOM = 14;

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

export function createMap(container: HTMLElement): L.Map {
  const map = L.map(container, { zoomControl: true }).setView(COLON_CENTER, COLON_ZOOM);
  const layers = createBaseLayers();

  layers["Satélite"]?.addTo(map);
  L.control.layers(layers, {}, { position: "topright", collapsed: true }).addTo(map);

  return map;
}
