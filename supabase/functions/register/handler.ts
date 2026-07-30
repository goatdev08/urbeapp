// supabase/functions/register/handler.ts
// Handler PURO con dependencias inyectables (DI). No importa supabase-js — eso vive
// en index.ts (entry de producción). Mirror de ../redeem-invitation/handler.ts.
//
// Orquestación: validar payload (§5.1) → deps.authAdmin.createUser (metadata EXACTA
// a lo que lee handle_new_user, email_confirm:true) → deps.registrar.register_atomic
// (RPC 93.1, append-only, se llama UNA sola vez) → 200 { user_id }.
// Si register_atomic falla → compensación deleteUser(user_id); si la compensación
// también falla, el error ORIGINAL de register_atomic sigue subiendo (no se enmascara).
// Todo error de createUser se mapea a un código SANITIZADO — nunca el message/detail
// crudo de Postgres en el body (hueco 2 de la tarea #93).

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import { parse_register_input } from "../_shared/validation.ts";
import type { RegisterDeps } from "./types.ts";

// Mensaje genérico para cualquier fallo de register_atomic (FIELDS_INCOMPLETE,
// NO_ACTIVE_TERMS, NO_ACTIVE_PRIVACY): son errores de configuración/integridad
// del lado del servidor, no algo que el usuario pueda corregir con el mensaje.
const REGISTER_ATOMIC_ERROR_MESSAGE = "No se pudo completar el registro";

/**
 * Mapea el mensaje crudo de admin.createUser a un código de error sanitizado.
 * NUNCA reenvía message tal cual — el mensaje crudo de Postgres puede traer el
 * teléfono/email en conflicto o el nombre del índice/constraint violado.
 */
function map_create_user_error(message: string): Response {
  if (message.includes("already registered")) {
    return error_response(
      "EMAIL_ALREADY_EXISTS",
      "Ya existe una cuenta con este correo",
      409,
    );
  }
  if (message.includes("users_phone_unique_active")) {
    return error_response(
      "PHONE_TAKEN",
      "Ya existe una cuenta con este teléfono",
      409,
    );
  }
  if (message.includes("users_mayoria_de_edad")) {
    return error_response(
      "UNDERAGE",
      "Debes ser mayor de edad para registrarte",
      422,
    );
  }
  return error_response(
    "AUTH_CREATE_FAILED",
    "No se pudo crear la cuenta",
    500,
  );
}

export async function handler(
  req: Request,
  deps?: RegisterDeps,
): Promise<Response> {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return handle_cors_preflight(req);
  }

  // Solo POST permitido
  if (req.method !== "POST") {
    return error_response("METHOD_NOT_ALLOWED", "Método no permitido", 405);
  }

  // Leer body
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error_response(
      "INVALID_INPUT",
      "El cuerpo de la petición no es JSON válido",
      400,
    );
  }

  // Validar payload (§5.1 — todos los campos obligatorios)
  const parsed = parse_register_input(raw);
  if (!parsed.success) {
    return error_response("INVALID_INPUT", parsed.error.message, 400);
  }

  // Sin deps reales (scaffold), devolver 200 con los datos parseados — mismo
  // patrón que redeem-invitation/handler.ts.
  if (deps?.authAdmin === undefined || deps?.registrar === undefined) {
    return json_response({ status: "ok", data: parsed.data }, 200);
  }

  const { authAdmin, registrar } = deps;
  const input = parsed.data;

  // Paso 1: crear usuario en auth.users con la metadata EXACTA que lee
  // handle_new_user (migración 20260727000002). El trigger crea automáticamente
  // la fila espejo en public.users.
  const create_result = await authAdmin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      first_name: input.first_name,
      last_name: input.last_name,
      phone: input.phone,
      date_of_birth: input.date_of_birth,
      state_id: input.state_id,
      municipality_id: input.municipality_id,
    },
  });

  if (create_result.error !== null) {
    return map_create_user_error(create_result.error.message);
  }
  if (create_result.data === null) {
    return error_response(
      "AUTH_CREATE_FAILED",
      "No se pudo crear la cuenta",
      500,
    );
  }

  const user_id = create_result.data.user.id;

  // x-forwarded-for puede ser "cliente, proxy1, proxy2"; register_atomic (inet)
  // solo acepta UNA IP, así que tomamos la primera (el cliente real) recortada.
  const xff = req.headers.get("x-forwarded-for");
  const ip = xff?.split(",")[0].trim() || null;

  // Paso 2: canje atómico vía RPC register_user_atomic (migración 20260729000001,
  // subtarea 93.1). Append-only, NO idempotente — se llama EXACTAMENTE una vez.
  const atomic_result = await registrar.register_atomic({ user_id, ip });

  if (!atomic_result.ok) {
    // Compensación: no hay transacción distribuida entre auth.admin y public.*.
    // Si la RPC falla tras crear el usuario, revertimos el usuario huérfano
    // (best-effort). Si la compensación también falla, el error ORIGINAL de
    // register_atomic sigue subiendo — no se enmascara.
    try {
      await authAdmin.deleteUser(user_id);
    } catch (_e) {
      // Compensación fallida; se ignora para no enmascarar el error original.
    }
    return error_response(
      atomic_result.error_code,
      REGISTER_ATOMIC_ERROR_MESSAGE,
      500,
    );
  }

  return json_response({ user_id }, 200);
}
