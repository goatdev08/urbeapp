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
//         approve        → aplica changed_fields completo sobre properties (reemplaza
//                           current_published), revisión→'approved'. properties.status
//                           NO cambia (sigue el que ya tenía, típicamente 'active').
//         needs_changes  → revisión→'needs_changes' + rejection_reason=reason.
//                           properties NO se toca.
//         reject         → revisión→'rejected' + rejection_reason=reason.
//                           properties NO se toca.
//     - SI NO existe revisión activa: opera sobre la PUBLICACIÓN INICIAL. Requiere
//       que properties.status sea 'pending_review' (si no, NOTHING_TO_MODERATE — no
//       hay nada que resolver).
//         approve        → properties.status='active'
//         needs_changes  → properties.status='needs_changes'
//         reject         → properties.status='rejected'
//   TODAS las ramas registran en admin_actions (append-only, 20260604000007).

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

// ── PropertyUpdater ───────────────────────────────────────────────────────────
// Dos operaciones distintas sobre `properties`, nunca ambas en la misma rama:
//   - set_status: cambia SOLO status (suspend, y las 3 ramas sin-revisión).
//   - apply_revision_snapshot: reemplaza current_published con cambios completos
//     del snapshot de la revisión (SOLO approve con-revisión). NO toca status.

export type PropertyWriteResult =
  | { ok: true }
  | { ok: false; error_code: "DB_ERROR"; message?: string };

export interface PropertyUpdater {
  set_status(property_id: string, status: string): Promise<PropertyWriteResult>;
  apply_revision_snapshot(
    property_id: string,
    changed_fields: Record<string, unknown>,
  ): Promise<PropertyWriteResult>;
}

// ── RevisionResolver ───────────────────────────────────────────────────────────
// Cierra una revisión activa: approved (tras aplicar snapshot), needs_changes o
// rejected. reason se persiste como rejection_reason (null en approve: no aplica).

export interface RevisionResolveParams {
  revision_id: string;
  status: "approved" | "needs_changes" | "rejected";
  admin_id: string;
  reason: string | null;
}

export type RevisionResolveResult =
  | { ok: true }
  | { ok: false; error_code: "DB_ERROR"; message?: string };

export interface RevisionResolver {
  resolve(params: RevisionResolveParams): Promise<RevisionResolveResult>;
}

// ── AdminActionRecorder ────────────────────────────────────────────────────────
// Auditoría append-only (admin_actions, 20260604000007). action_type = el
// ModerateAction del payload, forma libre (columna text). Se llama en TODAS las
// ramas exitosas, nunca en errores de validación/auth/not-found/nothing-to-moderate.

export interface AdminActionRecordParams {
  admin_id: string;
  action_type: ModerateAction;
  entity_type: "property";
  entity_id: string;
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  reason: string | null;
}

export type AdminActionRecordResult =
  | { ok: true }
  | { ok: false; error_code: "DB_ERROR"; message?: string };

export interface AdminActionRecorder {
  record(params: AdminActionRecordParams): Promise<AdminActionRecordResult>;
}

// ── Deps inyectables del handler ──────────────────────────────────────────────

export interface ModeratePropertyDeps {
  adminVerifier: import("../_shared/admin_auth.ts").AdminVerifier;
  propertyFetcher: PropertyFetcher;
  revisionFinder: RevisionFinder;
  propertyUpdater: PropertyUpdater;
  revisionResolver: RevisionResolver;
  adminActionRecorder: AdminActionRecorder;
}

// ── Respuesta de éxito (contrato observable) ───────────────────────────────────
// status = el status RESULTANTE de la propiedad tras la operación (puede ser el
// mismo que antes, cuando la rama con-revisión solo tocó property_revisions).

export interface ModeratePropertySuccessBody {
  property_id: string;
  status: string;
}
