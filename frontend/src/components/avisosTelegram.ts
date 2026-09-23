import { buildTelegramCanalUrl, buildTelegramDeepLink, mensajeUmbralInvalido, umbralValido } from "../domain/telegram";

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
        <!--
          type="text" y NO type="number", a propósito (spec 021). Con
          type="number" el navegador descarta la coma en silencio si su
          locale usa punto -- y cuando el valor no le parece válido,
          \`input.value\` devuelve CADENA VACÍA. En un celular eso daba:
          escribís "7,12", no ves nada raro, y la app te dice que es
          inválido. \`inputmode="decimal"\` sigue mostrando el teclado
          numérico; leer el texto crudo nos deja aceptar coma Y punto.
        -->
        <input
          id="telegram-umbral-input"
          name="umbral"
          type="text"
          inputmode="decimal"
          autocomplete="off"
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
    const crudo = input.value.trim();
    const umbralM = Number(crudo.replace(",", "."));

    if (!umbralValido(umbralM)) {
      error.textContent = mensajeUmbralInvalido(crudo);
      error.hidden = false;
      return;
    }

    error.hidden = true;
    window.open(buildTelegramDeepLink(umbralM), "_blank", "noopener");
  });
}
