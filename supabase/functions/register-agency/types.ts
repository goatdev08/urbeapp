// supabase/functions/register-agency/types.ts
// Contrato público (DI) del handler `register-agency` — flujo SEPARADO de alta
// de inmobiliaria por un prospecto YA AUTENTICADO (§4.7, subtarea 71.4).
// Mirror estructural de upgrade-to-agent/types.ts (RPC service_role +
// CallerVerifier local), pero la RPC subyacente es NUEVA:
// register_agency_atomic (migración GREEN, fuera de esta fase RED — ver
// contrato completo en supabase/tests/24_register_agency_test.sql).
//
// Diferencia clave con admin-create-agency (NO se extiende, ver header del
// RPC en supabase/tests/24_register_agency_test.sql):
//   - caller = prospecto (cualquier usuario autenticado), NO admin.
//   - la agencia nace SIEMPRE con status='pending_approval' (nunca 'active').
//   - contact_name/contact_phone/contact_email son OBLIGATORIOS aquí (en
//     admin-create-agency son opcionales) — PRD §4.7 "se capturan datos de
//     empresa (razón social, contacto, logotipo)" en el registro self-service.
//   - NO crea agency_members (sin owner todavía) ni promueve el rol del
//     creador — la activación ocurre en 71.5 (aprobación admin vía estado).
//   - logo_url es OPCIONAL: el cliente lo obtiene aparte vía mint-r2-url
//     (patrón tarea #69) y lo envía ya resuelto; esta EF NO sube el archivo.
//
// ⭐ created_by_user_id SIEMPRE del JWT (nunca del payload) — mismo principio
// que upgrade-to-agent/request-agent-upgrade. Cero superficie de IDOR.

// ── Input validado ────────────────────────────────────────────────────────────

export interface RegisterAgencyInput {
  name: string;
  slug: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  logo_url: string | null; // opcional en el payload; normalizado a null si ausente
}

// ── CallerVerifier ────────────────────────────────────────────────────────────
// Contrato idéntico al de upgrade-to-agent/request-agent-upgrade: cualquier
// usuario autenticado puede llamar (no se restringe por rol).

export type CallerVerifyResult =
  | { ok: true; user_id: string }
  | { ok: false; error_code: "UNAUTHENTICATED" };

export interface CallerVerifier {
  verify_caller(authHeader: string | null): Promise<CallerVerifyResult>;
}

// ── AgencyRegistrar ───────────────────────────────────────────────────────────
// Envuelve la RPC register_agency_atomic (GREEN, fuera de esta fase RED).
// Errores P0001 posibles: CREATED_BY_REQUIRED, FIELDS_INCOMPLETE,
// SLUG_DUPLICATE, NAME_DUPLICATE, USER_NOT_FOUND.

export interface RegisterAgencyAtomicParams {
  name: string;
  slug: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  logo_url: string | null;
  created_by_user_id: string;
}

export interface RegisteredAgency {
  agency_id: string;
  name: string;
  slug: string;
  status: string; // 'pending_approval' siempre en esta EF
  logo_url: string | null;
}

export type RegisterAgencyAtomicResult =
  | { ok: true; agency: RegisteredAgency }
  | { ok: false; error_code: string; message?: string };

export interface AgencyRegistrar {
  register_atomic(
    params: RegisterAgencyAtomicParams,
  ): Promise<RegisterAgencyAtomicResult>;
}

// ── Deps del handler ──────────────────────────────────────────────────────────

export interface RegisterAgencyDeps {
  callerVerifier: CallerVerifier;
  agencyRegistrar: AgencyRegistrar;
}
