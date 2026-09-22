/**
 * `VITE_USE_MOCKS=true` makes the app use the realistic fixtures in `./mocks`
 * instead of hitting the real API. Used for offline development and for
 * looking at the page while specs 002/003's endpoints are not yet wired up
 * to real data.
 *
 * D1 (spec 013): `PROD` always wins, no matter what the variable says or what
 * a stale build cache has embedded. The 2026-09-22 incident wasn't caused by
 * the variable being set in production — it was a dev-mode Vite cache
 * (`node_modules/.vite`) that outlived the run that produced it. `PROD` is a
 * Vite-injected literal, never influenced by that cache, so it's the one
 * thing this can't be fooled by.
 *
 * Kept as a pure function (not read from `import.meta.env` directly here) so
 * it can be unit-tested without needing Vite's env transform — see
 * `env.test.ts`.
 */
export function resolveUseMocks(varValue: string | undefined, isProd: boolean): boolean {
  if (isProd) return false;
  return (varValue ?? "").trim().toLowerCase() === "true";
}

export const USE_MOCKS = resolveUseMocks(import.meta.env.VITE_USE_MOCKS, import.meta.env.PROD);
