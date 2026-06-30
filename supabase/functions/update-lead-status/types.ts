// supabase/functions/update-lead-status/types.ts
// Tipos y contratos de DI para la Edge Function update-lead-status.
// Solo interfaces; sin imports de supabase-js (que vive en _shared/clients.ts).
//
// Separación de responsabilidades:
//   - Handler: parse input, validación en-memoria (lead_id, new_status enum).
//   - LeadStatusUpdater: existencia del lead, ownership (agent_id), transición, UPDATE.

// ── Enum del dominio — valores reales de lead_status (migración 0001) ─────────
//
// Fuente de verdad: create type lead_status as enum
//   ('new', 'contacted', 'in_progress', 'visit_scheduled', 'closed_won', 'closed_lost', 'discarded')
// ⚠️ Los valores 'qualified', 'visit_done', 'negotiation', 'closed' NO existen en el schema.

export type LeadStatusEnum =
  | "new"
  | "contacted"
  | "in_progress"
  | "visit_scheduled"
  | "closed_won"
  | "closed_lost"
  | "discarded";

// ── Input validado ────────────────────────────────────────────────────────────

export interface UpdateLeadStatusInput {
  lead_id: string;       // UUID (string no vacío; la DB valida que sea UUID)
  new_status: LeadStatusEnum;
  note?: string;         // Opcional; si presente → se persiste en internal_notes
}

// ── CallerVerifier ────────────────────────────────────────────────────────────
//
// Verifica que el JWT pertenece a un usuario autenticado y devuelve user_id.
// La autorización fina (agent_id del lead) la verifica el LeadStatusUpdater.
// UNAUTHENTICATED: sin JWT o JWT inválido → 401.

export type CallerVerifyResult =
  | { ok: true; user_id: string }
  | { ok: false; error_code: "UNAUTHENTICATED" };

export interface CallerVerifier {
  verify_caller(authHeader: string | null): Promise<CallerVerifyResult>;
}

// ── LeadStatusUpdater ─────────────────────────────────────────────────────────
//
// Responsabilidades (minimiza round-trips):
//   1. Buscar el lead filtrando por id + agent_id (existencia + ownership juntos).
//   2. Si no encontrado: segunda query sin agent_id para distinguir not-found vs unauthorized.
//   3. Validar transición de estado (VALID_TRANSITIONS vs current status en DB).
//   4. Aplicar UPDATE (status, updated_at, internal_notes si note presente).
//   5. Retornar el lead actualizado.
//
// Transiciones válidas (tabla VALID_TRANSITIONS en lead_status_updater.ts):
//   new            → contacted, discarded
//   contacted      → in_progress, closed_lost, discarded
//   in_progress    → visit_scheduled, closed_won, closed_lost, discarded
//   visit_scheduled→ in_progress, closed_won, closed_lost, discarded
//   closed_won     → [] (terminal)
//   closed_lost    → [] (terminal)
//   discarded      → [] (terminal)
//
// Error codes:
//   LEAD_NOT_FOUND     → handler devuelve 404
//   UNAUTHORIZED_AGENT → handler devuelve 403 (el caller no es agent_id del lead)
//   INVALID_TRANSITION → handler devuelve 400 (transición no permitida)
//   DB_ERROR           → handler devuelve 500

export interface UpdateLeadStatusParams {
  user_id: string;
  lead_id: string;
  new_status: LeadStatusEnum;
  note?: string;
}

export interface UpdatedLead {
  id: string;
  status: LeadStatusEnum;
  internal_notes: string | null;
}

export type UpdateLeadStatusResult =
  | { ok: true; lead: UpdatedLead }
  | {
    ok: false;
    error_code:
      | "LEAD_NOT_FOUND"
      | "UNAUTHORIZED_AGENT"
      | "INVALID_TRANSITION"
      | "DB_ERROR";
    message?: string;
  };

export interface LeadStatusUpdater {
  update(params: UpdateLeadStatusParams): Promise<UpdateLeadStatusResult>;
}

// ── Deps inyectables del handler ──────────────────────────────────────────────

export interface UpdateLeadStatusDeps {
  callerVerifier: CallerVerifier;
  leadStatusUpdater: LeadStatusUpdater;
}
