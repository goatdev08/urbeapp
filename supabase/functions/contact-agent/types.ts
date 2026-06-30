// supabase/functions/contact-agent/types.ts
// Tipos e interfaces DI para la Edge Function contact-agent.
// Solo interfaces; sin imports de supabase-js (que vive en _shared/clients.ts).
//
// Responsabilidades del skeleton (14.2):
//   - CallerVerifier: JWT obligatorio; 401 si falta o es inválido.
//   - ContactAgentInput: { propertyId: string (UUID) }; 400 si falta o no es UUID.
//   - Subtareas 14.3-14.6 añadirán más deps (property resolver, lead writer, etc.).

// ── Input validado ─────────────────────────────────────────────────────────────

export interface ContactAgentInput {
  propertyId: string; // UUID obligatorio; validado manualmente (sin Zod, ponytail:)
}

// ── CallerVerifier ─────────────────────────────────────────────────────────────
//
// Verifica que el JWT pertenece a un usuario autenticado y devuelve user_id.
// Solo usuarios logueados pueden contactar agentes (RLS también lo exige).
// UNAUTHENTICATED: sin JWT o JWT inválido → 401.

export type CallerVerifyResult =
  | { ok: true; user_id: string }
  | { ok: false; error_code: "UNAUTHENTICATED" };

export interface CallerVerifier {
  verify_caller(authHeader: string | null): Promise<CallerVerifyResult>;
}

// ── Deps inyectables del handler ───────────────────────────────────────────────

export interface ContactAgentDeps {
  callerVerifier: CallerVerifier;
  // 14.3+: propertyResolver, leadWriter, etc. se agregarán progresivamente
}
