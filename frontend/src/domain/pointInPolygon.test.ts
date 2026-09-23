import { describe, expect, it } from "vitest";
import { pointInPolygon, type Position } from "./pointInPolygon";

// Simple square, [lng, lat]-shaped but the algorithm is coordinate-order
// agnostic: it only cares about [x, y].
const CUADRADO: Position[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
];

const HUECO: Position[] = [
  [3, 3],
  [7, 3],
  [7, 7],
  [3, 7],
  [3, 3],
];

const CUADRADO_LEJANO: Position[] = [
  [20, 20],
  [30, 20],
  [30, 30],
  [20, 30],
  [20, 20],
];

describe("pointInPolygon", () => {
  it("adentro del exterior de un Polygon simple", () => {
    expect(pointInPolygon([5, 1], { type: "Polygon", coordinates: [CUADRADO] })).toBe(true);
  });

  it("afuera del exterior", () => {
    expect(pointInPolygon([15, 15], { type: "Polygon", coordinates: [CUADRADO] })).toBe(false);
  });

  it("un punto dentro de un hueco (anillo interior) da false", () => {
    expect(pointInPolygon([5, 5], { type: "Polygon", coordinates: [CUADRADO, HUECO] })).toBe(false);
  });

  it("adentro del exterior pero afuera del hueco da true", () => {
    expect(pointInPolygon([1, 1], { type: "Polygon", coordinates: [CUADRADO, HUECO] })).toBe(true);
  });

  it("MultiPolygon: true si cae en cualquiera de las partes (OR)", () => {
    const geometry = { type: "MultiPolygon", coordinates: [[CUADRADO], [CUADRADO_LEJANO]] };
    expect(pointInPolygon([5, 5], geometry)).toBe(true);
    expect(pointInPolygon([25, 25], geometry)).toBe(true);
  });

  it("MultiPolygon: false si no cae en ninguna parte", () => {
    const geometry = { type: "MultiPolygon", coordinates: [[CUADRADO], [CUADRADO_LEJANO]] };
    expect(pointInPolygon([50, 50], geometry)).toBe(false);
  });

  it("MultiPolygon respeta los huecos de cada parte", () => {
    const geometry = { type: "MultiPolygon", coordinates: [[CUADRADO, HUECO], [CUADRADO_LEJANO]] };
    expect(pointInPolygon([5, 5], geometry)).toBe(false);
  });

  it("geometría desconocida da false en vez de tirar", () => {
    expect(pointInPolygon([5, 5], { type: "Point", coordinates: [5, 5] })).toBe(false);
  });

  it(
    "punto justo sobre un borde: comportamiento del ray-casting documentado, no 'corregido' " +
      "(ver comentario en pointInPolygon.ts) -- lo que importa es que no tira y da un resultado " +
      "estable, no cuál de los dos booleanos elige",
    () => {
      const resultado = pointInPolygon([10, 5], { type: "Polygon", coordinates: [CUADRADO] });
      expect(typeof resultado).toBe("boolean");
      // Determinístico: mismo punto, mismo polígono, siempre el mismo resultado.
      expect(pointInPolygon([10, 5], { type: "Polygon", coordinates: [CUADRADO] })).toBe(resultado);
    },
  );
});
