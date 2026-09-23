/**
 * Deep link al bot de Telegram para el aviso por umbral propio (spec 011, nivel 2).
 *
 * El bot (`@RioUruguayNotificaBot`) y el canal (`@RioUruguayNotifica`) son
 * públicos, no secretos -- a diferencia de `TELEGRAM_BOT_TOKEN`, pueden vivir
 * acá (CLAUDE.md §6, spec 011).
 *
 * Este formulario NUNCA hace POST a nuestra API: el botón arma un link a
 * Telegram con el umbral codificado (`?start=<centímetros>`), y es Telegram
 * quien le entrega el `chat_id` al bot cuando el vecino lo abre. No vemos ni
 * guardamos nada acá.
 */

export const TELEGRAM_BOT_USERNAME = "RioUruguayNotificaBot";
export const TELEGRAM_CANAL_USERNAME = "RioUruguayNotifica";

/** Igual límite que `worker/jobs/telegram_comandos.py` (`_UMBRAL_MIN_M`/`_UMBRAL_MAX_M`). */
export const UMBRAL_MIN_M = 0.01;
export const UMBRAL_MAX_M = 15;

/**
 * `umbralM` -> centímetros enteros, el único formato que el payload de
 * `/start` puede llevar (Telegram sólo permite `[A-Za-z0-9_-]` ahí, nada de
 * comas ni puntos). `worker/jobs/telegram_comandos.py` (`parse_umbral_deeplink`)
 * hace la conversión inversa.
 */
export function buildTelegramDeepLink(umbralM: number): string {
  const centimetros = Math.round(umbralM * 100);
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${centimetros}`;
}

export function buildTelegramCanalUrl(): string {
  return `https://t.me/${TELEGRAM_CANAL_USERNAME}`;
}

/** Umbral válido para el link (mismo rango que acepta el bot). */
export function umbralValido(umbralM: number): boolean {
  return Number.isFinite(umbralM) && umbralM >= UMBRAL_MIN_M && umbralM <= UMBRAL_MAX_M;
}

/**
 * Pure: por qué ese texto no sirve como umbral, dicho de forma que se
 * entienda qué hacer.
 *
 * "Ingresá una altura entre 0.01 y 15" no le dice nada a alguien que acaba
 * de escribir "712" queriendo decir 7,12 -- que es exactamente lo que pasa
 * en un celular cuando el teclado no ofrece la coma.
 */
export function mensajeUmbralInvalido(crudo: string): string {
  const texto = crudo.trim();
  if (texto === "") return "Escribí la altura del río a la que querés que te avisemos. Ej: 7,12";

  const numero = Number(texto.replace(",", "."));
  if (!Number.isFinite(numero)) {
    return `"${texto}" no es un número. Escribí la altura en metros, ej: 7,12`;
  }
  if (numero > UMBRAL_MAX_M) {
    // El caso real: sin coma en el teclado, 7,12 se escribe "712".
    const conComa = texto.replace(/[.,]/g, "");
    const sugerencia =
      conComa.length >= 3 && /^\d+$/.test(conComa)
        ? ` ¿Quisiste decir ${conComa.slice(0, -2)},${conComa.slice(-2)}?`
        : "";
    return `El río nunca llegó a ${texto} m. Poné una altura de hasta ${String(UMBRAL_MAX_M)} m.${sugerencia}`;
  }
  return `Poné una altura entre ${String(UMBRAL_MIN_M)} y ${String(UMBRAL_MAX_M)} metros. Ej: 7,12`;
}
