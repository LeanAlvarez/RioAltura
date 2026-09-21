import { describe, expect, it } from "vitest";
import {
  calcularTendencia,
  formatCaudal,
  formatDiaCorto,
  formatDiaSemanaFecha,
  formatHaceTiempo,
  formatMetros,
  formatRangoMetros,
  formatTendencia,
  horasDesde,
  parseFechaLocal,
} from "./format";

describe("formatMetros", () => {
  it("usa coma decimal y 2 decimales por defecto", () => {
    expect(formatMetros(3.6789)).toBe("3,68 m");
    expect(formatMetros(7.1)).toBe("7,10 m");
  });

  it("permite elegir la cantidad de decimales", () => {
    expect(formatMetros(4.7, 1)).toBe("4,7 m");
  });
});

describe("formatRangoMetros", () => {
  it("siempre da un rango con 'entre X y Y m', nunca un número exacto", () => {
    const texto = formatRangoMetros(4.7, 6.7);
    expect(texto).toBe("entre 4,7 y 6,7 m");
    expect(texto).toMatch(/^entre .+ y .+ m$/);
  });
});

describe("formatCaudal", () => {
  it("usa separador de miles con punto, sin decimales", () => {
    expect(formatCaudal(12836)).toBe("12.836 m³/s");
  });
});

describe("parseFechaLocal / formatDiaSemanaFecha / formatDiaCorto", () => {
  it("interpreta la fecha como local, sin corrimiento de huso horario", () => {
    const fecha = parseFechaLocal("2026-09-27");
    expect(fecha.getFullYear()).toBe(2026);
    expect(fecha.getMonth()).toBe(8);
    expect(fecha.getDate()).toBe(27);
  });

  it("formatea el día de la semana en español", () => {
    expect(formatDiaSemanaFecha("2026-09-27")).toBe("domingo 27");
  });

  it("formatea una versión corta sin punto final", () => {
    const corto = formatDiaCorto("2026-09-27");
    expect(corto).not.toMatch(/\.$/);
    expect(corto).toContain("27");
  });
});

describe("formatTendencia", () => {
  it("sube / baja / estable según el umbral de 5 cm", () => {
    expect(formatTendencia(0.12)).toBe("Sube 12 cm");
    expect(formatTendencia(-0.05)).toBe("Baja 5 cm");
    expect(formatTendencia(0.03)).toBe("Estable");
    expect(formatTendencia(-0.03)).toBe("Estable");
    expect(formatTendencia(0)).toBe("Estable");
  });

  it("avisa cuando no hay tendencia disponible", () => {
    expect(formatTendencia(null)).toBe("Tendencia no disponible");
  });
});

describe("calcularTendencia", () => {
  it("mapea el delta a sube/baja/estable/null", () => {
    expect(calcularTendencia(0.2)).toBe("sube");
    expect(calcularTendencia(-0.2)).toBe("baja");
    expect(calcularTendencia(0.01)).toBe("estable");
    expect(calcularTendencia(null)).toBeNull();
  });
});

describe("formatHaceTiempo", () => {
  it("elige la unidad según la antigüedad", () => {
    const ahora = new Date("2026-09-21T15:00:00Z");
    expect(formatHaceTiempo(new Date("2026-09-21T14:59:50Z"), ahora)).toBe("hace instantes");
    expect(formatHaceTiempo(new Date("2026-09-21T14:45:00Z"), ahora)).toBe("hace 15 minutos");
    expect(formatHaceTiempo(new Date("2026-09-21T13:00:00Z"), ahora)).toBe("hace 2 horas");
    expect(formatHaceTiempo(new Date("2026-09-18T15:00:00Z"), ahora)).toBe("hace 3 días");
  });
});

describe("horasDesde", () => {
  it("calcula horas transcurridas y nunca da negativo", () => {
    const ahora = new Date("2026-09-21T15:00:00Z");
    expect(horasDesde(new Date("2026-09-21T09:00:00Z"), ahora)).toBe(6);
    expect(horasDesde(new Date("2026-09-21T16:00:00Z"), ahora)).toBe(0);
  });
});
