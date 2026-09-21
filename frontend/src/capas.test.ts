import { describe, expect, it, vi } from "vitest";
import {
  CapaIndexError,
  SELECCION_INICIAL,
  avisoFueraDeRango,
  createCapaCache,
  createEstadoMapa,
  fetchCapaIndex,
  formatAltura,
  formatCota,
  formatHectareas,
  isCapaIndex,
  resolveNivel,
  textoMostrando,
  type CapaEntry,
  type CapaFeatureCollection,
  type CapaIndex,
  type VistaMapa,
} from "./capas";

/** Mirrors the real generar_capas.py output shape: 0.25 m steps up to 10.50 m,
 * then 0.5 m steps up to 13.00 m (36 layers total, see odd/tasks/006-mapa-inundacion.md). */
function buildIndex(): CapaIndex {
  const capas: CapaEntry[] = [];
  let hectareas = 500;

  function push(h: number): void {
    const codigo = Math.round(h * 100)
      .toString()
      .padStart(4, "0");
    capas.push({
      h,
      archivo: `h_${codigo}.geojson`,
      hectareas,
      bytes: 10_000,
      toca_borde: false,
      bordes: { norte: false, sur: false, oeste: false, este: false },
    });
    hectareas += 20;
  }

  for (let i = 0; i <= 30; i++) {
    push(Math.round((3.0 + i * 0.25) * 100) / 100);
  }
  for (let i = 1; i <= 5; i++) {
    push(Math.round((10.5 + i * 0.5) * 100) / 100);
  }

  return {
    generado: "2026-09-21T18:23:07Z",
    fuente_dem: "Copernicus DEM GLO-30 (test fixture)",
    licencia_dem: "Copernicus DEM (test fixture)",
    cero_ign: -0.26,
    bbox: [-58.25, -32.35, -58.0, -32.1],
    nivel_min: 3.0,
    nivel_max: 13.0,
    paso: { hasta_1050: 0.25, sobre_1050: 0.5 },
    clases: [
      { clase: 1, etiqueta: "hasta 0,5 m" },
      { clase: 2, etiqueta: "0,5 a 1,5 m" },
      { clase: 3, etiqueta: "más de 1,5 m" },
    ],
    capas,
  };
}

const index = buildIndex();

function fakeFc(): CapaFeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { clase: 1, profundidad: "hasta 0,5 m" },
        geometry: { type: "Polygon", coordinates: [] },
      },
    ],
  };
}

describe("isCapaIndex", () => {
  it("acepta un índice válido", () => {
    expect(isCapaIndex(index)).toBe(true);
  });

  it("rechaza formas incompletas o inválidas", () => {
    expect(isCapaIndex(null)).toBe(false);
    expect(isCapaIndex({})).toBe(false);
    expect(isCapaIndex({ ...index, capas: [] })).toBe(false);
    expect(isCapaIndex({ ...index, paso: { hasta_1050: 0.25 } })).toBe(false);
    expect(isCapaIndex({ ...index, capas: [{ h: 3 }] })).toBe(false);
  });
});

describe("fetchCapaIndex", () => {
  it("devuelve el índice cuando la respuesta es válida", async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify(index), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(fetchCapaIndex(fetchFn, "/capas")).resolves.toEqual(index);
    expect(fetchFn).toHaveBeenCalledWith("/capas/index.json", expect.anything());
  });

  it("lanza CapaIndexError ante HTTP error, JSON inválido o forma inválida", async () => {
    const notOk: typeof fetch = async () => new Response("", { status: 500 });
    await expect(fetchCapaIndex(notOk)).rejects.toBeInstanceOf(CapaIndexError);

    const badJson: typeof fetch = async () => new Response("{not json", { status: 200 });
    await expect(fetchCapaIndex(badJson)).rejects.toBeInstanceOf(CapaIndexError);

    const badShape: typeof fetch = async () => new Response(JSON.stringify({ foo: "bar" }), { status: 200 });
    await expect(fetchCapaIndex(badShape)).rejects.toBeInstanceOf(CapaIndexError);
  });
});

