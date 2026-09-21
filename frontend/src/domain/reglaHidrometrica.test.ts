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
});
