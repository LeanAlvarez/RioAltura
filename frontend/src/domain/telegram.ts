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
