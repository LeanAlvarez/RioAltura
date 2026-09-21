/**
 * `VITE_USE_MOCKS=true` makes the app use the realistic fixtures in `./mocks`
 * instead of hitting the real API. Used for offline development and for
 * looking at the page while specs 002/003's endpoints are not yet wired up
 * to real data.
 */
export const USE_MOCKS = (import.meta.env.VITE_USE_MOCKS ?? "").trim().toLowerCase() === "true";
