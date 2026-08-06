// supabase/functions/manage-agency-member/types.ts
// Contrato público (DI) del handler `manage-agency-member` — alta/baja/suspensión
// de agentes de una inmobiliaria por su owner (o admin de agencia, matriz PRD
// §4.10 / subtarea 71.2), subtarea 71.6.
//
// Contrato:
//   POST { member_id: string, action: 'suspend' | 'reactivate' | 'remove' }
//   → 200 { member: { id, agency_id, user_id, member_role, status } }
//   | 400 INVALID_INPUT | 401 UNAUTHENTICATED
//   | 403 NOT_AUTHORIZED | 403 CANNOT_MANAGE_OWNER
//   | 404 MEMBER_NOT_FOUND | 409 INVALID_TRANSITION | 405 | 500 DB_ERROR
//
// ── SEAM: caller_user_id SIEMPRE del JWT, nunca del payload (mismo principio
// que create-invitation/register-agency/upgrade-to-agent). Cero superficie de IDOR.
//
// ── SEAM DE AUTORIZACIÓN (decisión de esta fase RED, documentada porque el
// PLAN de la subtarea pedía elegirla explícitamente):
//
// La matriz de permisos de agency_members (owner=todo sobre su agencia;
// admin=todo EXCEPTO la fila owner ni promover a owner; agent/viewer=nada) ya
// vive en RLS como private.can_manage_agency_member + policies members_update/
// members_delete (migración 20260805000003, probada en
// supabase/tests/21_agency_member_role_matrix_test.sql). Dos rutas posibles
// para esta EF:
//   (a) user_client(authHeader) + dejar que RLS decida (patrón
//       request-agent-upgrade) — mínima duplicación, PERO members_select
//       oculta por igual "no existe" y "existe pero no es tu agencia": desde
//       un SELECT/UPDATE con RLS no se puede distinguir 404 de 403 sin una
//       segunda consulta privilegiada (el mismo problema que resolvió
//       property_status_updater.ts).
//   (b) service_role + AgencyMemberManager que reimplica la regla en TS
//       (patrón update-property-status/property_status_updater.ts) — permite
//       la distinción 403/404 limpia. private.can_manage_agency_member vive en
//       el schema `private` (NO expuesto por PostgREST), así que de todos
//       modos no es invocable directo desde la EF vía `.rpc(...)`; replicarla
//       en TS es la única forma de reusar la MISMA semántica sin exponer el
//       helper. Elegida: (b).
//
// ── CONVENCIÓN 403 vs 404 (decisión, "según convención" del PLAN) ───────────
// - Miembro de OTRA agencia que el caller no administra/visualiza → 404
//   MEMBER_NOT_FOUND (oculta existencia — mismo criterio anti-IDOR que
//   create-invitation: no revelar que una fila existe si el caller ni
//   siquiera podría verla por members_select).
// - Miembro DENTRO de la agencia del caller pero con un rol que no alcanza
//   (agent/viewer intentando gestionar, o admin tocando la fila owner) → 403
//   (NOT_AUTHORIZED / CANNOT_MANAGE_OWNER) — el caller SÍ puede ver esa fila
//   (members_select se lo permite), así que ocultar el código HTTP no aporta
//   nada y 403 es más honesto para la UI (botón deshabilitado + mensaje).
//
// ── SEAM: status es TS puro, DESACOPLADO del enum real de Postgres ──────────
// `agency_member_status` HOY solo tiene ('active','removed') — ver header de
// supabase/tests/26_agency_member_management_test.sql. Esta fase RED NO
// extiende el enum (ver ese archivo para el porqué). El campo `status` de
// `ManagedMember` es `string` (no un union literal atado al enum de Postgres)
// para que GREEN sea libre de resolverlo como más convenga (lo más probable:
// ALTER TYPE ADD VALUE 'suspended' en su propia migración, mismo patrón que
// 20260805000002) sin romper este contrato TS.
//
// ── Transiciones válidas (reglas de negocio, verificadas por INVALID_TRANSITION):
//   suspend:    active    -> suspended
//   reactivate: suspended -> active
//   remove:     active | suspended -> removed (terminal)
// Cualquier otra combinación (p.ej. suspend sobre ya-suspended, reactivate
// sobre active, cualquier acción sobre removed) -> 409 INVALID_TRANSITION.

// ── Input validado ────────────────────────────────────────────────────────────

export type MemberAction = "suspend" | "reactivate" | "remove";

export interface ManageAgencyMemberInput {
  member_id: string;
  action: MemberAction;
}

// ── CallerVerifier ────────────────────────────────────────────────────────────
// Contrato idéntico al de create-invitation/register-agency/upgrade-to-agent.

export type CallerVerifyResult =
  | { ok: true; user_id: string }
  | { ok: false; error_code: "UNAUTHENTICATED" };

export interface CallerVerifier {
  verify_caller(authHeader: string | null): Promise<CallerVerifyResult>;
}

// ── AgencyMemberManager ────────────────────────────────────────────────────────
// Responsabilidades (equivalente a property_status_updater.ts):
//   1. Localizar la fila `member_id` VISIBLE para el caller (members_select) —
//      si no es visible (no existe o es de otra agencia que no administra):
//      MEMBER_NOT_FOUND.
//   2. Verificar si el caller puede GESTIONARLA (owner de esa agencia, o admin
//      de esa agencia salvo que la fila sea member_role='owner', o admin
//      global) — si no: NOT_AUTHORIZED (agent/viewer) o CANNOT_MANAGE_OWNER
//      (admin sobre fila owner).
//   3. Validar la transición `action` contra el estado actual -> INVALID_TRANSITION.
//   4. Aplicar el UPDATE (status [+ removed_at si remove]) y retornar la fila.

export interface ManageAgencyMemberParams {
  caller_user_id: string;
  member_id: string;
  action: MemberAction;
}

export interface ManagedMember {
  id: string;
  agency_id: string;
  user_id: string;
  member_role: string;
  status: string; // TS puro -- ver nota de desacople del enum arriba
}

export type ManageAgencyMemberResult =
  | { ok: true; member: ManagedMember }
  | {
    ok: false;
    error_code:
      | "MEMBER_NOT_FOUND"
      | "NOT_AUTHORIZED"
      | "CANNOT_MANAGE_OWNER"
      | "INVALID_TRANSITION"
      | "DB_ERROR";
    message?: string;
  };

export interface AgencyMemberManager {
  manage(params: ManageAgencyMemberParams): Promise<ManageAgencyMemberResult>;
}

// ── Deps del handler ──────────────────────────────────────────────────────────

export interface ManageAgencyMemberDeps {
  callerVerifier: CallerVerifier;
  memberManager: AgencyMemberManager;
}
