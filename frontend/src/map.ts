import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Colón, Entre Ríos. See specs/001-infra.md.
export const COLON_CENTER: L.LatLngTuple = [-32.215, -58.145];
export const COLON_ZOOM = 14;

export function createMap(container: HTMLElement): L.Map {
  const map = L.map(container, { zoomControl: true }).setView(COLON_CENTER, COLON_ZOOM);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    subdomains: "abcd",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);

  return map;
}
