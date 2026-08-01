// supabase/functions/register/handler.ts
// Handler PURO con dependencias inyectables (DI). No importa supabase-js — eso vive
// en index.ts (entry de producción). Mirror de ../redeem-invitation/handler.ts.
//
// RENEGOCIACIÓN 2026-07-30 (hallazgo del guardián contra el stack local con deps
// REALES): GoTrue NUNCA expone el nombre del índice/constraint violado por el
// trigger handle_new_user — colapsa teléfono duplicado y menor de edad en el
// MISMO mensaje genérico "Database error creating new user". Por eso:
//   - UNDERAGE se calcula en el handler ANTES de tocar createUser (edad >= 18
//     años AL DÍA DE HOY, boundary UTC inclusive — mismo criterio que el CHECK
//     users_mayoria_de_edad).
//   - PHONE_TAKEN se resuelve con un pre-check `deps.phone_exists(phone)` ANTES
//     de createUser (semántica del índice parcial users_phone_unique_active).
//     La carrera residual cae en el 500 genérico AUTH_CREATE_FAILED — sin fuga,
//     el índice de la DB es el backstop real.
//   - EMAIL_ALREADY_EXISTS reconoce error.code === "email_exists" O mensajes
//     que contengan "already been registered" / "already registered".
//
// Orquestación: validar payload (§5.1) → UNDERAGE → phone_exists → createUser
// (metadata EXACTA a lo que lee handle_new_user, email_confirm:false — 72.3:
// el usuario queda sin confirmar; el CLIENTE dispara el correo de verificación
// vía auth.resend post-registro, porque admin.createUser NO envía correo
// automático. GoTrue rechazará el login hasta que confirme) →
// register_atomic (RPC 93.1, append-only, UNA sola vez) → 200 { user_id }.
// Si register_atomic falla → compensación deleteUser(user_id); si la
// compensación también falla, se registra con console.error (sin enmascarar)
// y el error ORIGINAL de register_atomic sigue subiendo.
// Cualquier dependencia que LANCE (en vez de devolver {error}) se atrapa en un
// catch global → 500 con mensaje ESTÁTICO, nunca el texto de la excepción.

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import { parse_register_input } from "../_shared/validation.ts";
import type {
  RegisterAtomicResult,
  RegisterAuthAdmin,
  RegisterDeps,
} from "./types.ts";

// Mensaje genérico para cualquier fallo de register_atomic (FIELDS_INCOMPLETE,
// NO_ACTIVE_TERMS, NO_ACTIVE_PRIVACY): son errores de configuración/integridad
// del lado del servidor, no algo que el usuario pueda corregir con el mensaje.
const REGISTER_ATOMIC_ERROR_MESSAGE = "No se pudo completar el registro";

/**
 * Compensación best-effort: revierte el usuario huérfano de auth.users cuando
 * register_atomic falla (o lanza) DESPUÉS de que createUser ya lo creó. No hay
 * transacción distribuida entre auth.admin y public.*. Si la compensación
 * también falla, se registra con console.error (O2) — sin enmascarar el error
 * original, que sigue subiendo igual.
 */
