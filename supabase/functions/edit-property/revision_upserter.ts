// supabase/functions/edit-property/revision_upserter.ts
// Fábrica del RevisionUpserter real contra `property_revisions` (73.6, PRD §15.6).
// Separado de index.ts para ser testeable con un fake postgrest client (mismo
// patrón que property_status_updater.ts / _shared/duplicate_property_checker.ts).
//
// Invariante 🔒 (73.2, migración 20260809000003): índice único parcial — a lo
// más UNA revisión con status IN ('pending','needs_changes') activa por
// propiedad. El upsert respeta esa invariante:
//   1. Busca una revisión activa (pending/needs_changes) de la propiedad.
//   2. Si existe: UPDATE de la MISMA fila (status→'pending' — el resubmit tras
//      needs_changes también regresa a pending — y changed_fields→el snapshot
//      MÁS RECIENTE). Nunca inserta una segunda fila activa.
//   3. Si no existe (o la única existente es approved/rejected, que NO cuenta
//      como activa): INSERT de una fila nueva en 'pending'.

import type {
  EditPropertyInput,
  RevisionUpserter,
  RevisionUpsertResult,
} from "./types.ts";

const ACTIVE_STATUSES = ["pending", "needs_changes"];

// deno-lint-ignore no-explicit-any
export function make_revision_upserter(client: { from(table: string): any }): RevisionUpserter {
  return {
    async upsert(
      property_id: string,
      submitted_by: string,
      changed_fields: EditPropertyInput,
    ): Promise<RevisionUpsertResult> {
      // 1. Buscar revisión activa (pending/needs_changes) de esta propiedad.
      const { data: existing, error: find_error } = await client
        .from("property_revisions")
        .select("id")
        .eq("property_id", property_id)
        .in("status", ACTIVE_STATUSES)
        .maybeSingle();

      if (find_error) {
        return { ok: false, error_code: "DB_ERROR", message: find_error.message };
      }

      // 2. Ya hay una activa → actualizarla en vez de insertar una segunda
      //    (la DB real la rechazaría por el índice único parcial de 73.2).
      if (existing) {
        const { data: updated, error: update_error } = await client
          .from("property_revisions")
          .update({
            status: "pending", // needs_changes → pending al resubmit (§15.6)
            changed_fields,
            submitted_by,
          })
          .eq("id", existing.id)
          .select("id")
          .maybeSingle();

        if (update_error || !updated) {
          return {
            ok: false,
            error_code: "DB_ERROR",
            message: update_error?.message ?? "UPDATE no devolvió filas",
          };
        }
        return { ok: true, revision_id: updated.id };
      }

      // 3. Sin activa (o approved/rejected inactivas) → INSERT nueva fila.
      const { data: inserted, error: insert_error } = await client
        .from("property_revisions")
        .insert({
          property_id,
          submitted_by,
          status: "pending",
          changed_fields,
        })
        .select("id")
        .maybeSingle();

      if (insert_error || !inserted) {
        return {
          ok: false,
          error_code: "DB_ERROR",
          message: insert_error?.message ?? "INSERT no devolvió filas",
        };
      }
      return { ok: true, revision_id: inserted.id };
    },
  };
}
