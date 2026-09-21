import "./style.css";
import { fetchHealth } from "./api";
import { getPronostico, getPronosticoAguasArriba } from "./api/pronostico";
import { renderHealth } from "./health";
import { loadDashboardData, nivelActualEstimado, nivelMaximoEstimado } from "./app";
import { deriveEstadoHoyView, renderEstadoHoy } from "./components/estadoHoy";
import { deriveProximosDiasView, renderProximosDias } from "./components/proximosDias";
import { mountGrafico } from "./components/grafico";
import { mountMapa } from "./components/mapa";
import { mountSuperficieAfectada } from "./components/superficieAfectada";
import { mountAguasArriba } from "./components/aguasArriba";
import { mountContexto } from "./components/contexto";
import { mountHistorial } from "./components/historial";
import { mountPrecision } from "./components/precision";
import { mountDetalleTecnico } from "./components/detalleTecnico";
import { renderPie } from "./components/pie";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

// Jerarquía de lectura (CLAUDE.md §7, spec 007): estado de hoy y qué hacer
// arriba, contexto después, detalle técnico al final. El mapa ocupa la
// columna completa de la grilla (ver style.css).
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
    <!--
      Fuera de la tarjeta a propósito (CLAUDE.md §7, spec 007 ítem 1): mountMapa
      controla todo el innerHTML de #tarjeta-mapa (incluido el placeholder de
      fallback), así que un disclaimer adentro se perdería si el mapa no carga.
    -->
    <p class="disclaimer-corta disclaimer-corta--mapa">Orientativo. No reemplaza a Prefectura ni a Defensa Civil.</p>
    <section id="tarjeta-superficie" class="card"></section>
    <section id="tarjeta-aguas-arriba" class="card" aria-live="polite"></section>
    <section id="tarjeta-contexto" class="card" aria-live="polite"></section>
    <section id="tarjeta-historial" class="card card--grafico"></section>
    <section id="tarjeta-precision" class="card"></section>
    <section id="tarjeta-detalle" class="card card--detalle"></section>
  </main>
  <footer class="footer" id="pie"></footer>
`;

const healthEl = document.querySelector<HTMLDivElement>("#health");
const hoyEl = document.querySelector<HTMLElement>("#tarjeta-hoy");
const proximosEl = document.querySelector<HTMLElement>("#tarjeta-proximos");
const graficoEl = document.querySelector<HTMLElement>("#tarjeta-grafico");
const mapaEl = document.querySelector<HTMLElement>("#tarjeta-mapa");
const superficieEl = document.querySelector<HTMLElement>("#tarjeta-superficie");
const aguasArribaEl = document.querySelector<HTMLElement>("#tarjeta-aguas-arriba");
const contextoEl = document.querySelector<HTMLElement>("#tarjeta-contexto");
const historialEl = document.querySelector<HTMLElement>("#tarjeta-historial");
const precisionEl = document.querySelector<HTMLElement>("#tarjeta-precision");
const detalleEl = document.querySelector<HTMLElement>("#tarjeta-detalle");
const pieEl = document.querySelector<HTMLElement>("#pie");
if (
  !healthEl ||
  !hoyEl ||
  !proximosEl ||
  !graficoEl ||
  !mapaEl ||
  !superficieEl ||
  !aguasArribaEl ||
  !contextoEl ||
  !historialEl ||
  !precisionEl ||
  !detalleEl ||
  !pieEl
) {
  throw new Error("layout elements not found");
}

renderHealth(healthEl, { kind: "loading" });
void fetchHealth().then((state) => renderHealth(healthEl, state));

renderEstadoHoy(hoyEl, deriveEstadoHoyView({ kind: "loading" }, new Date()));
renderProximosDias(proximosEl, deriveProximosDiasView({ kind: "loading" }, new Date()));
renderPie(pieEl);
mountGrafico(graficoEl);
mountSuperficieAfectada(superficieEl);
mountAguasArriba(aguasArribaEl);
mountContexto(contextoEl);
mountHistorial(historialEl);
mountPrecision(precisionEl);
mountDetalleTecnico(detalleEl, { getPronostico, getPronosticoAguasArriba });

void loadDashboardData().then(({ altura, pronostico }) => {
  renderEstadoHoy(hoyEl, deriveEstadoHoyView(altura, new Date()));
  renderProximosDias(proximosEl, deriveProximosDiasView(pronostico, new Date()));
  void mountMapa(mapaEl, nivelMaximoEstimado(pronostico), nivelActualEstimado(altura));
});
