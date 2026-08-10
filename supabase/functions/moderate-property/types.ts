// supabase/functions/moderate-property/types.ts
// Tipos y contratos DI para la Edge Function moderate-property (subtarea 73.9, PRD §15.6).
// Solo interfaces + tipos; sin imports de supabase-js (eso vive en _shared/clients.ts).
// EF única (decisión 2026-08-09): approve|needs_changes|reject|suspend parametrizados,
// NO 4 EFs separadas. Solo admin (AdminVerifier de _shared/admin_auth.ts).
//
// Estado machine (spec exacta, ver subtarea 73.9):
//   suspend            → properties.status='suspended' DIRECTO sin importar el estado
//                         actual (excepto estados terminales bloqueados, ver
//                         SUSPEND_BLOCKED_STATES en handler.ts). NUNCA toca
//                         property_revisions (ni lectura ni escritura) — una revisión
//                         pending/needs_changes existente se queda intacta.
//   approve/needs_changes/reject:
//     - SI existe una revisión ACTIVA (status IN pending|needs_changes) para la
//       propiedad: opera sobre la REVISIÓN.
//         approve        → aplica changed_fields sobre properties (reemplaza
//                           current_published), revisión→'approved'. #130: si la
//                           propiedad estaba 'pending_review' o 'needs_changes',
//                           properties.status pasa a 'active' EN LA MISMA escritura
//                           (antes se quedaba invisible para siempre); si ya estaba
//                           'active' (re-revisión §15.6 normal), el status no cambia.
//         needs_changes  → revisión→'needs_changes' + rejection_reason=reason.
//                           properties NO se toca (current_published intacta).
//         reject         → revisión→'rejected' + rejection_reason=reason.
//                           properties NO se toca.
//     - SI NO existe revisión activa: opera sobre la PUBLICACIÓN INICIAL. Requiere
//       que properties.status sea 'pending_review' (si no, NOTHING_TO_MODERATE — no
//       hay nada que resolver).
//         approve        → properties.status='active'
//         needs_changes  → properties.status='needs_changes'
//         reject         → properties.status='rejected'
//   TODAS las ramas registran en admin_actions (append-only, 20260604000007) —
//   #130: en la MISMA transacción que la escritura principal (RPC
//   moderate_property_atomic), y la respuesta reporta el status RESULTANTE.

// ── Payload ────────────────────────────────────────────────────────────────────

export type ModerateAction = "approve" | "needs_changes" | "reject" | "suspend";

export interface ModeratePropertyInput {
  property_id: string;
  action: ModerateAction;
  reason?: string;
}

// ── PropertyFetcher ───────────────────────────────────────────────────────────
// Trae el status actual de la propiedad: necesario para (a) el blocklist de
// suspend, (b) decidir si la publicación inicial está en pending_review, y (c)
// reportar el status "resultante" en la respuesta cuando la rama con-revisión no
// lo cambia.

export interface PropertyStatusSnapshot {
  id: string;
  status: string; // valor del enum property_status (17 valores, 20260809000002)
}

export type PropertyFetchResult =
  | { ok: true; property: PropertyStatusSnapshot }
  | { ok: false; error_code: "PROPERTY_NOT_FOUND" | "DB_ERROR"; message?: string };

export interface PropertyFetcher {
  fetch(property_id: string): Promise<PropertyFetchResult>;
}

// ── RevisionFinder ─────────────────────────────────────────────────────────────
// Busca la revisión ACTIVA (status IN pending|needs_changes) de la propiedad —
// invariante 🔒 20260809000003: a lo más una. NUNCA se invoca en la rama suspend.

export interface ActiveRevisionSnapshot {
  id: string;
  status: "pending" | "needs_changes";
  changed_fields: Record<string, unknown>;
}

export type ActiveRevisionResult =
  | { ok: true; revision: ActiveRevisionSnapshot | null }
  | { ok: false; error_code: "DB_ERROR"; message?: string };

export interface RevisionFinder {
  find_active(property_id: string): Promise<ActiveRevisionResult>;
}

// ── ModerationWriter (#130) ───────────────────────────────────────────────────
// Reemplaza a los tres seams de escritura previos (PropertyUpdater +
// RevisionResolver + AdminActionRecorder), que eran round-trips independientes
// sin transacción: si la auditoría fallaba tras activar la propiedad, la EF
// devolvía 500 con la propiedad YA activa y sin rastro en admin_actions, y el
// reintento moría en NOTHING_TO_MODERATE. Ahora el handler DECIDE (state
// machine intacta aquí) y emite UNA escritura; el adaptador real la ejecuta
// vía la RPC moderate_property_atomic (20260809000007) en una transacción.
//
// Campos opcionales = "no hacer esa escritura":
//   new_property_status  ausente → properties.status no se toca.
//   changed_fields       ausente → no se aplica snapshot de revisión.
//   revision_id (+status/reason) ausente → no se resuelve revisión.
// La auditoría (admin_id/action_type/old_values/new_values/reason) va SIEMPRE.

export interface ModerationWriteParams {
  property_id: string;
  admin_id: string;
  action_type: ModerateAction;
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  reason: string | null;
  new_property_status?: string;
  changed_fields?: Record<string, unknown>;
  revision_id?: string;
  revision_status?: "approved" | "needs_changes" | "rejected";
  revision_reason?: string | null;
}

export type ModerationWriteResult =
  | { ok: true }
  | { ok: false; error_code: "DB_ERROR"; message?: string };

export interface ModerationWriter {
  apply(params: ModerationWriteParams): Promise<ModerationWriteResult>;
}

// ── Deps inyectables del handler ──────────────────────────────────────────────

export interface ModeratePropertyDeps {
  adminVerifier: import("../_shared/admin_auth.ts").AdminVerifier;
  propertyFetcher: PropertyFetcher;
  revisionFinder: RevisionFinder;
  moderationWriter: ModerationWriter;
}

// ── Respuesta de éxito (contrato observable) ───────────────────────────────────
// status = el status RESULTANTE de la propiedad tras la operación (puede ser el
// mismo que antes, cuando la rama con-revisión solo tocó property_revisions).

export interface ModeratePropertySuccessBody {
  property_id: string;
  status: string;
}
