import "./style.css";
import { fetchHealth } from "./api";
import { renderHealth } from "./health";
import { createMap } from "./map";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

app.innerHTML = `
  <header class="topbar">
    <h1>Río Uruguay en Colón</h1>
    <div id="health" class="health" role="status" aria-live="polite"></div>
  </header>
  <main id="map" class="map" aria-label="Mapa de Colón"></main>
  <footer class="footer">
    <p class="disclaimer">
      Información orientativa. No reemplaza a los avisos oficiales de
      <a href="https://www.argentina.gob.ar/prefecturanaval" rel="noopener">Prefectura</a>,
      <a href="https://www.caru.org.uy" rel="noopener">CARU</a> ni Defensa Civil.
    </p>
    <p class="attribution">
      Datos: Google Flood Forecasting (CC BY 4.0), Copernicus DEM, INA.
      Mapa: &copy; OpenStreetMap / CARTO, Esri.
    </p>
  </footer>
`;

const healthEl = document.querySelector<HTMLDivElement>("#health");
const mapEl = document.querySelector<HTMLDivElement>("#map");
if (!healthEl || !mapEl) throw new Error("layout elements not found");

createMap(mapEl);

renderHealth(healthEl, { kind: "loading" });
void fetchHealth().then((state) => renderHealth(healthEl, state));
