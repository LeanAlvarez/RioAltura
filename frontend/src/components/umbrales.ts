import { formatMetros } from "../format";
import { UMBRALES, umbralAlcanzado, type Umbral } from "../domain/umbrales";

export interface UmbralView {
  nombre: string;
  subtitulo: string | null;
  altura: string;
  explicacion: string;
  /** El río ya llegó o pasó este umbral. */
  alcanzado: boolean;
}

export interface UmbralesView {
  umbrales: UmbralView[];
  /** Frase de encabezado, distinta según si el río alcanzó algún umbral. */
  encabezado: string;
}

function describeUmbral(umbral: Umbral, alturaActualM: number | null): UmbralView {
  return {
    nombre: umbral.nombre,
    subtitulo: umbral.terminoOficial === null ? null : `(${umbral.terminoOficial})`,
    altura: formatMetros(umbral.alturaM),
    explicacion: umbral.explicacion,
    alcanzado: alturaActualM !== null && alturaActualM >= umbral.alturaM,
  };
}

export function deriveUmbralesView(alturaActualM: number | null): UmbralesView {
  const alcanzado = alturaActualM === null ? null : umbralAlcanzado(alturaActualM);
  return {
    umbrales: UMBRALES.map((umbral) => describeUmbral(umbral, alturaActualM)),
    encabezado:
      alcanzado === null
        ? "Hoy el río no llegó a ninguno de estos niveles."
        : `Hoy el río está en el nivel de ${alcanzado.nombre.toLowerCase()}.`,
  };
}

export function renderUmbrales(container: HTMLElement, view: UmbralesView): void {
  const filas = view.umbrales
    .map(
      (u) => `
      <li class="umbral${u.alcanzado ? " umbral--alcanzado" : ""}">
        <p class="umbral-titulo">
          <span class="umbral-altura">${u.altura}</span>
          <span class="umbral-nombre">${u.nombre}</span>
          ${u.subtitulo === null ? "" : `<span class="umbral-subtitulo">${u.subtitulo}</span>`}
          ${u.alcanzado ? '<span class="umbral-marca">alcanzado</span>' : ""}
        </p>
        <p class="umbral-explicacion">${u.explicacion}</p>
      </li>`,
    )
    .join("");

  container.innerHTML = `
    <h2>¿Qué significa cada nivel?</h2>
    <p class="card-subtitulo">${view.encabezado}</p>
    <ul class="umbrales">${filas}</ul>
  `;
}
