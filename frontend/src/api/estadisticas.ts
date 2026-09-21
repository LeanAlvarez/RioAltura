import { defaultFetch } from "./fetch-default";
import { fetchJson, type FetchResult } from "./client";
import { isEstadisticas } from "./guards";
import type { Estadisticas } from "./types";

export async function getEstadisticas(
  fetchFn: typeof fetch = defaultFetch,
  baseUrl?: string,
): Promise<FetchResult<Estadisticas>> {
  return fetchJson("/estadisticas", isEstadisticas, fetchFn, baseUrl);
}
