/** Pie de página: disclaimer y atribuciones obligatorias (CLAUDE.md sección 7). */
export function renderPie(container: HTMLElement): void {
  container.innerHTML = `
    <p class="disclaimer">
      Esta información es orientativa y no reemplaza los avisos oficiales de
      <a href="https://www.argentina.gob.ar/prefecturanaval" rel="noopener" target="_blank">Prefectura Naval Argentina</a>,
      <a href="https://www.caru.org.uy" rel="noopener" target="_blank">CARU</a> ni de Defensa Civil.
    </p>
    <p class="attribution">
      Datos: Google Flood Forecasting (<a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener" target="_blank">CC BY 4.0</a>),
      Copernicus DEM, INA. Mapa: &copy; OpenStreetMap contributors, &copy; CARTO, &copy; Esri.
    </p>
  `;
}
