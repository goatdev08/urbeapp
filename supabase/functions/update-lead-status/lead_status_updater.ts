// supabase/functions/update-lead-status/lead_status_updater.ts
// Fábrica del LeadStatusUpdater real. Separado de index.ts para ser testeable.
// La lógica de dominio (valid_transitions, ownership, UPDATE shape) vive aquí
// y es ejercitada por lead_status_updater.test.ts con un fake client.

import type {
  LeadStatusEnum,
  LeadStatusUpdater,
  UpdateLeadStatusParams,
  UpdateLeadStatusResult,
} from "./types.ts";

// Tabla de transiciones válidas (fuente: dominio del funnel de CRM).
// Estados terminales (closed_won, closed_lost, discarded) no tienen transiciones salientes.
// Los saltos de etapa (new→visit_scheduled, contacted→closed_won) tampoco son válidos.
const VALID_TRANSITIONS: Record<LeadStatusEnum, LeadStatusEnum[]> = {
  new: ["contacted", "discarded"],
  contacted: ["in_progress", "closed_lost", "discarded"],
  in_progress: ["visit_scheduled", "closed_won", "closed_lost", "discarded"],
  visit_scheduled: ["in_progress", "closed_won", "closed_lost", "discarded"],
  closed_won: [],
  closed_lost: [],
  discarded: [],
};

/**
 * Construye el LeadStatusUpdater real contra un cliente supabase-js.
 * Responsabilidades (en tres queries máximo):
 *   1. Verificar existencia + ownership (query con agent_id filter).
 *   2. Distinguir not-found vs unauthorized (segunda query sin agent filter).
 *   3. Validar transición de estado contra VALID_TRANSITIONS.
 *   4. Aplicar UPDATE (status, updated_at, internal_notes solo si note presente).
 *   5. Retornar el lead actualizado.
 *
 * El parámetro `client` es duck-typed para facilitar el testing con fakes.
 */
// deno-lint-ignore no-explicit-any
export function make_lead_status_updater(client: { from(table: string): any }): LeadStatusUpdater {
  return {
    async update(params: UpdateLeadStatusParams): Promise<UpdateLeadStatusResult> {
      // 1. Verificar existencia + ownership en una query
      const { data: existing, error: find_error } = await client
        .from("leads")
        .select("id, status")
        .eq("id", params.lead_id)
        .eq("agent_id", params.user_id)
        .maybeSingle();

      if (find_error) {
        return { ok: false, error_code: "DB_ERROR", message: find_error.message };
      }

      // 2. Si no se encontró con agent filter: distinguir not-found vs unauthorized
      if (!existing) {
        const { data: any_lead } = await client
          .from("leads")
          .select("id")
          .eq("id", params.lead_id)
          .maybeSingle();

        if (!any_lead) {
          return { ok: false, error_code: "LEAD_NOT_FOUND" };
        }
        return {
          ok: false,
          error_code: "UNAUTHORIZED_AGENT",
          message: "El caller no es el agente dueño del lead",
        };
      }

      // 3. Validar transición de estado
      const current = existing.status as LeadStatusEnum;
      const next = params.new_status;
      if (!VALID_TRANSITIONS[current]?.includes(next)) {
        return {
          ok: false,
          error_code: "INVALID_TRANSITION",
          message: `Transición ${current}→${next} no está permitida`,
        };
      }

      // 4. Aplicar UPDATE — ownership en .eq garantiza RLS de backup
      // ponytail: internal_notes se omite del payload si note es undefined (no sobreescribir)
      const update_payload: Record<string, unknown> = {
        status: params.new_status,
        updated_at: new Date().toISOString(),
      };
      if (params.note !== undefined) {
        update_payload.internal_notes = params.note;
      }

      const { data: updated, error: update_error } = await client
        .from("leads")
        .update(update_payload)
        .eq("id", params.lead_id)
        .eq("agent_id", params.user_id)
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
