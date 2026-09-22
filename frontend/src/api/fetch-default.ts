import { resolveUseMocks } from "../env";
import { mockFetch } from "../mocks/fetch";

/**
 * The real `fetch`, or the mock dispatcher when `VITE_USE_MOCKS=true`.
 *
 * D1 (spec 013): `import.meta.env.PROD` is checked directly in this
 * expression, not through the `USE_MOCKS` re-export — that indirection is
 * what let `mockFetch` (and the whole `../mocks/` fixtures) survive into a
 * "clean" production bundle in the first place (confirmed by inspecting
 * `dist/`: `USE_MOCKS` is a runtime binding from another module, so Rollup
 * can't prove the mock branch unreachable through it). Vite replaces
 * `import.meta.env.PROD` with the literal `true` at build time, which lets
 * Rollup fold this whole ternary to plain `fetch` and drop the unreferenced
 * `../mocks/` import tree entirely — verified in "Cómo verificar" by
 * grepping `dist/`.
 */
export const defaultFetch: typeof fetch = import.meta.env.PROD
  ? fetch
  : resolveUseMocks(import.meta.env.VITE_USE_MOCKS, import.meta.env.PROD)
    ? mockFetch
    : fetch;
