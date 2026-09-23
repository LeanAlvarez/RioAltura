import "./style.css";
import { USE_MOCKS } from "./env";
import { mountMockBanner } from "./components/mockBanner";
import { fetchHealth } from "./api";
import { getPronostico, getPronosticoAguasArriba } from "./api/pronostico";
import { renderHealth } from "./health";
import { loadDashboardData, medicionActual, nivelMaximoEstimado } from "./app";
import { deriveEstadoHoyView, renderEstadoHoy } from "./components/estadoHoy";
import { deriveProximosDiasView, renderProximosDias } from "./components/proximosDias";
import { mountGrafico } from "./components/grafico";
import { mountMapa } from "./components/mapa";
import { deriveQueHacerView, renderQueHacer } from "./components/queHacer";
import { deriveUmbralesView, renderUmbrales } from "./components/umbrales";
import { mountSuperficieAfectada } from "./components/superficieAfectada";
import { mountAguasArriba } from "./components/aguasArriba";
import { mountSaltoGrande } from "./components/saltoGrande";
import { mountContexto } from "./components/contexto";
import { mountHistorial } from "./components/historial";
import { mountPrecision } from "./components/precision";
import { mountDetalleTecnico } from "./components/detalleTecnico";
import { mountAvisosTelegram } from "./components/avisosTelegram";
import { mountMiCasa } from "./components/miCasa";
import { mountFaq } from "./components/faq";
import { renderPie } from "./components/pie";
import { mountThemeToggle } from "./theme";
import { montarEstilosPaleta } from "./graficos/paleta";

// D3/D4/D5 (spec 013): si corre con mocks, avisar por los tres lados posibles
// antes de tocar cualquier otra cosa — pantalla, título y consola — para que
// sea imposible confundir datos de prueba con una medición real del río (ver
// spec 013, caso del 22/09).
const mockBannerEl = document.querySelector<HTMLElement>("#mock-banner");
if (!mockBannerEl) throw new Error("#mock-banner not found");
mountMockBanner(mockBannerEl, USE_MOCKS);
if (USE_MOCKS) {
  document.title = `[DATOS DE PRUEBA] ${document.title}`;
  console.warn(
    "[RioAltura] Corriendo con VITE_USE_MOCKS=true: la altura del río mostrada NO es una medición real (spec 013).",
  );
}

// Paleta de gráficos v3 (spec 008, seguimiento): inyecta las custom
// properties `--graf-*` antes de montar ningún gráfico, para que el primer
// render ya las encuentre.
montarEstilosPaleta();

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

// Jerarquía de lectura (CLAUDE.md §7, spec 007): estado de hoy y qué hacer
// arriba, contexto después, detalle técnico al final. El mapa ocupa la
// fila completa de la grilla (ver style.css, L2).
app.innerHTML = `
  <header class="topbar">
    <h1>Río Uruguay en Colón</h1>
    <nav class="topbar-nav">
      <a class="topbar-link" href="#faq">Preguntas frecuentes</a>
      <button type="button" id="theme-toggle" class="theme-toggle" aria-pressed="false"></button>
    </nav>
    <div id="health" class="health" role="status" aria-live="polite"></div>
  </header>
  <main class="dashboard">
    <section id="tarjeta-hoy" class="card" aria-live="polite"></section>
    <section id="tarjeta-proximos" class="card" aria-live="polite"></section>
    <section id="tarjeta-que-hacer" class="card" aria-live="polite" hidden></section>
    <section id="tarjeta-umbrales" class="card"></section>
    <section id="tarjeta-grafico" class="card card--grafico"></section>
    <section id="tarjeta-mapa" class="card card--mapa" aria-label="Mapa de Colón"></section>
    <!--
      Fuera de la tarjeta a propósito (CLAUDE.md §7, spec 007 ítem 1): mountMapa
      controla todo el innerHTML de #tarjeta-mapa (incluido el placeholder de
      fallback), así que un disclaimer adentro se perdería si el mapa no carga.
    -->
    <p class="disclaimer-corta disclaimer-corta--mapa">Orientativo. No reemplaza a Prefectura ni a Defensa Civil.</p>
    <section id="tarjeta-mi-casa" class="card" aria-live="polite"></section>
    <section id="tarjeta-superficie" class="card"></section>
    <section id="tarjeta-aguas-arriba" class="card" aria-live="polite"></section>
    <section id="tarjeta-contexto" class="card" aria-live="polite"></section>
    <section id="tarjeta-salto-grande" class="card" aria-live="polite"></section>
    <section id="tarjeta-historial" class="card card--grafico"></section>
    <section id="tarjeta-precision" class="card"></section>
    <section id="tarjeta-telegram" class="card"></section>
    <section id="faq" class="card card--faq"></section>
    <section id="tarjeta-detalle" class="card card--detalle"></section>
  </main>
  <footer class="footer" id="pie"></footer>
`;

