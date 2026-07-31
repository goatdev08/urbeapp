// supabase/functions/register/types.ts
// Contrato público (DI) del handler `register` — fase RED subtarea 93.2.
// Espeja el patrón de redeem-invitation (ver ../redeem-invitation/handler.ts y
// ../_shared/{auth_user.ts,redeem.ts}): el handler es PURO (sin supabase-js); las
// implementaciones reales se construyen en ../_shared/clients.ts y se inyectan
// desde index.ts. Los tests inyectan fakes que implementan estas mismas interfaces.

/**
 * Metadata EXACTA que lee `handle_new_user` (migración
 * 20260727000002_registro_constraints.sql) desde `raw_user_meta_data`.
 * Un typo en cualquiera de estas claves reproduce el hueco 1 documentado en la
 * tarea #93: el campo se guarda NULL en silencio y 93.1 lo caza recién en la
 * RPC (FIELDS_INCOMPLETE), no aquí.
 */
export interface RegisterUserMetadata {
  first_name: string;
  last_name: string;
  phone: string;
  date_of_birth: string; // YYYY-MM-DD
  state_id: string; // 2 dígitos, catálogo INEGI mx_states
  municipality_id: string; // 5 dígitos (cvegeo), catálogo INEGI mx_municipalities
}

export interface CreateUserParams {
  email: string;
  password: string;
  email_confirm: boolean;
  user_metadata: RegisterUserMetadata;
}

/**
 * Respuesta cruda de `admin.createUser` (subconjunto mínimo, mismo shape que
 * ../_shared/auth_user.ts AdminCreateUserResponse). `error.message` NUNCA trae
 * el detalle crudo de Postgres para violaciones de constraint del trigger
 * `handle_new_user` (teléfono duplicado, menor de edad): GoTrue las colapsa
 * SIEMPRE en "Database error creating new user" (evidencia empírica del
 * guardián contra el stack local) — el nombre del índice/constraint JAMÁS
 * llega aquí. `error.code` (versiones nuevas de GoTrue) puede traer un código
 * corto como "email_exists" — el handler debe reconocer AMBAS señales (code
 * y variantes de `message`) para email duplicado.
 */
export interface CreateUserResponse {
  data: { user: { id: string } } | null;
  error: { message: string; code?: string } | null;
}

export interface RegisterAuthAdmin {
  createUser(params: CreateUserParams): Promise<CreateUserResponse>;
  deleteUser(user_id: string): Promise<void>;
}

export interface RegisterAtomicParams {
  user_id: string;
  ip: string | null;
}

/** Resultado de la RPC register_user_atomic (migración 20260729000001, subtarea 93.1). */
export type RegisterAtomicResult =
  | { ok: true }
  | { ok: false; error_code: string; message?: string };

/** Envuelve la RPC register_user_atomic — SOLO service_role, NO idempotente (append-only). */
export interface RegisterAtomicRunner {
  register_atomic(params: RegisterAtomicParams): Promise<RegisterAtomicResult>;
}

/** Payload público §5.1 — TODOS los campos son obligatorios (PRD-MVP-demo §5.1). */
export interface RegisterInput {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone: string; // ya viene E.164 +52 del cliente; el handler valida el formato igual
  date_of_birth: string; // YYYY-MM-DD
  state_id: string; // 2 dígitos
  municipality_id: string; // 5 dígitos, prefijo = state_id (coherencia cvegeo)
}

/**
 * Dependencias inyectables del handler (DI pattern, mirror de RedeemDeps en
 * ../redeem-invitation/handler.ts). Opcionales: en producción se construyen a
 * partir del cliente Supabase real (service_role); en tests se inyectan fakes.
 *
 * `phone_exists` (renegociación 2026-07-30, hallazgo del guardián): GoTrue
 * SIEMPRE colapsa la violación del índice parcial `users_phone_unique_active`
 * en un 500 genérico "Database error creating new user" — el handler NO puede
 * distinguir "teléfono duplicado" de esa respuesta. Por eso el chequeo se hace
 * ANTES de createUser, con un SELECT propio (service_role) contra
 * public.users que replica la semántica del índice (solo cuentas activas,
 * `deleted_at IS NULL`). La carrera residual (dos registros simultáneos con
 * el mismo teléfono) cae en createUser fallando con el 500 genérico
 * AUTH_CREATE_FAILED — sin fuga, el CHECK/índice de la DB es el backstop.
 */
export interface RegisterDeps {
  authAdmin?: RegisterAuthAdmin;
  registrar?: RegisterAtomicRunner;
  phone_exists?: (phone: string) => Promise<boolean>;
}
