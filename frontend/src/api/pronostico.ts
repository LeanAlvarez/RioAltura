import { defaultFetch } from "./fetch-default";
import { fetchJson, type FetchResult } from "./client";
import { isHistoricoDiaList, isPronostico } from "./guards";
import type { HistoricoDia, Pronostico } from "./types";

export async function getPronostico(
  fetchFn: typeof fetch = defaultFetch,
  baseUrl?: string,
): Promise<FetchResult<Pronostico>> {
  return fetchJson("/pronostico", isPronostico, fetchFn, baseUrl);
}

export async function getPronosticoHistorico(
  lead: number,
  desde: string,
  fetchFn: typeof fetch = defaultFetch,
  baseUrl?: string,
): Promise<FetchResult<HistoricoDia[]>> {
  const query = new URLSearchParams({ lead: String(lead), desde }).toString();
  return fetchJson(`/pronostico/historico?${query}`, isHistoricoDiaList, fetchFn, baseUrl);
}