async function compensate_delete_user(
  authAdmin: RegisterAuthAdmin,
  user_id: string,
  context: string,
): Promise<void> {
  try {
    await authAdmin.deleteUser(user_id);
  } catch (delete_error) {
    console.error(`register: compensación deleteUser falló (${context})`, {
      user_id,
      delete_error,
    });
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * "Al menos 18 años HOY" — mismo criterio que el CHECK users_mayoria_de_edad
 * (migración 20260727000002_registro_constraints.sql): date_of_birth <=
 * hoy - 18 años. Comparación lexicográfica de strings YYYY-MM-DD (ya validados
 * por parse_register_input), equivalente a comparar fechas por ser ISO 8601 de
 * ancho fijo. Calculado en UTC para que el boundary sea determinista.
 */
function is_at_least_18(date_of_birth: string): boolean {
  const now = new Date();
  const cutoff = `${now.getUTCFullYear() - 18}-${pad2(now.getUTCMonth() + 1)}-${
    pad2(now.getUTCDate())
  }`;
  return date_of_birth <= cutoff;
}

/**
 * Mapea el error de admin.createUser a un código sanitizado. GoTrue real:
 * email duplicado → code "email_exists" y/o message con "already (been )
 * registered"; CUALQUIER otra violación del trigger handle_new_user (teléfono
 * duplicado, menor de edad) → SIEMPRE "Database error creating new user", sin
 * el nombre del índice/constraint — por eso esas dos ramas ya NO se buscan
 * aquí (código muerto eliminado, ver PHONE_TAKEN/UNDERAGE arriba en el flujo).
 */
function map_create_user_error(
  error: { message: string; code?: string },
): Response {
  if (
    error.code === "email_exists" ||
    error.message.includes("already been registered") ||
    error.message.includes("already registered")
  ) {
    return error_response(
      "EMAIL_ALREADY_EXISTS",
      "Ya existe una cuenta con este correo",
      409,
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

  // Sin deps reales (scaffold): NUNCA reflejar el password ni el payload
  // completo en la respuesta (O1) — a diferencia de redeem-invitation, aquí
  // NO se ecoa `parsed.data` (trae password).
  if (deps?.authAdmin === undefined || deps?.registrar === undefined) {
    return json_response({ status: "ok" }, 200);
  }

  const { authAdmin, registrar, phone_exists } = deps;
  const input = parsed.data;

  // UNDERAGE: se calcula ANTES de tocar createUser — GoTrue nunca expone el
  // CHECK users_mayoria_de_edad violado (colapsa en un 500 genérico).
  if (!is_at_least_18(input.date_of_birth)) {
    return error_response(
      "UNDERAGE",
      "Debes ser mayor de edad para registrarte",
      422,
    );
  }

  // Catch global: cualquier dependencia (phone_exists, createUser,
  // register_atomic) que LANCE en vez de resolver/devolver {error} termina
  // aquí — 500 con mensaje ESTÁTICO, nunca el texto de la excepción.
  try {
    // PHONE_TAKEN: pre-check ANTES de createUser (GoTrue nunca expone el
    // índice users_phone_unique_active violado). Dep opcional: sin ella se
    // omite el pre-check y la carrera cae en el 500 genérico de createUser.
    if (phone_exists !== undefined && await phone_exists(input.phone)) {
      return error_response(
        "PHONE_TAKEN",
        "Ya existe una cuenta con este teléfono",
        409,
      );
    }

    // Crear usuario en auth.users con la metadata EXACTA que lee
    // handle_new_user (migración 20260727000002). El trigger crea
    // automáticamente la fila espejo en public.users.
    const create_result = await authAdmin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: false,
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
      return map_create_user_error(create_result.error);
    }
    if (create_result.data === null) {
      return error_response(
        "AUTH_CREATE_FAILED",
        "No se pudo crear la cuenta",
        500,
      );
    }

    const user_id = create_result.data.user.id;

    // x-forwarded-for puede ser "cliente, proxy1, proxy2"; register_atomic
    // (inet) solo acepta UNA IP, así que tomamos la primera (el cliente real)
    // recortada.
    const xff = req.headers.get("x-forwarded-for");
    const ip = xff?.split(",")[0].trim() || null;

    // Canje atómico vía RPC register_user_atomic (migración 20260729000001,
    // subtarea 93.1). Append-only, NO idempotente — se llama EXACTAMENTE una vez.
    // Envuelto en su propio try: si LANZA (no devuelve {ok:false}) el usuario
    // ya quedó creado en auth.users, así que la compensación debe correr
    // igual (N1) — el catch global de más abajo NO compensa, solo responde.
    let atomic_result: RegisterAtomicResult;
    try {
      atomic_result = await registrar.register_atomic({ user_id, ip });
    } catch (atomic_error) {
      await compensate_delete_user(
        authAdmin,
        user_id,
        "register_atomic lanzó una excepción",
      );
      console.error(
        "register: register_atomic lanzó una excepción inesperada",
        { user_id, atomic_error },
      );
      return error_response(
        "INTERNAL_ERROR",
        REGISTER_ATOMIC_ERROR_MESSAGE,
        500,
      );
    }

    if (!atomic_result.ok) {
      await compensate_delete_user(
        authAdmin,
        user_id,
        "register_atomic falló",
      );
      return error_response(
        atomic_result.error_code,
        REGISTER_ATOMIC_ERROR_MESSAGE,
        500,
      );
    }

    return json_response({ user_id }, 200);
  } catch (e) {
    // Cualquier otra dependencia (phone_exists, createUser) que LANCE en vez
    // de resolver/devolver {error} termina aquí — se registra con
    // console.error (N2) y se responde 500 estático, nunca el texto crudo.
    console.error("register: excepción inesperada en el flujo", e);
    return error_response(
      "INTERNAL_ERROR",
      "No se pudo completar el registro",
      500,
    );
  }
}