describe("createCapaCache", () => {
  it("cachea por archivo y deduplica pedidos concurrentes", async () => {
    let llamadas = 0;
    const fetchFn: typeof fetch = async () => {
      llamadas++;
      return new Response(JSON.stringify(fakeFc()), { status: 200 });
    };
    const cache = createCapaCache(fetchFn, "/capas");
    const entry = index.capas[0];
    if (!entry) throw new Error("fixture sin capas");

    expect(cache.has(entry)).toBe(false);
    const [a, b] = await Promise.all([cache.get(entry), cache.get(entry)]);
    expect(a).toEqual(fakeFc());
    expect(b).toEqual(fakeFc());
    expect(llamadas).toBe(1);
    expect(cache.has(entry)).toBe(true);

    await cache.get(entry);
    expect(llamadas).toBe(1);
  });

  it("propaga el error y no lo deja en caché", async () => {
    const fetchFn: typeof fetch = async () => new Response("", { status: 404 });
    const cache = createCapaCache(fetchFn, "/capas");
    const entry = index.capas[0];
    if (!entry) throw new Error("fixture sin capas");

    await expect(cache.get(entry)).rejects.toThrow();
    expect(cache.has(entry)).toBe(false);
  });
});

describe("resolveNivel", () => {
  it("redondea al escalón disponible más cercano", () => {
    const r = resolveNivel(index, 5.7);
    expect(r.entry.h).toBe(5.75);
    expect(r.mostrado).toBe(5.75);
    expect(r.redondeado).toBe(true);
    expect(r.fueraDeRango).toBeNull();
  });

  it("en el paso de 0,5 sobre 10,50 desempata para arriba", () => {
    const r = resolveNivel(index, 10.75);
    expect(r.entry.h).toBe(11.0);
    expect(r.redondeado).toBe(true);
  });

  it("no redondea cuando el valor pedido coincide con una capa", () => {
    const r = resolveNivel(index, 7.0);
    expect(r.entry.h).toBe(7.0);
    expect(r.redondeado).toBe(false);
  });

  it("por encima del rango usa la capa máxima y marca fueraDeRango arriba", () => {
    const r = resolveNivel(index, 14);
    expect(r.entry.h).toBe(13.0);
    expect(r.mostrado).toBe(13.0);
    expect(r.fueraDeRango).toBe("arriba");
    expect(r.redondeado).toBe(false);
  });

  it("por debajo del rango usa la capa mínima y marca fueraDeRango abajo", () => {
    const r = resolveNivel(index, 2);
    expect(r.entry.h).toBe(3.0);
    expect(r.fueraDeRango).toBe("abajo");
  });

  it("valores no finitos devuelven la capa mínima sin lanzar", () => {
    for (const v of [NaN, Infinity, -Infinity]) {
      const r = resolveNivel(index, v);
      expect(r.entry.h).toBe(3.0);
      expect(r.fueraDeRango).toBeNull();
      expect(r.redondeado).toBe(false);
    }
  });
});

describe("formato es-AR", () => {
  it("formatAltura usa coma decimal", () => {
    expect(formatAltura(4.5)).toBe("4,50 m");
  });

  it("formatCota suma el cero IGN", () => {
    expect(formatCota(4.5, -0.26)).toBe("4,24 m IGN");
  });

  it("formatHectareas agrupa sin decimales", () => {
    expect(formatHectareas(1079.4)).toBe("1.079 ha");
  });

  it("avisoFueraDeRango usa el nivel_max sin decimales", () => {
    expect(avisoFueraDeRango(index)).toBe(
      "Altura por encima del rango modelado (13 m). La inundación real sería mayor.",
    );
  });

  it("textoMostrando solo aparece cuando el valor mostrado difiere del pedido", () => {
    expect(textoMostrando(5.75, 5.7)).toBe("mostrando 5,75 m");
    expect(textoMostrando(7.0, 7.0)).toBeNull();
  });
});

