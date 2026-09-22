import { defaultFetch } from "./fetch-default";
import { fetchJson, type FetchResult } from "./client";
import { isSaltoGrande } from "./guards";
import type { SaltoGrande } from "./types";

export async function getSaltoGrande(
  fetchFn: typeof fetch = defaultFetch,
  baseUrl?: string,
): Promise<FetchResult<SaltoGrande>> {
  return fetchJson("/salto-grande", isSaltoGrande, fetchFn, baseUrl);
}
