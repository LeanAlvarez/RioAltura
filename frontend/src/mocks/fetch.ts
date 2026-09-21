import { mockAlturasDiarias, mockPronostico, mockPronosticoHistorico, mockUltimaAltura } from "./data";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Drop-in replacement for `fetch` that answers the contract endpoints with
 * fixtures from `./data`, keyed only by path (query params are read but the
 * base URL/origin is ignored). Used when `VITE_USE_MOCKS=true`.
 */
export const mockFetch: typeof fetch = async (input) => {
  const url = new URL(String(input), "http://mock.local");
  const { pathname, searchParams } = url;
  const ahora = new Date();

  if (pathname.endsWith("/alturas/ultima")) {
    return jsonResponse(mockUltimaAltura(ahora));
  }

  if (pathname.endsWith("/alturas")) {
    const desde = searchParams.get("desde");
    const hasta = searchParams.get("hasta");
    if (!desde || !hasta) return jsonResponse({ detail: "Faltan parámetros" }, 422);
    return jsonResponse(mockAlturasDiarias(desde, hasta, ahora));
  }

  if (pathname.endsWith("/pronostico/historico")) {
    const desde = searchParams.get("desde");
    const lead = searchParams.get("lead");
    if (!desde || lead === null) return jsonResponse({ detail: "Faltan parámetros" }, 422);
    return jsonResponse(mockPronosticoHistorico(desde, Number(lead), ahora));
  }

  if (pathname.endsWith("/pronostico")) {
    return jsonResponse(mockPronostico(ahora));
  }

  return jsonResponse({ detail: "No encontrado (mock)" }, 404);
};
