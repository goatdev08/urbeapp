#!/usr/bin/env node
/**
 * upload-neighborhoods.mjs — sube un estado DCAH al REMOTO vía la EF
 * import-neighborhoods (tarea #157.4). Camino sin contraseña de DB: la EF corre
 * con service_role inyectado y llama la RPC import_neighborhoods_batch.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_ANON_KEY=<anon> \
 *   IMPORT_SECRET=<secret> \
 *   node upload-neighborhoods.mjs <estado.geojson>
 *
 * Lotes de 500 filas (~400 KB) con 3 reintentos y backoff. Idempotente: el
 * upsert por source_key hace que re-correr un estado sea inocuo.
 */

import { readFileSync } from 'node:fs';
import { feature_to_row } from './prepare-neighborhoods.mjs';

const BATCH_SIZE = 500;
const RETRIES = 3;

const { SUPABASE_URL, SUPABASE_ANON_KEY, IMPORT_SECRET } = process.env;
const [, , in_path] = process.argv;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !IMPORT_SECRET || !in_path) {
  console.error('Uso: SUPABASE_URL=… SUPABASE_ANON_KEY=… IMPORT_SECRET=… node upload-neighborhoods.mjs <estado.geojson>');
  process.exit(1);
}

const endpoint = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/import-neighborhoods`;
const collection = JSON.parse(readFileSync(in_path, 'utf8'));

const rows = [];
let invalid = 0;
for (const feature of collection.features) {
  const row = feature_to_row(feature);
  if (row) rows.push(row);
  else invalid += 1;
}

console.error(`upload: ${rows.length} filas válidas (${invalid} inválidas) en lotes de ${BATCH_SIZE}`);

async function post_batch(batch, attempt = 1) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'x-import-secret': IMPORT_SECRET,
    },
    body: JSON.stringify({ rows: batch }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (attempt < RETRIES) {
      console.error(`  reintento ${attempt + 1}/${RETRIES} (HTTP ${res.status}): ${text.slice(0, 200)}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      return post_batch(batch, attempt + 1);
    }
    throw new Error(`lote falló tras ${RETRIES} intentos: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  return res.json();
}

let inserted = 0;
let skipped = 0;
for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  const batch = rows.slice(i, i + BATCH_SIZE);
  const result = await post_batch(batch);
  inserted += result.inserted;
  skipped += result.skipped;
  console.error(`  lote ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(rows.length / BATCH_SIZE)}: +${result.inserted} (skip ${result.skipped})`);
}

console.error(`upload: TOTAL inserted=${inserted} skipped=${skipped}`);
if (inserted + skipped !== rows.length) {
  console.error('⚠️ el total no cuadra con las filas enviadas');
  process.exit(2);
}
