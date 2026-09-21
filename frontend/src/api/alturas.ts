import { defaultFetch } from "./fetch-default";
import { fetchJson, type FetchResult } from "./client";
import { isAlturaDiariaList, isUltimaAltura } from "./guards";
import type { AlturaDiaria, UltimaAltura } from "./types";

export async function getUltimaAltura(
  fetchFn: typeof fetch = defaultFetch,
  baseUrl?: string,
): Promise<FetchResult<UltimaAltura>> {
  return fetchJson("/alturas/ultima", isUltimaAltura, fetchFn, baseUrl);
}

export async function getAlturasDiarias(
  desde: string,
  hasta: string,
  fetchFn: typeof fetch = defaultFetch,
  baseUrl?: string,
): Promise<FetchResult<AlturaDiaria[]>> {
  const query = new URLSearchParams({ desde, hasta }).toString();
  return fetchJson(`/alturas?${query}`, isAlturaDiariaList, fetchFn, baseUrl);
}
