// supabase/functions/update-lead-note/types.ts
// Tipos y contratos de DI para la Edge Function update-lead-note.
// Solo interfaces; sin imports de supabase-js (que vive en _shared/clients.ts).
//
// Gemelo de update-lead-status, pero con UNA sola responsabilidad: editar
// internal_notes / is_follow_up sin tocar el status ni validar transiciones.
// El status del lead nunca cambia por esta función.
//
// Separación de responsabilidades:
//   - Handler: parse input, validación en-memoria (lead_id no vacío, note string,
//     is_follow_up boolean, AL MENOS UNO de note/is_follow_up presente).
//   - NoteUpdater: existencia del lead, ownership (agent_id), UPDATE condicional
//     de internal_notes / is_follow_up (spread condicional, mismo patrón que
//     lead_status_updater.ts:66-72 para `note`).

// ── Input validado ────────────────────────────────────────────────────────────
//
// Subtarea 75.6 (§19.7, PRD): note e is_follow_up son AMBOS opcionales, pero
// AL MENOS UNO debe estar presente en el body (validación del handler, no de
// este archivo). note vacío ("") sigue siendo válido y limpia la nota
// (persiste internal_notes = null). is_follow_up=false es una activación
// EXPLÍCITA a "false" (desactivar) — NUNCA debe tratarse como "ausente"
// (bug clásico del spread condicional con `if (value)` en vez de
// `if (value !== undefined)`).
// Contrato viejo (apps v1.0.3 en la calle que solo mandan `note`): sigue
// funcionando exactamente igual, sin tocar is_follow_up.

export interface UpdateLeadNoteInput {
  lead_id: string; // UUID (string no vacío; la DB valida que sea UUID)
  note?: string; // Opcional (75.6); si viene, "" permitido → limpia la nota
  is_follow_up?: boolean; // Opcional (75.6, §19.7): activa/desactiva "en seguimiento"
}

// ── CallerVerifier ────────────────────────────────────────────────────────────
//
// Verifica que el JWT pertenece a un usuario autenticado y devuelve user_id.
// La autorización fina (agent_id del lead) la verifica el NoteUpdater.
// UNAUTHENTICATED: sin JWT o JWT inválido → 401.
// Contrato idéntico al de update-lead-status (mismo _shared/caller_verifier.ts).

export type CallerVerifyResult =
  | { ok: true; user_id: string }
  | { ok: false; error_code: "UNAUTHENTICATED" };

export interface CallerVerifier {
  verify_caller(authHeader: string | null): Promise<CallerVerifyResult>;
}

// ── NoteUpdater ───────────────────────────────────────────────────────────────
//
// Responsabilidades (minimiza round-trips, mismo patrón que LeadStatusUpdater):
//   1. Buscar el lead filtrando por id + agent_id (existencia + ownership juntos).
//   2. Si no encontrado: segunda query sin agent_id para distinguir
//      not-found (LEAD_NOT_FOUND) vs unauthorized (UNAUTHORIZED_AGENT).
//   3. Aplicar UPDATE condicional (75.6): internal_notes solo si note !== undefined
//      (note || null); is_follow_up solo si is_follow_up !== undefined (el valor
//      TAL CUAL, incluido `false` — nunca omitirlo por ser falsy). updated_at
//      siempre. El status NO se toca nunca.
//   4. Retornar el lead actualizado (incluye is_follow_up).
//
// Ownership: SOLO el agente dueño (agent_id = user_id) o admin — consistente con
// private.can_edit_lead (migración 20260604000010). NO incluye is_agency_owner_of:
// los owners de agencia NO editan leads (decisión de producto).
//
// Error codes:
//   LEAD_NOT_FOUND     → handler devuelve 404
//   UNAUTHORIZED_AGENT → handler devuelve 403 (el caller no es agent_id del lead)
//   DB_ERROR           → handler devuelve 500

export interface UpdateLeadNoteParams {
  user_id: string;
  lead_id: string;
  note?: string; // Opcional (75.6) — spread condicional en el UPDATE
  is_follow_up?: boolean; // Opcional (75.6) — spread condicional en el UPDATE
}

export interface UpdatedLead {
  id: string;
  internal_notes: string | null;
  is_follow_up?: boolean; // Presente cuando el updater lo retorna (75.6)
}

export type UpdateLeadNoteResult =
  | { ok: true; lead: UpdatedLead }
  | {
    ok: false;
    error_code: "LEAD_NOT_FOUND" | "UNAUTHORIZED_AGENT" | "DB_ERROR";
    message?: string;
  };

export interface NoteUpdater {
  update(params: UpdateLeadNoteParams): Promise<UpdateLeadNoteResult>;
}

// ── Deps inyectables del handler ──────────────────────────────────────────────

export interface UpdateLeadNoteDeps {
  callerVerifier: CallerVerifier;
  noteUpdater: NoteUpdater;
}