describe("createEstadoMapa", () => {
  it("arranca en la selección inicial (referencia costanera) hasta que llegue un pronóstico", () => {
    const estado = createEstadoMapa(index);
    let vista: VistaMapa | undefined;
    const unsubscribe = estado.subscribe((v) => {
      vista = v;
    });
    expect(vista?.seleccion).toBe(SELECCION_INICIAL);
    unsubscribe();
  });

  it("setNivelPronosticado mueve el mapa mientras el usuario no tocó nada", () => {
    const estado = createEstadoMapa(index);
    const vistas: number[] = [];
    estado.subscribe((v) => vistas.push(v.seleccion));

    estado.setNivelPronosticado(6.2);
    expect(vistas.at(-1)).toBe(6.2);

    estado.setNivelPronosticado(6.5);
    expect(vistas.at(-1)).toBe(6.5);
  });

  it("una vez que el usuario elige, setNivelPronosticado ya no mueve el mapa", () => {
    const estado = createEstadoMapa(index);
    const vistas: number[] = [];
    estado.subscribe((v) => vistas.push(v.seleccion));

    estado.seleccionar(7.1, { porUsuario: true });
    expect(vistas.at(-1)).toBe(7.1);

    estado.setNivelPronosticado(9.0);
    expect(vistas.at(-1)).toBe(7.1);
  });

  it("setNivelActual habilita 'Hoy' pero nunca mueve el mapa por sí solo", () => {
    const estado = createEstadoMapa(index);
    const vistas: Array<ReturnType<typeof estado.escenarios>> = [];
    let seleccionActual = 0;
    estado.subscribe((v) => {
      vistas.push(v.escenarios);
      seleccionActual = v.seleccion;
    });

    expect(seleccionActual).toBe(SELECCION_INICIAL);
    estado.setNivelActual(5.1);
    expect(seleccionActual).toBe(SELECCION_INICIAL);
    const hoy = vistas.at(-1)?.find((e) => e.id === "hoy");
    expect(hoy).toEqual({ id: "hoy", etiqueta: "Hoy", h: 5.1, habilitado: true });
  });

  it("escenarios mantiene el orden fijo y arranca con hoy/pronóstico deshabilitados", () => {
    const estado = createEstadoMapa(index);
    const escenarios = estado.escenarios();
    expect(escenarios.map((e) => e.id)).toEqual([
      "hoy",
      "pronostico",
      "costanera",
      "evacuacion_seco",
      "alerta",
      "crecida_2025",
      "evacuacion",
      "maximo_2024",
    ]);
    expect(escenarios[0]).toEqual({ id: "hoy", etiqueta: "Hoy", h: null, habilitado: false });
    expect(escenarios[1]).toEqual({
      id: "pronostico",
      etiqueta: "Pronóstico máx.",
      h: null,
      habilitado: false,
    });
    expect(escenarios[2]).toEqual({
      id: "costanera",
      etiqueta: "4,44 costanera jul 2026",
      h: 4.44,
      habilitado: true,
    });
  });

  it("el aviso de fuera de rango solo aparece cuando el pedido supera nivel_max", () => {
    const estado = createEstadoMapa(index);
    let ultimaVista: VistaMapa | undefined;
    estado.subscribe((v) => {
      ultimaVista = v;
    });

    estado.seleccionar(14, { porUsuario: true });
    expect(ultimaVista?.textos.fueraDeRango).toBe(avisoFueraDeRango(index));
    expect(ultimaVista?.textos.mostrando).toBeNull();

    estado.seleccionar(2, { porUsuario: true });
    expect(ultimaVista?.textos.fueraDeRango).toBeNull();
  });
});
