// supabase/functions/import-neighborhoods/handler.test.ts
// RED (tarea #157.4) — handler de la EF desechable de import de colonias.
//
// La EF es el puente al remoto SIN contraseña de DB: recibe lotes HTTP y los pasa
// a la RPC import_neighborhoods_batch (service_role, upsert probado en pgTAP 45).
// Este handler cubre la FRONTERA DE CONFIANZA: el gate por secret compartido
// (header x-import-secret vs env) y la validación del payload. Un secret mal
// configurado o ausente NUNCA debe dejar pasar el import.
//
// Edge cases enumerados:
//   EC-1: OPTIONS → 200 (preflight CORS)
//   EC-2: GET → 405
//   EC-3: env sin secret → 500 CONFIG_MISSING (fail-closed: sin secret NO hay import)
//   EC-4: header ausente o distinto → 401 UNAUTHORIZED
//   EC-5: body no-JSON → 400 INVALID_INPUT
//   EC-6: rows ausente / no-array / vacío → 400
//   EC-7: lote > 2000 filas → 400 (la EF no es para un solo lote gigante)
//   EC-8: fila sin source_key/municipality_id/name/geojson string → 400
//   EC-9: import_batch responde error → 500 IMPORT_FAILED
//   EC-10: lote válido → 200 {inserted, skipped} y el handler pasa las filas TAL CUAL

import { assertEquals } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  ImportNeighborhoodsDeps,
  NeighborhoodRow,
} from "./types.ts";

// ── Fakes ────────────────────────────────────────────────────────────────────

const SECRET = "secreto-de-prueba";

const VALID_ROW: NeighborhoodRow = {
  source_key: "1403900010316",
  municipality_id: "14039",
  name: "Providencia",
  postal_code: "44630",
  geojson: '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}',
};

function make_deps(overrides: Partial<ImportNeighborhoodsDeps> = {}): {
  deps: ImportNeighborhoodsDeps;
  calls: NeighborhoodRow[][];
} {
  const calls: NeighborhoodRow[][] = [];
  const deps: ImportNeighborhoodsDeps = {
    get_secret: () => SECRET,
    import_batch: (rows) => {
      calls.push(rows);
      return Promise.resolve({ ok: true, inserted: rows.length, skipped: 0 });
    },
    ...overrides,
  };
  return { deps, calls };
}

function make_request(
  body: unknown,
  { method = "POST", secret = SECRET }: { method?: string; secret?: string | null } = {},
): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (secret !== null) headers.set("x-import-secret", secret);
  return new Request("http://localhost/import-neighborhoods", {
    method,
    headers,
    body: method === "POST"
      ? (typeof body === "string" ? body : JSON.stringify(body))
      : undefined,
  });
}

// ── EC-1/EC-2: método ────────────────────────────────────────────────────────

Deno.test("(EC-1) OPTIONS responde 200 (preflight)", async () => {
  const { deps } = make_deps();
  const res = await handler(make_request(null, { method: "OPTIONS" }), deps);
  assertEquals(res.status, 200);
});

Deno.test("(EC-2) GET responde 405", async () => {
  const { deps } = make_deps();
  const res = await handler(make_request(null, { method: "GET" }), deps);
  assertEquals(res.status, 405);
});

// ── EC-3/EC-4: gate por secret ───────────────────────────────────────────────

Deno.test("(EC-3) sin secret configurado en el env → 500 y NO llama import_batch", async () => {
  const { deps, calls } = make_deps({ get_secret: () => null });
  const res = await handler(make_request({ rows: [VALID_ROW] }), deps);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "CONFIG_MISSING");
  assertEquals(calls.length, 0);
});

Deno.test("(EC-4a) header x-import-secret ausente → 401", async () => {
  const { deps, calls } = make_deps();
  const res = await handler(make_request({ rows: [VALID_ROW] }, { secret: null }), deps);
  assertEquals(res.status, 401);
  assertEquals(calls.length, 0);
});

Deno.test("(EC-4b) header x-import-secret incorrecto → 401", async () => {
  const { deps, calls } = make_deps();
  const res = await handler(make_request({ rows: [VALID_ROW] }, { secret: "otro" }), deps);
  assertEquals(res.status, 401);
  assertEquals(calls.length, 0);
});

// ── EC-5..EC-8: payload ──────────────────────────────────────────────────────

Deno.test("(EC-5) body no-JSON → 400 INVALID_INPUT", async () => {
  const { deps } = make_deps();
  const res = await handler(make_request("esto no es json {"), deps);
  assertEquals(res.status, 400);
});

Deno.test("(EC-6a) body sin rows → 400", async () => {
  const { deps } = make_deps();
  const res = await handler(make_request({ otra_cosa: 1 }), deps);
  assertEquals(res.status, 400);
});

Deno.test("(EC-6b) rows vacío → 400", async () => {
  const { deps } = make_deps();
  const res = await handler(make_request({ rows: [] }), deps);
  assertEquals(res.status, 400);
});

Deno.test("(EC-7) lote de más de 2000 filas → 400", async () => {
  const { deps, calls } = make_deps();
  const rows = Array.from({ length: 2001 }, () => VALID_ROW);
  const res = await handler(make_request({ rows }), deps);
  assertEquals(res.status, 400);
  assertEquals(calls.length, 0);
});

Deno.test("(EC-8) fila sin geojson → 400 y no llama import_batch", async () => {
  const { deps, calls } = make_deps();
  const bad = { ...VALID_ROW, geojson: undefined };
  const res = await handler(make_request({ rows: [VALID_ROW, bad] }), deps);
  assertEquals(res.status, 400);
  assertEquals(calls.length, 0);
});

// ── EC-9: fallo del import ───────────────────────────────────────────────────

Deno.test("(EC-9) import_batch con error → 500 IMPORT_FAILED", async () => {
  const { deps } = make_deps({
    import_batch: () => Promise.resolve({ ok: false, message: "rpc reventó" }),
  });
  const res = await handler(make_request({ rows: [VALID_ROW] }), deps);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "IMPORT_FAILED");
});

// ── EC-10: camino feliz ──────────────────────────────────────────────────────

Deno.test("(EC-10) lote válido → 200 {inserted, skipped} y filas tal cual", async () => {
  const { deps, calls } = make_deps();
  const res = await handler(make_request({ rows: [VALID_ROW, VALID_ROW] }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { inserted: 2, skipped: 0 });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].length, 2);
  assertEquals(calls[0][0].source_key, VALID_ROW.source_key);
});
