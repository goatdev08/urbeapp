// supabase/functions/_shared/property_field_whitelist.test.ts
// Tests RED — subtarea 218.4 (adopta #124 REDEFINIDO por decisión de usuario
// 2026-08-24: TEST DE GUARDIA TS↔SQL sin migración de datos).
// Framework: Deno.test + @std/assert
// Runner: cd supabase/functions && deno test --allow-env --allow-net \
//         --allow-read --config deno.json _shared/property_field_whitelist.test.ts
//
// SEAM bajo test:
//   (a) el whitelist TS exportado `EDITABLE_PROPERTY_FIELDS`
//       (_shared/property_field_whitelist.ts) — contrato público del módulo.
//   (b) el conjunto REAL de columnas que la RPC `moderate_property_atomic`
//       aplica sobre `properties`, leído directamente de la migración SQL
//       real (fuente de verdad independiente del módulo TS bajo (a)).
//   (c) el conjunto REAL de campos que edit-property/handler.ts (el
//       contrato HTTP exportado `handler`, vía DI de fakes — mismo patrón
//       que edit-property/handler.test.ts) efectivamente manda como
//       `changed_fields` al invocar revisionUpserter.upsert.
//
// El bug que esto blinda (brief original #124, redefinido en 218.4): hoy el
// whitelist vive DUPLICADO — inline en edit-property (los keys que
// parse_edit_property_input construye) y en el SQL de la RPC (los CASE WHEN
// p_changed_fields ? '<col>'). Si alguien agrega un campo editable en un
// lado y olvida el otro, aprobar una revisión NO aplica el campo nuevo (o
// la RPC intenta aplicar un campo que edit-property nunca manda) — sin que
// ningún test existente lo detecte, porque ambas suites (handler.test.ts de
// edit-property y las pgTAP de la RPC) verifican cada lado por separado,
// nunca el uno CONTRA el otro.
//
// Resolución de las DOS (o más) migraciones que definen moderate_property_atomic
// (20260809000007 y 20260815000005 hoy): cualquiera de ellas es un
// `create or replace function` con la MISMA firma → en Postgres eso
// REEMPLAZA el cuerpo completo, no lo extiende (no hay "unión" de ambas
// definiciones). El parser DESCUBRE candidatos por CONTENIDO — cualquier
// .sql de supabase/migrations/ que contenga
// `create or replace function [public.]moderate_property_atomic(` — NO por
// el nombre del archivo (hardening post-guardian, 218.4: un mutante
// demostró que una migración futura con nombre distinto, p.ej.
// `add_parking_field.sql`, redefiniendo la función quedaba invisible si el
// discovery solo miraba `/moderate_property_atomic.*\.sql$/` en el nombre).
// De los candidatos encontrados por contenido, se toma la ÚLTIMA por el
// prefijo YYYYMMDDHHMMSS del NOMBRE (que sí ordena cronológicamente, es la
// convención real de las migraciones de Supabase) — igual que el catálogo
// real de Postgres tras aplicar todas las migraciones en orden.
//
// ─── EDGE CASES (RED) ──────────────────────────────────────────────────────
//
// ### Happy path / guardia principal
// - EC-1: EDITABLE_PROPERTY_FIELDS (TS) == conjunto de columnas que la RPC
//   moderate_property_atomic aplica en SQL (parseado de la ÚLTIMA
//   definición real, 20260815000005) — diff legible en ambas direcciones
//   (faltan_en_ts / sobran_en_ts) en un solo assertEquals.
// - EC-2: el conjunto de campos que edit-property REALMENTE manda como
//   `changed_fields` (capturado invocando el `handler` real con fakes DI,
//   payload completo, forzando el camino de revisión) == EDITABLE_PROPERTY_FIELDS
//   — diff bidireccional (faltan_en_whitelist / sobran_en_whitelist).
//
// ### Sanity / boundary
// - EC-3: EDITABLE_PROPERTY_FIELDS no está vacío y tiene el tamaño real
//   (16 columnas, contadas a mano en la RPC 20260815000005).
// - EC-4: EDITABLE_PROPERTY_FIELDS coincide con el snapshot LITERAL leído a
//   mano de la migración 20260815000005 — fuente independiente del parser
//   regex de EC-1 (si el parser tuviera un bug, este test lo sigue cazando).