const healthEl = document.querySelector<HTMLDivElement>("#health");
const hoyEl = document.querySelector<HTMLElement>("#tarjeta-hoy");
const proximosEl = document.querySelector<HTMLElement>("#tarjeta-proximos");
const queHacerEl = document.querySelector<HTMLElement>("#tarjeta-que-hacer");
const umbralesEl = document.querySelector<HTMLElement>("#tarjeta-umbrales");
const graficoEl = document.querySelector<HTMLElement>("#tarjeta-grafico");
const mapaEl = document.querySelector<HTMLElement>("#tarjeta-mapa");
const miCasaEl = document.querySelector<HTMLElement>("#tarjeta-mi-casa");
const superficieEl = document.querySelector<HTMLElement>("#tarjeta-superficie");
const aguasArribaEl = document.querySelector<HTMLElement>("#tarjeta-aguas-arriba");
const contextoEl = document.querySelector<HTMLElement>("#tarjeta-contexto");
const saltoGrandeEl = document.querySelector<HTMLElement>("#tarjeta-salto-grande");
const historialEl = document.querySelector<HTMLElement>("#tarjeta-historial");
const precisionEl = document.querySelector<HTMLElement>("#tarjeta-precision");
const telegramEl = document.querySelector<HTMLElement>("#tarjeta-telegram");
const faqEl = document.querySelector<HTMLElement>("#faq");
const detalleEl = document.querySelector<HTMLElement>("#tarjeta-detalle");
const pieEl = document.querySelector<HTMLElement>("#pie");
const themeToggleEl = document.querySelector<HTMLButtonElement>("#theme-toggle");
if (
  !healthEl ||
  !hoyEl ||
  !proximosEl ||
  !queHacerEl ||
  !umbralesEl ||
  !graficoEl ||
  !mapaEl ||
  !miCasaEl ||
  !superficieEl ||
  !aguasArribaEl ||
  !contextoEl ||
  !saltoGrandeEl ||
  !historialEl ||
  !precisionEl ||
  !telegramEl ||
  !faqEl ||
  !detalleEl ||
  !pieEl ||
  !themeToggleEl
) {
  throw new Error("layout elements not found");
}

// T1/T2 (spec 008): toggle de tema en el header, con try/catch adentro de
// theme.ts para que ventana privada / cookies bloqueadas no rompan la página.
mountThemeToggle(themeToggleEl);

renderHealth(healthEl, { kind: "loading" });
void fetchHealth().then((state) => renderHealth(healthEl, state));

renderEstadoHoy(hoyEl, deriveEstadoHoyView({ kind: "loading" }, new Date()));
renderProximosDias(proximosEl, deriveProximosDiasView({ kind: "loading" }, new Date()));
renderUmbrales(umbralesEl, deriveUmbralesView(null));
renderQueHacer(queHacerEl, null);
renderPie(pieEl);
mountGrafico(graficoEl);
mountSuperficieAfectada(superficieEl);
mountAguasArriba(aguasArribaEl);
mountContexto(contextoEl);
mountSaltoGrande(saltoGrandeEl);
mountHistorial(historialEl);
mountPrecision(precisionEl);
mountAvisosTelegram(telegramEl);
mountMiCasa(miCasaEl, telegramEl);
mountFaq(faqEl);
mountDetalleTecnico(detalleEl, { getPronostico, getPronosticoAguasArriba });

void loadDashboardData().then(({ altura, pronostico }) => {
  renderEstadoHoy(hoyEl, deriveEstadoHoyView(altura, new Date()));
  renderProximosDias(proximosEl, deriveProximosDiasView(pronostico, new Date()));
  renderUmbrales(umbralesEl, deriveUmbralesView(altura.kind === "ok" ? altura.data.altura_m : null));
  renderQueHacer(
    queHacerEl,
    pronostico.kind === "ok" ? deriveQueHacerView(pronostico.data.aviso.nivel) : null,
  );
  void mountMapa(mapaEl, nivelMaximoEstimado(pronostico), medicionActual(altura));
});
