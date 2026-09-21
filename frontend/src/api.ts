export interface HealthResponse {
  status: "ok";
  db: "ok" | "error";
}

export type HealthState =
  | { kind: "loading" }
  | { kind: "ready"; health: HealthResponse; checkedAt: Date }
  | { kind: "unreachable"; checkedAt: Date };

/**
 * Resolves the API base URL. An empty VITE_API_URL means "same origin, under /api"
 * (proxied by the Vite dev server and by nginx in the web container).
 */
export function resolveApiUrl(envValue: string | undefined): string {
  const trimmed = (envValue ?? "").trim().replace(/\/+$/, "");
  return trimmed === "" ? "/api" : trimmed;
}

export const API_URL = resolveApiUrl(import.meta.env.VITE_API_URL);

export function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.status === "ok" && (v.db === "ok" || v.db === "error");
}

export async function fetchHealth(
  fetchFn: typeof fetch = fetch,
  baseUrl: string = API_URL,
  now: () => Date = () => new Date(),
): Promise<HealthState> {
  try {
    const response = await fetchFn(`${baseUrl}/health`, { headers: { Accept: "application/json" } });
    if (!response.ok) return { kind: "unreachable", checkedAt: now() };
    const body: unknown = await response.json();
    if (!isHealthResponse(body)) return { kind: "unreachable", checkedAt: now() };
    return { kind: "ready", health: body, checkedAt: now() };
  } catch {
    return { kind: "unreachable", checkedAt: now() };
  }
}