import { assertEquals } from "@std/assert";
import { EDITABLE_PROPERTY_FIELDS } from "./property_field_whitelist.ts";
import { handler } from "../edit-property/handler.ts";
import type {
  AgencyRoleResolver,
  CallerVerifier,
  CurrentPropertySnapshot,
  DirectPropertyUpdater,
  DirectUpdateResult,
  EditPropertyDeps,
  EditPropertyInput,
  PropertyFetchResult,
  PropertyFetcher,
  RevisionUpsertResult,
  RevisionUpserter,
} from "../edit-property/types.ts";

// ── EC-1: parseo de la RPC real ─────────────────────────────────────────────

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);

// Descubrimiento por CONTENIDO (hardening post-guardian, 218.4): matchea
// `create or replace function`, `public.` opcional, `moderate_property_atomic`
// y el paréntesis de apertura — tolerante a espacios/saltos de línea entre
// tokens (case-insensitive: Postgres no distingue mayúsculas en identifiers
// sin comillas).
const DEFINES_MODERATE_PROPERTY_ATOMIC =
  /create\s+or\s+replace\s+function\s+(?:public\.)?moderate_property_atomic\s*\(/i;

async function extract_rpc_changed_fields_columns(): Promise<Set<string>> {
  const candidatos: { name: string; sql: string }[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const sql = await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR));
    if (DEFINES_MODERATE_PROPERTY_ATOMIC.test(sql)) {
      candidatos.push({ name: entry.name, sql });
    }
  }
  if (candidatos.length === 0) {
    throw new Error(
      "ninguna migración en supabase/migrations/ define moderate_property_atomic " +
        "(create or replace function) — este test depende de leer el SQL real, no puede seguir sin él",
    );
  }
  // El prefijo YYYYMMDDHHMMSS del NOMBRE ordena cronológicamente; la última
  // es la definición VIGENTE (create or replace reemplaza, no extiende). El
  // discovery ya no depende del nombre — el orden sí, porque es la
  // convención real (timestamp) de las migraciones de Supabase.
  candidatos.sort((a, b) => a.name.localeCompare(b.name));
  const ultima = candidatos[candidatos.length - 1];

  const columnas = new Set<string>();
  const re = /p_changed_fields\s*\?\s*'([a-z_]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ultima.sql)) !== null) {
    columnas.add(m[1]);
  }
  return columnas;
}

Deno.test(
  "EC-1: EDITABLE_PROPERTY_FIELDS coincide EXACTO con las columnas que moderate_property_atomic aplica en SQL (última definición real, 20260815000005)",
  async () => {
    const sql_fields = await extract_rpc_changed_fields_columns();
    const ts_fields = new Set(EDITABLE_PROPERTY_FIELDS);

    const faltan_en_ts = [...sql_fields].filter((f) => !ts_fields.has(f)).sort();
    const sobran_en_ts = [...ts_fields].filter((f) => !sql_fields.has(f)).sort();

    assertEquals(
      { faltan_en_ts, sobran_en_ts },
      { faltan_en_ts: [], sobran_en_ts: [] },
      "EDITABLE_PROPERTY_FIELDS debe ser EXACTAMENTE el conjunto de columnas que la RPC aplica",
    );
  },
);

// ── EC-2: lo que edit-property REALMENTE manda (seam = handler HTTP) ───────

const OWNER_ID = "00000000-0000-0000-0006-000000000201";
const PROPERTY_ID = "00000000-0000-0000-0006-000000000210";

const CURRENT: CurrentPropertySnapshot = {
  id: PROPERTY_ID,
  owner_user_id: OWNER_ID,
  agency_id: null,
  operation_type: "rent",
  property_type: "departamento",
  price: 12500,
  address: "Av. Insurgentes Sur 1234, CDMX",
  location: "SRID=4326;POINT(-99.1731 19.3737)",
  description: "Depa amplio y luminoso, cerca del metro",
};

// Payload COMPLETO — incluye TODOS los campos opcionales (location,
// built_square_meters, half_bathrooms, currency) para capturar el conjunto
// MÁXIMO de claves que edit-property reconoce. `price` difiere del snapshot
// actual → dispara el camino de revisión (§15.5), que es donde
// revisionUpserter.upsert recibe el `changed_fields` completo.
const FULL_INPUT: EditPropertyInput = {
  property_id: PROPERTY_ID,
  operation_type: "rent",
  property_type: "departamento",
  price: CURRENT.price + 500, // crítico: dispara mode='revision'
  bedrooms: 2,
  bathrooms: 1,
  square_meters: 75,
  address: CURRENT.address,
  location: CURRENT.location ?? undefined,
  price_visible: true,
  pet_friendly: false,
  allows_no_guarantor: false,
  student_friendly: false,
  description: CURRENT.description,
  built_square_meters: 80,
  half_bathrooms: 1,
  currency: "MXN",
};

