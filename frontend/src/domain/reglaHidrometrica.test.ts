import { describe, expect, it } from "vitest";
import {
  buildReglaHidrometricaHtml,
  calcularEscalaRegla,
  deriveReglaHidrometricaView,
  posicionEnEscala,
} from "./reglaHidrometrica";
import { UMBRALES } from "./umbrales";

describe("calcularEscalaRegla", () => {
  it("va de 0,5 m por debajo del mínimo a 0,5 m por encima del máximo umbral", () => {
    const escala = calcularEscalaRegla(UMBRALES, null);
    expect(escala.minM).toBeCloseTo(6.3, 5); // 6,80 - 0,5
    expect(escala.maxM).toBeCloseTo(8.4, 5); // 7,90 + 0,5
  });

  it("amplía la escala hacia abajo cuando la altura de hoy está lejos de los umbrales", () => {
    const escala = calcularEscalaRegla(UMBRALES, 4.29);
    expect(escala.minM).toBeCloseTo(3.79, 5);
    expect(escala.maxM).toBeCloseTo(8.4, 5);
  });

  it("nunca baja de 0 m", () => {
    const escala = calcularEscalaRegla(UMBRALES, 0.1);
    expect(escala.minM).toBe(0);
  });
});

describe("posicionEnEscala", () => {
  const escala = { minM: 0, maxM: 10 };

  it("0 % en el mínimo y 100 % en el máximo", () => {
    expect(posicionEnEscala(0, escala)).toBe(0);
    expect(posicionEnEscala(10, escala)).toBe(100);
  });

  it("interpola linealmente en el medio", () => {
    expect(posicionEnEscala(5, escala)).toBe(50);
  });

  it("nunca se sale de [0, 100] aunque el valor esté fuera de rango", () => {
    expect(posicionEnEscala(-5, escala)).toBe(0);
    expect(posicionEnEscala(15, escala)).toBe(100);
  });
});

describe("deriveReglaHidrometricaView", () => {
  it("posiciona los tres umbrales a escala, en orden ascendente", () => {
    const vista = deriveReglaHidrometricaView(null);
    expect(vista.marcas).toHaveLength(3);
    const posiciones = vista.marcas.map((m) => m.posicionPct);
    expect(posiciones[0]).toBeLessThan(posiciones[1] ?? 0);
    expect(posiciones[1]).toBeLessThan(posiciones[2] ?? 0);
    expect(vista.hoy).toBeNull();
  });

  it("sin altura de hoy, no hay marca de hoy", () => {
    expect(deriveReglaHidrometricaView(null).hoy).toBeNull();
  });

  it("con altura de hoy, agrega la marca con su texto formateado", () => {
    const vista = deriveReglaHidrometricaView(4.29);
    expect(vista.hoy).not.toBeNull();
    expect(vista.hoy?.texto).toBe("4,29 m");
    expect(vista.hoy?.alturaM).toBe(4.29);
  });

  it("separa las etiquetas de texto que quedarían superpuestas, sin mover el tick", () => {
    // Los tres umbrales están a 0,3 y 0,8 m entre sí: a la escala mínima
    // (rango de 2,1 m) las etiquetas de texto quedarían pegadas.
    const vista = deriveReglaHidrometricaView(null);
    const [preventiva, alerta, evacuacion] = vista.marcas;
    expect(preventiva && alerta && evacuacion).toBeTruthy();
    if (!preventiva || !alerta || !evacuacion) return;

    // El tick queda exactamente a escala...
    expect(alerta.posicionPct).toBeGreaterThan(preventiva.posicionPct);
    // ...pero la etiqueta de texto se separa al menos el mínimo.
    expect(alerta.etiquetaPosicionPct - preventiva.etiquetaPosicionPct).toBeGreaterThanOrEqual(22 - 1e-9);
    expect(evacuacion.etiquetaPosicionPct - alerta.etiquetaPosicionPct).toBeGreaterThanOrEqual(22 - 1e-9);
  });

  /**
   * G1 (revisión de diseño, medido en navegador a 1920 px): "Alerta (7,10)"
   * quedaba pegada a la marca de 7,90, y "Evacuación (7,90)" flotaba fuera
   * de la barra. Estos casos cubren exactamente esas condiciones: ninguna
   * etiqueta puede terminar por fuera de [0, 100] (idealmente ni siquiera
   * cerca del borde, ver `MARGEN_BORDE_ETIQUETA_PCT`), para cualquier altura
   * de hoy razonable.
   */
  it.each([null, 0, 0.1, 4.29, 6.8, 6.95, 7.1, 7.5, 7.9, 8.87, 10, 20])(
    "G1: ninguna etiqueta queda fuera de la barra con altura de hoy = %s",
    (alturaHoyM) => {
      const vista = deriveReglaHidrometricaView(alturaHoyM);
      const todas = [...vista.marcas, ...(vista.hoy ? [vista.hoy] : [])];
      for (const m of todas) {
        expect(m.etiquetaPosicionPct).toBeGreaterThanOrEqual(0);
        expect(m.etiquetaPosicionPct).toBeLessThanOrEqual(100);
      }
    },
  );

  it("G1: mantiene el orden y la separación mínima incluso cuando hoy coincide con un umbral", () => {
    // Caso límite: 4 marcas (3 umbrales + hoy) con dos posiciones naturales
    // idénticas, el escenario que más aprieta el algoritmo de separación.
    const vista = deriveReglaHidrometricaView(7.9);
    const posiciones = [...vista.marcas.map((m) => m.etiquetaPosicionPct), vista.hoy?.etiquetaPosicionPct ?? 0].sort(
      (a, b) => a - b,
    );
    for (let i = 1; i < posiciones.length; i++) {
      const actual = posiciones[i];
      const anterior = posiciones[i - 1];
      if (actual === undefined || anterior === undefined) continue;
      expect(actual - anterior).toBeGreaterThanOrEqual(22 - 1e-9);
    }
  });
});

