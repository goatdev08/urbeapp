// supabase/functions/update-lead-note/note_updater.ts
// Fábrica del NoteUpdater real. Separado de index.ts para ser testeable.
// Mirror de lead_status_updater.ts, pero SIN validación de transición de
// estado: esta función solo edita internal_notes. El status nunca se toca.

import type { NoteUpdater, UpdateLeadNoteParams, UpdateLeadNoteResult } from "./types.ts";

/**
 * Construye el NoteUpdater real contra un cliente supabase-js.
 * Responsabilidades (en dos queries máximo):
 *   1. Verificar existencia + ownership (query con agent_id filter).
 *   2. Distinguir not-found vs unauthorized (segunda query sin agent filter).
 *   3. Aplicar UPDATE (internal_notes = note || null, updated_at). Status intacto.
 *   4. Retornar el lead actualizado.
 *
 * El parámetro `client` es duck-typed para facilitar el testing con fakes.
 */
// deno-lint-ignore no-explicit-any
export function make_note_updater(client: { from(table: string): any }): NoteUpdater {
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

      // 3. Aplicar UPDATE — ownership en .eq garantiza RLS de backup
      // NUNCA incluye status: esta función solo edita internal_notes.
      const { data: updated, error: update_error } = await client
        .from("leads")
        .update({
          internal_notes: params.note || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", params.lead_id)
        .eq("agent_id", params.user_id)
        .select("id, internal_notes")
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
        },
      };
    },
  };
}
