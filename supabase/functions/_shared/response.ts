// _shared/response.ts

export interface ErrorBody {
  error: {
    code: string;
    message: string;
  };
}

/**
 * Devuelve una respuesta JSON con status y cuerpo tipado.
 */
export function json_response(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Devuelve siempre { error: { code, message } }.
 */
export function error_response(
  code: string,
  message: string,
  status: number,
): Response {
  const body: ErrorBody = { error: { code, message } };
  return json_response(body, status);
}
