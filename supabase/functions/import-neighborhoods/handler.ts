// supabase/functions/import-neighborhoods/handler.ts
// Handler PURO con DI (patrón update-lead-note) — tarea #157.4.
//
// EF DESECHABLE de operación: puente HTTP → RPC import_neighborhoods_batch para
// cargar el catálogo DCAH al remoto sin conexión directa a Postgres (no hay
// contraseña de DB en la máquina de dev; precedente "EF desechable" del seed 72.1).
// Se despliega para el import y se elimina después (`supabase functions delete`);
// el código queda en el repo para re-imports (nuevas ediciones DCAH / más estados).
//
// Frontera de confianza (por eso el TDD estricto):
//   1. OPTIONS → 200 · no-POST → 405 (listado EC-1..EC-10 en handler.test.ts)
//   2. Secret: env IMPORT_NEIGHBORHOODS_SECRET ausente → 500 fail-closed;
//      header x-import-secret ≠ env → 401. El JWT de plataforma (verify_jwt) NO
//      basta: el anon key es público — el secret es la llave real del import.
//   3. Payload: {rows: NeighborhoodRow[]} 1..2000, campos string requeridos.
//   4. import_batch (RPC service_role) → 200 {inserted, skipped} | 500.

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import type { ImportNeighborhoodsDeps, NeighborhoodRow } from "./types.ts";

const MAX_ROWS = 2000;

function is_valid_row(raw: unknown): raw is NeighborhoodRow {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  const required_strings = ["source_key", "municipality_id", "name", "geojson"];
  if (!required_strings.every((k) => typeof r[k] === "string" && (r[k] as string) !== "")) {
    return false;
  }
  if (r.postal_code !== undefined && typeof r.postal_code !== "string") return false;
  return true;
}

export async function handler(
  req: Request,
  deps: ImportNeighborhoodsDeps,
): Promise<Response> {
  if (req.method === "OPTIONS") return handle_cors_preflight(req);
  if (req.method !== "POST") {
    return error_response("METHOD_NOT_ALLOWED", "Solo POST", 405);
  }

  // ── Gate por secret (fail-closed) ─────────────────────────────────────────
  const expected = deps.get_secret();
  if (!expected) {
    return error_response(
      "CONFIG_MISSING",
      "IMPORT_NEIGHBORHOODS_SECRET no está configurado — import deshabilitado",
      500,
    );
  }
  if (req.headers.get("x-import-secret") !== expected) {
    return error_response("UNAUTHORIZED", "Secret de import inválido", 401);
  }

  // ── Payload ───────────────────────────────────────────────────────────────
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error_response("INVALID_INPUT", "El body debe ser JSON", 400);
  }
  const rows = (raw as { rows?: unknown })?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return error_response("INVALID_INPUT", "rows debe ser un array no vacío", 400);
  }
  if (rows.length > MAX_ROWS) {
    return error_response("INVALID_INPUT", `Máximo ${MAX_ROWS} filas por lote`, 400);
  }
  if (!rows.every(is_valid_row)) {
    return error_response(
      "INVALID_INPUT",
      "Cada fila requiere source_key, municipality_id, name y geojson (strings no vacíos)",
      400,
    );
  }

  // ── Import ────────────────────────────────────────────────────────────────
  const result = await deps.import_batch(rows);
  if (!result.ok) {
    return error_response("IMPORT_FAILED", result.message, 500);
  }
  return json_response({ inserted: result.inserted, skipped: result.skipped }, 200);
}
