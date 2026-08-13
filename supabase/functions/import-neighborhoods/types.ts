// supabase/functions/import-neighborhoods/types.ts
// Contratos del handler de import de colonias (tarea #157.4).

/** Una fila del lote, tal como la produce prepare-neighborhoods.mjs. */
export interface NeighborhoodRow {
  source_key: string;
  municipality_id: string;
  name: string;
  postal_code?: string;
  /** Geometría GeoJSON serializada (Polygon o MultiPolygon, WGS84). */
  geojson: string;
}

export type ImportBatchResult =
  | { ok: true; inserted: number; skipped: number }
  | { ok: false; message: string };

export interface ImportNeighborhoodsDeps {
  /** Secret esperado (env IMPORT_NEIGHBORHOODS_SECRET). null = no configurado. */
  get_secret: () => string | null;
  /** Pasa el lote a la RPC import_neighborhoods_batch (service_role). */
  import_batch: (rows: NeighborhoodRow[]) => Promise<ImportBatchResult>;
}
