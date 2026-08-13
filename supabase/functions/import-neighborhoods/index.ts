// supabase/functions/import-neighborhoods/index.ts
// Entry point de producción (EF desechable, tarea #157.4). Los tests importan
// handler.ts directamente, NO este archivo.

import { handler } from "./handler.ts";
import { service_client } from "../_shared/clients.ts";
import type { ImportBatchResult, NeighborhoodRow } from "./types.ts";

Deno.serve((req: Request) => {
  const client = service_client();

  return handler(req, {
    get_secret: () => Deno.env.get("IMPORT_NEIGHBORHOODS_SECRET") ?? null,
    import_batch: async (rows: NeighborhoodRow[]): Promise<ImportBatchResult> => {
      const { data, error } = await client.rpc("import_neighborhoods_batch", {
        p_rows: rows,
      });
      if (error) return { ok: false, message: error.message };
      // returns table(...) → array de 1 fila
      const row = Array.isArray(data) ? data[0] : data;
      return { ok: true, inserted: row?.inserted ?? 0, skipped: row?.skipped ?? 0 };
    },
  });
});
