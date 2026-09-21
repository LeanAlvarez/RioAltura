import { API_URL } from "../api";

/**
 * Outcome of a request to the API. Every fetch* function below resolves to
 * one of these instead of throwing, so a card can render its own state
 * without an unhandled rejection taking the rest of the page down.
 */
export type FetchResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not-found" }
  | { kind: "unavailable" }
  | { kind: "invalid" }
  | { kind: "error" };

export async function fetchJson<T>(
  path: string,
  isValid: (value: unknown) => value is T,
  fetchFn: typeof fetch,
  baseUrl: string = API_URL,
): Promise<FetchResult<T>> {
  try {
    const response = await fetchFn(`${baseUrl}${path}`, { headers: { Accept: "application/json" } });
    if (response.status === 404) return { kind: "not-found" };
    if (response.status === 503) return { kind: "unavailable" };
    if (response.status === 422) return { kind: "invalid" };
    if (!response.ok) return { kind: "error" };
    const body: unknown = await response.json();
    if (!isValid(body)) return { kind: "error" };
    return { kind: "ok", data: body };
  } catch {
    return { kind: "error" };
  }
}