describe("buildReglaHidrometricaHtml", () => {
  it("incluye el texto de cada umbral, nunca solo el color (CLAUDE.md §7)", () => {
    const html = buildReglaHidrometricaHtml(deriveReglaHidrometricaView(7.5));
    expect(html).toContain("6,80 m — Evacuación preventiva");
    expect(html).toContain("7,10 m — Alerta");
    expect(html).toContain("7,90 m — Evacuación");
    expect(html).toContain("Hoy: 7,50 m");
  });

  it("sin altura de hoy no muestra la marca de hoy", () => {
    const html = buildReglaHidrometricaHtml(deriveReglaHidrometricaView(null));
    expect(html).not.toContain("Hoy:");
  });

  it("G1: dibuja una línea guía por cada etiqueta que se desplazó de su tick", () => {
    const vista = deriveReglaHidrometricaView(4.29);
    const html = buildReglaHidrometricaHtml(vista);
    const desplazadas = vista.marcas.filter((m) => Math.abs(m.posicionPct - m.etiquetaPosicionPct) >= 0.5);
    expect(desplazadas.length).toBeGreaterThan(0); // el propio escenario del bug real
    const lineas = html.match(/<line class="regla-marca-guia/g) ?? [];
    expect(lineas.length).toBeGreaterThanOrEqual(desplazadas.length);
  });

  it("G1: no dibuja línea guía cuando la etiqueta no se movió (distancia 0)", () => {
    // Un único umbral, sin hoy: nada que separar, tick y etiqueta coinciden.
    const vista = deriveReglaHidrometricaView(null);
    // Fuerza el caso de una sola marca para aislar "sin desplazamiento".
    const marca = vista.marcas[0];
    if (!marca) throw new Error("se esperaba al menos una marca");
    expect(marca.posicionPct).toBe(marca.etiquetaPosicionPct);
    const html = buildReglaHidrometricaHtml({ escala: vista.escala, marcas: [marca], hoy: null });
    expect(html).not.toContain("regla-marca-guia");
  });
});
