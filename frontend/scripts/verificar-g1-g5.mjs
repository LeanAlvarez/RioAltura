import { chromium } from "@playwright/test";

const url = process.env.URL ?? "http://localhost:5204/";
const browser = await chromium.launch();

for (const ancho of [360, 768, 1280, 1920]) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: 1000 }, colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  const r = await page.evaluate(() => {
    const out = {};

    // --- G1: regla hidrométrica, desfase tick <-> etiqueta ---
    const regla = document.querySelector(".regla-hidrometrica");
    if (regla) {
      const ticks = [...regla.querySelectorAll(".regla-marca-tick")].map((el) => {
        const b = el.getBoundingClientRect();
        return { clase: el.className, y: +(b.top + b.height / 2).toFixed(1) };
      });
      const textos = [...regla.querySelectorAll(".regla-marca-texto")].map((el) => {
        const b = el.getBoundingClientRect();
        return { texto: el.textContent.trim(), y: +(b.top + b.height / 2).toFixed(1) };
      });
      const barra = regla.getBoundingClientRect();
      const guias = regla.querySelectorAll(".regla-marca-guia").length;
      out.regla = {
        barraTop: +barra.top.toFixed(1),
        barraBottom: +barra.bottom.toFixed(1),
        pares: ticks.map((t, i) => {
          const txt = textos[i];
          return {
            tickY: t.y,
            etiqueta: txt?.texto ?? null,
            etiquetaY: txt?.y ?? null,
            desfase: txt ? +(txt.y - t.y).toFixed(1) : null,
            dentroDeLaBarra: txt ? txt.y >= barra.top - 1 && txt.y <= barra.bottom + 1 : null,
          };
        }),
        cantidadGuias: guias,
      };
    } else {
      out.regla = { error: "no encontrada" };
    }

    // --- G2: panel del mapa abierto ---
    const panel = document.querySelector(".capas-panel");
    out.panelMapaAbierto = panel ? panel.open : null;
    out.panelMapaTexto = document.querySelector(".capas-panel-resumen")?.textContent.trim() ?? null;

    // --- G3: texto siempre visible del mapa ---
    out.mapaMostrando = document.querySelector(".mapa-inundacion-mostrando")?.textContent.trim() ?? null;

    // --- G4: chevrons visibles (contenido generado, no vacío) ---
    const faqChevron = document.querySelector(".faq-pregunta");
    out.faqChevronVisible = faqChevron
      ? getComputedStyle(faqChevron, "::after").content !== "none" &&
        getComputedStyle(faqChevron, "::after").content !== '""'
      : null;
    const detalleChevron = document.querySelector(".detalle-tecnico summary");
    out.detalleTitulo = detalleChevron?.textContent.trim() ?? null;

    // --- G5: marca de máximo observado en la curva ---
    out.maximoObservadoPresente = !!document.querySelector(".superficie-curva-maximo-linea");
    out.superficieTitulo = document.querySelector("#tarjeta-superficie h2")?.textContent.trim() ?? null;

    // --- Blancos: altura de la tarjeta superficie vs su SVG ---
    const tarjetaSuperficie = document.querySelector("#tarjeta-superficie");
    const svgSuperficie = document.querySelector(".superficie-svg");
    if (tarjetaSuperficie && svgSuperficie) {
      out.superficie = {
        tarjetaAlto: +tarjetaSuperficie.getBoundingClientRect().height.toFixed(1),
        svgAlto: +svgSuperficie.getBoundingClientRect().height.toFixed(1),
      };
    }

    // --- Sin scroll horizontal ---
    out.scrollHorizontal = document.body.scrollWidth > window.innerWidth;

    // --- Textos cortados (overflow real, no solo ellipsis intencional) ---
    const candidatos = [".dashboard h2", ".umbral-nombre", ".capas-escenario"];
    const cortados = [];
    for (const sel of candidatos) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).textOverflow !== "ellipsis") {
          cortados.push({ sel, texto: el.textContent.trim().slice(0, 40) });
        }
      }
    }
    out.textosCortadosSinEllipsis = cortados;

    return out;
  });

  console.log(`\n=== ${ancho}px ===`);
  console.log(JSON.stringify(r, null, 2));
  await ctx.close();
}
await browser.close();
