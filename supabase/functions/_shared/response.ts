// _shared/response.ts — stub mínimo (not_implemented)
// El agente supabase implementará los helpers reales en la fase GREEN.

export interface ErrorBody {
  error: {
    code: string;
    message: string;
  };
}

/**
 * Devuelve una respuesta JSON con status y cuerpo tipado.
 * STUB: lanza para que los tests fallen en rojo.
 */
export function json_response(_body: unknown, _status: number): Response {
  throw new Error("not_implemented");
}

/**
 * Devuelve siempre { error: { code, message } }.
 * STUB: lanza para que los tests fallen en rojo.
 */
export function error_response(
  _code: string,
  _message: string,
  _status: number,
): Response {
  throw new Error("not_implemented");
}
