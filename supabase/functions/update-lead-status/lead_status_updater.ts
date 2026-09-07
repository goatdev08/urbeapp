// supabase/functions/update-lead-status/lead_status_updater.ts
// Fábrica del LeadStatusUpdater real. Separado de index.ts para ser testeable.
// La lógica de dominio (ownership, UPDATE shape) vive aquí y es ejercitada por
// lead_status_updater.test.ts con un fake client.
//
// Transiciones LIBRES (subtarea 75.1, PRD §19.8): ya no existe una tabla de
// transiciones válidas — cualquier estado → cualquier estado, incluido reabrir un
// lead cerrado. El código INVALID_TRANSITION dejó de emitirse. El timeline completo
// queda registrado en public.lead_status_history vía trigger DB (migración
// 20260807000003) — no hace falta que esta Edge Function lo escriba a mano.
//
// Cierre de #31 (subtarea 269.3, decisión Abraham 2026-09-07): el owner/admin
// ACTIVO de la agencia DEL LEAD (leads.agency_id) también puede escribir un lead
// del equipo — misma frontera que private.can_edit_lead/leads_update
// (20260906400003). `agency_role_resolver` es el mismo AgencyRoleResolver
// fail-closed de _shared/agency_role.ts que ya usan edit-property/
// update-property-status (#202): membresía no-activa o error de query → null,
// nunca autoriza por defecto.

import type {
  LeadStatusEnum,
  LeadStatusUpdater,
  UpdateLeadStatusParams,
  UpdateLeadStatusResult,
} from "./types.ts";
import type { AgencyRoleResolver } from "../_shared/agency_role.ts";

/**
 * Construye el LeadStatusUpdater real contra un cliente supabase-js.
 * Responsabilidades:
 *   1. Verificar existencia + ownership (query con agent_id filter).
 *   2. Si no es el dueño: segunda query (con agency_id) para distinguir
 *      not-found vs unauthorized, y — si el lead pertenece a una agencia —
 *      resolver si el caller es owner/admin ACTIVO de esa agencia (269.3).
 *   3. Aplicar UPDATE (status, updated_at, internal_notes solo si note presente,
 *      last_contact_at solo al pasar a 'contacted'). El filtro `agent_id` del
 *      UPDATE solo aplica cuando la autorización vino por ownership directo —
 *      un owner/admin de agencia no es agent_id del lead.
 *   4. Retornar el lead actualizado.
 *
 * El parámetro `client` es duck-typed para facilitar el testing con fakes.
 * `agency_role_resolver` es OPCIONAL (default fail-closed: nunca resuelve
 * owner/admin) para no romper los call sites existentes que aún construyen
 * este updater con un solo argumento (269.3 amplía sin tocar esos tests).
 */
const NEVER_AUTHORIZES_RESOLVER: AgencyRoleResolver = {
  resolve: () => Promise.resolve(null),
};

export function make_lead_status_updater(
  // deno-lint-ignore no-explicit-any
  client: { from(table: string): any },
  agency_role_resolver: AgencyRoleResolver = NEVER_AUTHORIZES_RESOLVER,
): LeadStatusUpdater {
  return {
    async update(params: UpdateLeadStatusParams): Promise<UpdateLeadStatusResult> {
      // 1. Verificar existencia + ownership en una query
      const { data: existing, error: find_error } = await client
        .from("leads")
        .select("id")
        .eq("id", params.lead_id)
        .eq("agent_id", params.user_id)
        .maybeSingle();

      if (find_error) {
        return { ok: false, error_code: "DB_ERROR", message: find_error.message };
      }

      // 269.3: true solo cuando la autorización vino por owner/admin ACTIVO de
      // la agencia del lead (no por ser el agente dueño) — gatea el filtro
      // agent_id del UPDATE más abajo.
      let authorized_via_agency = false;

      // 2. Si no se encontró con agent filter: distinguir not-found vs unauthorized
      if (!existing) {
        const { data: any_lead } = await client
          .from("leads")
          .select("id, agency_id")
          .eq("id", params.lead_id)
          .maybeSingle();

        if (!any_lead) {
          return { ok: false, error_code: "LEAD_NOT_FOUND" };
        }

        // 269.3 — solo owner/admin ACTIVOS de la agencia DEL LEAD ganan el
        // bypass (ningún otro member_role, agency_id NULL nunca resuelve rol).
        if (any_lead.agency_id) {
          const member_role = await agency_role_resolver.resolve(
            params.user_id,
            any_lead.agency_id,
          );
          if (member_role === "owner" || member_role === "admin") {
            authorized_via_agency = true;
          }
        }

        if (!authorized_via_agency) {
          return {
            ok: false,
            error_code: "UNAUTHORIZED_AGENT",
            message: "El caller no es el agente dueño del lead",
          };
        }
      }

      // 3. Aplicar UPDATE — transiciones libres (75.1): ningún gate de estado aquí.
      // ownership (o membresía de agencia, 269.3) en .eq/RLS garantiza el backup.
      // ponytail: internal_notes se omite del payload si note es undefined (no sobreescribir)
      const update_payload: Record<string, unknown> = {
        status: params.new_status,
        updated_at: new Date().toISOString(),
      };
      if (params.note !== undefined) {
        update_payload.internal_notes = params.note;
      }
      // 268.5 — histórico de contacto para la ficha/agenda (#270): solo al pasar a contacted.
      if (params.new_status === "contacted") {
        update_payload.last_contact_at = update_payload.updated_at;
      }

      let update_query = client
        .from("leads")
        .update(update_payload)
        .eq("id", params.lead_id);
      // El owner/admin de agencia no es agent_id del lead: filtrar por él
      // dejaría el UPDATE en 0 filas pese a estar autorizado.
      if (!authorized_via_agency) {
        update_query = update_query.eq("agent_id", params.user_id);
      }

      const { data: updated, error: update_error } = await update_query
        .select("id, status, internal_notes")
        .maybeSingle();

      if (update_error || !updated) {
        return {
          ok: false,
          error_code: "DB_ERROR",
          message: update_error?.message ?? "UPDATE no devolvió filas",
        };
      }

      return {
        ok: true,
        lead: {
          id: updated.id,
          status: updated.status as LeadStatusEnum,
          internal_notes: updated.internal_notes ?? null,
        },
      };
    },
  };
}
