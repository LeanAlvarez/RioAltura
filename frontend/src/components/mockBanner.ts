import { USE_MOCKS } from "../env";

export const MOCK_BANNER_TEXTO = "DATOS DE PRUEBA — no son mediciones reales del río";

/**
 * D3 (spec 013): banda fija, de alto contraste y sin botón para cerrarla,
 * visible en todas las pantallas mientras la app corre con mocks. A
 * propósito no se puede cerrar: un aviso que se cierra deja de verse a los
 * cinco minutos, que es exactamente el error que el caso del 22/09
 * demostró (ver spec 013).
 *
 * `container` es el `#mock-banner` de `index.html`, fuera de `#app`, para
 * que quede visible incluso si el resto del montaje falla.
 */
export function mountMockBanner(container: HTMLElement, useMocks: boolean = USE_MOCKS): void {
  if (!useMocks) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  container.hidden = false;
  container.innerHTML = `<p class="mock-banner-texto">${MOCK_BANNER_TEXTO}</p>`;
}