function post_auth(body: unknown): Request {
  return new Request("http://localhost/edit-property", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer fake-jwt" },
    body: JSON.stringify(body),
  });
}

Deno.test(
  "EC-2: el conjunto de campos que edit-property REALMENTE envía como changed_fields coincide EXACTO con EDITABLE_PROPERTY_FIELDS",
  async () => {
    const capturado: { changed_fields: EditPropertyInput }[] = [];

    const deps: EditPropertyDeps = {
      callerVerifier: {
        verify_caller: () =>
          Promise.resolve({ ok: true, user_id: OWNER_ID, is_admin: false }),
      } as CallerVerifier,
      propertyFetcher: {
        fetch: () =>
          Promise.resolve(
            { ok: true, property: CURRENT } as PropertyFetchResult,
          ),
      } as PropertyFetcher,
      directPropertyUpdater: {
        apply: () => Promise.resolve({ ok: true } as DirectUpdateResult),
      } as DirectPropertyUpdater,
      revisionUpserter: {
        upsert: (
          _property_id: string,
          _submitted_by: string,
          changed_fields: EditPropertyInput,
        ) => {
          capturado.push({ changed_fields });
          return Promise.resolve(
            { ok: true, revision_id: "00000000-0000-0000-0006-000000000220" } as RevisionUpsertResult,
          );
        },
      } as RevisionUpserter,
      agencyRoleResolver: {
        resolve: () => Promise.resolve(null),
      } as AgencyRoleResolver,
    };

    const res = await handler(post_auth(FULL_INPUT), deps);

    // Sanity del escenario: SÍ debe haber tomado el camino de revisión
    // (si esto falla, el resto del test no dice nada sobre el whitelist).
    assertEquals(res.status, 200);
    assertEquals(
      capturado.length,
      1,
      "revisionUpserter.upsert debió llamarse exactamente una vez (price cambió, es crítico)",
    );

    const campos_reales = new Set(
      Object.keys(capturado[0].changed_fields).filter((k) => k !== "property_id"),
    );
    const ts_whitelist = new Set(EDITABLE_PROPERTY_FIELDS);

    const faltan_en_whitelist = [...campos_reales].filter((f) => !ts_whitelist.has(f)).sort();
    const sobran_en_whitelist = [...ts_whitelist].filter((f) => !campos_reales.has(f)).sort();

    assertEquals(
      { faltan_en_whitelist, sobran_en_whitelist },
      { faltan_en_whitelist: [], sobran_en_whitelist: [] },
      "EDITABLE_PROPERTY_FIELDS debe ser EXACTAMENTE lo que edit-property manda como changed_fields",
    );
  },
);

// ── EC-3 / EC-4: sanity ─────────────────────────────────────────────────────

Deno.test(
  "EC-3: EDITABLE_PROPERTY_FIELDS no está vacío y tiene el tamaño real (16 columnas, contadas a mano en la RPC 20260815000005)",
  () => {
    assertEquals(EDITABLE_PROPERTY_FIELDS.length, 16);
  },
);

// Snapshot literal — leído a mano de supabase/migrations/20260815000005_
// moderate_property_atomic_wizard_fields.sql (la definición vigente).
// Fuente INDEPENDIENTE del parser regex de EC-1: si el parser tuviera un
// bug (p.ej. un typo en la regex que se come una columna), este test sigue
// cazando la divergencia real.
const COLUMNAS_CONOCIDAS_20260815000005 = [
  "operation_type",
  "property_type",
  "price",
  "bedrooms",
  "bathrooms",
  "square_meters",
  "built_square_meters",
  "half_bathrooms",
  "currency",
  "address",
  "location",
  "price_visible",
  "pet_friendly",
  "allows_no_guarantor",
  "student_friendly",
  "description",
] as const;

Deno.test(
  "EC-4: EDITABLE_PROPERTY_FIELDS coincide con el snapshot literal leído a mano de la migración 20260815000005",
  () => {
    assertEquals(
      new Set(EDITABLE_PROPERTY_FIELDS),
      new Set(COLUMNAS_CONOCIDAS_20260815000005),
    );
  },
);
