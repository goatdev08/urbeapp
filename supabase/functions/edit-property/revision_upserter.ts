// supabase/functions/edit-property/revision_upserter.ts
// STUB — fase RED de la subtarea 73.6. Solo la firma exportada existe; el
// upsert real contra `property_revisions` (dedup de fila activa pending/
// needs_changes, needs_changes→pending al resubmit — ver
// revision_upserter.test.ts) es responsabilidad del GREEN (agente `supabase`).
//
// Deliberadamente lanza para que TODOS los tests de revision_upserter.test.ts
// fallen por excepción (RED válido), no por "module not found".

import type { EditPropertyInput, RevisionUpserter } from "./types.ts";

// deno-lint-ignore no-explicit-any
export function make_revision_upserter(_client: { from(table: string): any }): RevisionUpserter {
  return {
    upsert(
      _property_id: string,
      _submitted_by: string,
      _changed_fields: EditPropertyInput,
    ) {
      throw new Error("not_implemented");
    },
  };
}
