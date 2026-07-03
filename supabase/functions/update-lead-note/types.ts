// supabase/functions/update-lead-note/types.ts
// Tipos y contratos de DI para la Edge Function update-lead-note.
// Solo interfaces; sin imports de supabase-js (que vive en _shared/clients.ts).
//
// Gemelo de update-lead-status, pero con UNA sola responsabilidad: editar
// internal_notes sin tocar el status ni validar transiciones. El status del
// lead nunca cambia por esta función.
//
// Separación de responsabilidades:
//   - Handler: parse input, validación en-memoria (lead_id no vacío, note string).
//   - NoteUpdater: existencia del lead, ownership (agent_id), UPDATE de internal_notes.

// ── Input validado ────────────────────────────────────────────────────────────
//
// note es REQUERIDO como string, pero el string vacío ("") es válido y limpia
// la nota (persiste internal_notes = null). Distinguir "falta la key" (→ 400)
// de "string vacío" (→ 200, limpia) es responsabilidad del handler.

export interface UpdateLeadNoteInput {
  lead_id: string; // UUID (string no vacío; la DB valida que sea UUID)
  note: string; // Requerido; "" permitido → limpia la nota (internal_notes = null)
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
//   3. Aplicar UPDATE (internal_notes = note || null, updated_at). El status NO se toca.
//   4. Retornar el lead actualizado.
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
  note: string;
}

export interface UpdatedLead {
  id: string;
  internal_notes: string | null;
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
