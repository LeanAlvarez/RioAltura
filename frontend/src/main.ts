import "./style.css";
import { fetchHealth } from "./api";
import { renderHealth } from "./health";
import { loadDashboardData, nivelMaximoEstimado } from "./app";
import { deriveEstadoHoyView, renderEstadoHoy } from "./components/estadoHoy";
import { deriveProximosDiasView, renderProximosDias } from "./components/proximosDias";
import { mountGrafico } from "./components/grafico";
import { mountMapa } from "./components/mapa";
import { renderPie } from "./components/pie";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

app.innerHTML = `
  <header class="topbar">
    <h1>Río Uruguay en Colón</h1>
    <div id="health" class="health" role="status" aria-live="polite"></div>
  </header>
  <main class="dashboard">
    <section id="tarjeta-hoy" class="card" aria-live="polite"></section>
    <section id="tarjeta-proximos" class="card" aria-live="polite"></section>
    <section id="tarjeta-grafico" class="card card--grafico"></section>
    <section id="tarjeta-mapa" class="card card--mapa" aria-label="Mapa de Colón"></section>
  </main>
  <footer class="footer" id="pie"></footer>
`;

const healthEl = document.querySelector<HTMLDivElement>("#health");
const hoyEl = document.querySelector<HTMLElement>("#tarjeta-hoy");
const proximosEl = document.querySelector<HTMLElement>("#tarjeta-proximos");
const graficoEl = document.querySelector<HTMLElement>("#tarjeta-grafico");
const mapaEl = document.querySelector<HTMLElement>("#tarjeta-mapa");
const pieEl = document.querySelector<HTMLElement>("#pie");
if (!healthEl || !hoyEl || !proximosEl || !graficoEl || !mapaEl || !pieEl) {
  throw new Error("layout elements not found");
}

renderHealth(healthEl, { kind: "loading" });
void fetchHealth().then((state) => renderHealth(healthEl, state));

renderEstadoHoy(hoyEl, deriveEstadoHoyView({ kind: "loading" }, new Date()));
renderProximosDias(proximosEl, deriveProximosDiasView({ kind: "loading" }));
renderPie(pieEl);
mountGrafico(graficoEl);

void loadDashboardData().then(({ altura, pronostico }) => {
  renderEstadoHoy(hoyEl, deriveEstadoHoyView(altura, new Date()));
  renderProximosDias(proximosEl, deriveProximosDiasView(pronostico));
  void mountMapa(mapaEl, nivelMaximoEstimado(pronostico));
});
