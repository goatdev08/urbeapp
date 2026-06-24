// _shared/cors.ts — stub mínimo (not_implemented)
// El agente supabase implementará los headers reales en la fase GREEN.

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * Maneja la petición OPTIONS (preflight CORS).
 * STUB: lanza para que los tests fallen en rojo.
 */
export function handle_cors_preflight(_req: Request): Response {
  throw new Error("not_implemented");
}
