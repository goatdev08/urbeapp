// _shared/cors.ts

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * Maneja la petición OPTIONS (preflight CORS).
 * Devuelve 200 con los headers CORS necesarios.
 */
export function handle_cors_preflight(_req: Request): Response {
  return new Response(null, {
    status: 200,
    headers: CORS_HEADERS,
  });
}
