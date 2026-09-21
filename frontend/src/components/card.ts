/** Shared chrome for the page's cards: title, skeleton and error rendering. */

export function renderCardSkeleton(container: HTMLElement, titulo: string): void {
  container.innerHTML = `
    <h2>${titulo}</h2>
    <div class="skeleton" role="status" aria-label="Cargando ${titulo}">
      <div class="skeleton-line skeleton-line--wide"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line skeleton-line--short"></div>
    </div>
  `;
}

export function renderCardError(container: HTMLElement, titulo: string, mensaje: string): void {
  container.innerHTML = `
    <h2>${titulo}</h2>
    <p class="card-error" role="alert">${mensaje}</p>
  `;
}
