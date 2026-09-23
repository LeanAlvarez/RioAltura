import {
  buildTelegramCanalUrl,
  buildTelegramDeepLink,
  UMBRAL_MAX_M,
  UMBRAL_MIN_M,
  umbralValido,
} from "../domain/telegram";

/**
 * Tarjeta "Avisos por Telegram" (spec 011): el canal público (nivel 1, sin
 * suscripción con datos) y el formulario de umbral propio (nivel 2).
 *
 * El formulario **nunca hace POST a nuestra API**: arma el link
 * `https://t.me/<bot>?start=<umbral>` y lo abre, así que el único dato que
 * llega a nuestra base es el `chat_id` que Telegram le entrega al bot -- acá
 * no vemos ni guardamos nada (ver `domain/telegram.ts` y la respuesta
 * "privacidad" del FAQ).
 *
 * `renderAvisosTelegram` es puro (solo arma el HTML) y está testeado;
 * `mountAvisosTelegram` es la parte que engancha el submit del formulario y
 * abre la ventana de Telegram -- toca `document`/`window` de verdad, mismo
 * criterio que `mountThemeToggle` (`theme.ts`): no tiene test unitario.
 */
export function renderAvisosTelegram(container: HTMLElement): void {
  container.innerHTML = `
    <h2>Avisos por Telegram</h2>
    <p class="card-subtitulo">
      Sumate al canal para enterarte de los cambios de nivel sin abrir esta página, o pedí que te
      avisen a la altura que vos elijas.
    </p>
    <a class="telegram-canal-link" href="${buildTelegramCanalUrl()}" target="_blank" rel="noopener">
      Sumarme al canal público
    </a>
    <form class="telegram-umbral-form" novalidate>
      <label for="telegram-umbral-input">O avisame cuando el río llegue a (metros):</label>
      <div class="telegram-umbral-controles">
        <input
          id="telegram-umbral-input"
          name="umbral"
          type="number"
          inputmode="decimal"
          step="0.01"
          min="${UMBRAL_MIN_M}"
          max="${UMBRAL_MAX_M}"
          placeholder="ej: 4,44"
          required
        />
        <button type="submit">Avisarme en Telegram</button>
      </div>
      <p class="telegram-umbral-error" role="alert" hidden></p>
    </form>
    <p class="card-subtitulo telegram-nota">
      No mandamos nada a nuestro servidor: el botón abre Telegram y es ahí donde se registra tu
      aviso. Te das de baja en cualquier momento mandándole <code>/baja</code> al bot.
    </p>
  `;
}

/**
 * Precarga el input de umbral con una altura ya calculada (spec 015, C4: "Mi
 * casa" enganchado a este formulario). No dispara el submit ni abre
 * Telegram: sólo deja el número listo para que el vecino confirme con un
 * toque. `String(umbralM)` (no `formatMetros`/`formatAltura`, que usan coma):
 * `<input type="number">` sólo acepta el punto decimal como separador.
 */
export function precargarUmbral(container: HTMLElement, umbralM: number): void {
  const input = container.querySelector<HTMLInputElement>("#telegram-umbral-input");
  if (input) input.value = String(umbralM);
}

export function mountAvisosTelegram(container: HTMLElement): void {
  renderAvisosTelegram(container);

  const form = container.querySelector<HTMLFormElement>(".telegram-umbral-form");
  const input = container.querySelector<HTMLInputElement>("#telegram-umbral-input");
  const error = container.querySelector<HTMLParagraphElement>(".telegram-umbral-error");
  if (!form || !input || !error) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const umbralM = Number(input.value.replace(",", "."));

    if (!umbralValido(umbralM)) {
      error.textContent = `Ingresá una altura en metros entre ${UMBRAL_MIN_M} y ${UMBRAL_MAX_M}.`;
      error.hidden = false;
      return;
    }

    error.hidden = true;
    window.open(buildTelegramDeepLink(umbralM), "_blank", "noopener");
  });
}
