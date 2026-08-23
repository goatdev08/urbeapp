// supabase/functions/suspend-agency/types.ts
// Contrato DI de la Edge Function suspend-agency (subtarea #211.1).
//
// 🔴 QUÉ **NO** VIVE AQUÍ, A PROPÓSITO. La validez de una transición de estado
// de una organización NO se decide en TypeScript. La única autoridad es el
// trigger `handle_agency_status_change()` (71.5, extendido en 169.2/210.1):
// valida el grafo {pending_approval→active, pending_approval→rejected,
// active→suspended, suspended→active}, cascada sobre `ads` (pausa/revive
// SOLO los que ella misma pausó, vía paused_by_suspension) y escribe
// `admin_actions` en la MISMA transacción. Esta EF hace UN UPDATE (vía la RPC
// set_agency_status_atomic, #211.1) y traduce lo que el trigger conteste.
//
// Duplicar el grafo acá crearía dos copias de una regla de negocio que ya se
// desincronizaron una vez en este repo (#183, la ventana del reaper). Y
// escribir `admin_actions` desde la EF duplicaría la fila que el trigger ya
// inserta — la auditoría quedaría contando doble sobre un acto facturable.

import type { AdminVerifier } from "../_shared/admin_auth.ts";

/**
 * Las dos acciones que un admin puede tomar sobre una organización.
 * `suspend` manda next_status='suspended'; `reactivate` manda 'active'.
 * Deliberadamente NO se exponen 'active'/'suspended' como `action` — el
 * vocabulario de la acción (verbo) es el que el admin entiende, el estado
 * destino es un detalle de traducción interno (mismo criterio que
 * approve/reject → active/rejected en moderate-ad).
 */
export type SuspendAgencyAction = "suspend" | "reactivate";

export interface SuspendAgencyInput {
  agency_id: string;
  action: SuspendAgencyAction;
}

/**
 * Códigos que el WRITER puede devolver. Nacen de la base: la RPC
 * set_agency_status_atomic (#211.1) y el trigger los lanzan/reportan y el
 * adaptador los reconoce. `DB_ERROR` es el cajón de todo lo demás (→ 500) —
 * incluye INVALID_NEXT_STATUS y STATUS_CHANGE_REQUIRES_ADMIN, que son bugs
 * NUESTROS (la EF llamó mal), no del admin.
 */
export type AgencyStatusErrorCode =
  | "AGENCY_NOT_FOUND"
  /**
   * El trigger rechazó la transición (p.ej. una organización pending_approval
   * que aún no fue aprobada no puede suspenderse — AGST17 en
   * 67_set_agency_status_atomic_test.sql). NO cubre "suspender lo ya
   * suspendido" / "reactivar lo ya activo": esos son un no-op IDEMPOTENTE
   * (200, no error) porque el trigger tiene
   * `when (old.status is distinct from new.status)` — un UPDATE que reescribe
   * el mismo status jamás lo dispara (AGST19).
   */
  | "INVALID_STATUS_TRANSITION"
  | "DB_ERROR";

export type AgencyStatusResult =
  | { ok: true; status: "active" | "suspended" }
  | { ok: false; error_code: AgencyStatusErrorCode };

export interface AgencyStatusWriteParams {
  agency_id: string;
  /** Estado destino. 'suspended' para `suspend`, 'active' para `reactivate`. */
  next_status: "active" | "suspended";
  /** Admin resuelto por el verificador; la RPC lo instala en el GUC para el trigger. */
  admin_id: string;
}

export interface AgencyStatusWriter {
  set_status(params: AgencyStatusWriteParams): Promise<AgencyStatusResult>;
}

export interface SuspendAgencyDeps {
  adminVerifier: AdminVerifier;
  agencyStatusWriter: AgencyStatusWriter;
}
