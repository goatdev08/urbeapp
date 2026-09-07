// supabase/functions/update-lead-note/note_updater.ts
// Fábrica del NoteUpdater real. Separado de index.ts para ser testeable.
// Mirror de lead_status_updater.ts, pero SIN validación de transición de
// estado: esta función solo edita internal_notes. El status nunca se toca.
//
// Cierre de #31 (subtarea 269.3, decisión Abraham 2026-09-07): el owner/admin
// ACTIVO de la agencia DEL LEAD también puede editar la nota de un lead del
// equipo — mismo AgencyRoleResolver fail-closed que lead_status_updater.ts
// (mirror exacto de esa lógica, ver ese archivo para el razonamiento completo).

import type { NoteUpdater, UpdateLeadNoteParams, UpdateLeadNoteResult } from "./types.ts";
import type { AgencyRoleResolver } from "../_shared/agency_role.ts";

/**
 * Construye el NoteUpdater real contra un cliente supabase-js.
 * Responsabilidades:
 *   1. Verificar existencia + ownership (query con agent_id filter).
 *   2. Si no es el dueño: segunda query (con agency_id) para distinguir
 *      not-found vs unauthorized, y resolver owner/admin ACTIVO de la
 *      agencia del lead (269.3, igual que lead_status_updater.ts).
 *   3. Aplicar UPDATE (spread condicional, 75.6): internal_notes solo si
 *      params.note !== undefined (note || null); is_follow_up solo si
 *      params.is_follow_up !== undefined (valor TAL CUAL, incluido `false` —
 *      nunca se omite por ser falsy). updated_at siempre. Status intacto.
 *      El filtro `agent_id` del UPDATE solo aplica cuando la autorización
 *      vino por ownership directo (269.3).
 *   4. Retornar el lead actualizado (incluye is_follow_up si la DB lo devolvió).
 *
 * El parámetro `client` es duck-typed para facilitar el testing con fakes.
 * `agency_role_resolver` es OPCIONAL (default fail-closed: nunca resuelve
 * owner/admin) para no romper los call sites existentes que aún construyen
 * este updater con un solo argumento (269.3 amplía sin tocar esos tests).
 */
const NEVER_AUTHORIZES_RESOLVER: AgencyRoleResolver = {
  resolve: () => Promise.resolve(null),
};

export function make_note_updater(
  // deno-lint-ignore no-explicit-any
  client: { from(table: string): any },
  agency_role_resolver: AgencyRoleResolver = NEVER_AUTHORIZES_RESOLVER,
): NoteUpdater {
  return {
    async update(params: UpdateLeadNoteParams): Promise<UpdateLeadNoteResult> {
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
      // la agencia del lead — gatea el filtro agent_id del UPDATE más abajo.
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

      // 3. Aplicar UPDATE — ownership (o membresía de agencia, 269.3) en
      // .eq/RLS garantiza el backup.
      // NUNCA incluye status: esta función solo edita internal_notes/is_follow_up.
      // Spread condicional (75.6): cada campo viaja SOLO si vino en params, y
      // `is_follow_up` viaja con su valor literal (incluido `false`) — el bug
      // clásico sería usar `if (params.is_follow_up)` y perder el `false`.
      const update_payload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (params.note !== undefined) {
        update_payload.internal_notes = params.note || null;
      }
      if (params.is_follow_up !== undefined) {
        update_payload.is_follow_up = params.is_follow_up;
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
        .select("id, internal_notes, is_follow_up")
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
          internal_notes: updated.internal_notes ?? null,
          ...(updated.is_follow_up !== undefined ? { is_follow_up: updated.is_follow_up } : {}),
        },
      };
    },
  };
}
