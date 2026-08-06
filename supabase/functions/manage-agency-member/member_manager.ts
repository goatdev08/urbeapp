// supabase/functions/manage-agency-member/member_manager.ts
// Fábrica del AgencyMemberManager real. Separado de index.ts para ser testeable
// (mirror de update-property-status/property_status_updater.ts).
//
// Reimplica en TS la matriz de permisos de private.can_manage_agency_member
// (owner=todo sobre su agencia; admin=todo EXCEPTO la fila owner ni promover a
// owner; agent/viewer=nada) porque este manager corre vía service_role -- ver
// rationale completo (por qué service_role + reimplementación, en vez de RLS)
// en ./types.ts.

import type {
  AgencyMemberManager,
  ManageAgencyMemberParams,
  ManageAgencyMemberResult,
  ManagedMember,
  MemberAction,
} from "./types.ts";

// Transiciones válidas (contrato fijado en types.ts):
//   suspend:    active    -> suspended
//   reactivate: suspended -> active
//   remove:     active | suspended -> removed (terminal)
const VALID_TRANSITIONS: Record<MemberAction, { from: string[]; to: string }> = {
  suspend: { from: ["active"], to: "suspended" },
  reactivate: { from: ["suspended"], to: "active" },
  remove: { from: ["active", "suspended"], to: "removed" },
};

interface MemberRow {
  id: string;
  agency_id: string;
  user_id: string;
  member_role: string;
  status: string;
}

/**
 * Construye el AgencyMemberManager real contra un cliente supabase-js
 * (service_role -- ve TODAS las filas de agency_members, sin pasar por RLS;
 * la visibilidad/autorización se reimplica aquí explícitamente).
 *
 * Responsabilidades (equivalente a property_status_updater.ts):
 *   1. Localizar la fila `member_id` -- si no existe: MEMBER_NOT_FOUND.
 *   2. Verificar visibilidad del caller sobre esa fila (mismo criterio que
 *      members_select: es su propia fila, o administra/visualiza esa agencia)
 *      -- si no es visible: MEMBER_NOT_FOUND (oculta existencia, anti-IDOR).
 *   3. Verificar si el caller puede GESTIONARLA (mismo criterio que
 *      private.can_manage_agency_member: owner de esa agencia siempre; admin
 *      de esa agencia EXCEPTO si la fila es member_role='owner'; admin global
 *      siempre) -- si no: NOT_AUTHORIZED (agent/viewer) o CANNOT_MANAGE_OWNER
 *      (admin sobre fila owner).
 *   4. Validar la transición `action` contra el estado actual -> INVALID_TRANSITION.
 *   5. Aplicar el UPDATE (status [+ removed_at si remove]) y retornar la fila.
 *
 * El parámetro `client` es duck-typed para facilitar el testing con fakes.
 */
// deno-lint-ignore no-explicit-any
export function make_agency_member_manager(client: { from(table: string): any }): AgencyMemberManager {
  return {
    async manage(params: ManageAgencyMemberParams): Promise<ManageAgencyMemberResult> {
      const { caller_user_id, member_id, action } = params;

      // 1. Localizar la fila objetivo.
      const { data: target, error: find_error } = await client
        .from("agency_members")
        .select("id, agency_id, user_id, member_role, status")
        .eq("id", member_id)
        .maybeSingle();

      if (find_error) {
        return { ok: false, error_code: "DB_ERROR", message: find_error.message };
      }

      if (!target) {
        return { ok: false, error_code: "MEMBER_NOT_FOUND" };
      }

      const member = target as MemberRow;

      // 2. Rol del caller en la agencia de la fila objetivo (mismo criterio
      //    que private.agency_role_of: 'active' membership, si no NULL).
      const { data: callerMembership, error: caller_error } = await client
        .from("agency_members")
        .select("member_role")
        .eq("agency_id", member.agency_id)
        .eq("user_id", caller_user_id)
        .eq("status", "active")
        .maybeSingle();

      if (caller_error) {
        return { ok: false, error_code: "DB_ERROR", message: caller_error.message };
      }

      const { data: callerProfile, error: profile_error } = await client
        .from("users")
        .select("role")
        .eq("id", caller_user_id)
        .maybeSingle();

      if (profile_error) {
        return { ok: false, error_code: "DB_ERROR", message: profile_error.message };
      }

      const caller_agency_role = (callerMembership as { member_role: string } | null)
        ?.member_role ?? null;
      const caller_is_global_admin = (callerProfile as { role: string } | null)
        ?.role === "admin";

      const caller_manages_agency = caller_agency_role === "owner";
      const caller_is_agency_admin = caller_agency_role === "admin";

      // 2b. Visibilidad (members_select): propia fila, o administra/visualiza
      //     esa agencia (owner/admin/viewer), o admin global. Si no es
      //     visible: MEMBER_NOT_FOUND (oculta existencia, anti-IDOR).
      const caller_can_see = member.user_id === caller_user_id ||
        caller_manages_agency ||
        caller_agency_role === "admin" ||
        caller_agency_role === "viewer" ||
        caller_is_global_admin;

      if (!caller_can_see) {
        return { ok: false, error_code: "MEMBER_NOT_FOUND" };
      }

      // 3. Autorización de ESCRITURA (private.can_manage_agency_member):
      //    owner de la agencia siempre; admin de la agencia EXCEPTO fila
      //    member_role='owner'; admin global siempre.
      const caller_can_manage = caller_manages_agency ||
        (caller_is_agency_admin && member.member_role !== "owner") ||
        caller_is_global_admin;

      if (!caller_can_manage) {
        if (caller_is_agency_admin && member.member_role === "owner") {
          return { ok: false, error_code: "CANNOT_MANAGE_OWNER" };
        }
        return { ok: false, error_code: "NOT_AUTHORIZED" };
      }

      // 4. Validar transición.
      const transition = VALID_TRANSITIONS[action];
      if (!transition.from.includes(member.status)) {
        return {
          ok: false,
          error_code: "INVALID_TRANSITION",
          message: `Transición '${action}' no permitida desde status='${member.status}'`,
        };
      }

      // 5. Aplicar UPDATE.
      const update_payload: Record<string, unknown> = { status: transition.to };
      if (action === "remove") {
        update_payload.removed_at = new Date().toISOString();
      }

      const { data: updated, error: update_error } = await client
        .from("agency_members")
        .update(update_payload)
        .eq("id", member_id)
        .select("id, agency_id, user_id, member_role, status")
        .maybeSingle();

      if (update_error || !updated) {
        return {
          ok: false,
          error_code: "DB_ERROR",
          message: update_error?.message ?? "UPDATE no devolvió filas",
        };
      }

      const updated_row = updated as MemberRow;
      const result_member: ManagedMember = {
        id: updated_row.id,
        agency_id: updated_row.agency_id,
        user_id: updated_row.user_id,
        member_role: updated_row.member_role,
        status: updated_row.status,
      };

      return { ok: true, member: result_member };
    },
  };
}
