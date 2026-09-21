import { USE_MOCKS } from "../env";
import { mockFetch } from "../mocks/fetch";

/** The real `fetch`, or the mock dispatcher when `VITE_USE_MOCKS=true`. */
export const defaultFetch: typeof fetch = USE_MOCKS ? mockFetch : fetch;
