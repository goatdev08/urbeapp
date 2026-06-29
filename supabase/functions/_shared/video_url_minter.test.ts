/**
 * Tests RED — subtarea 21.3
 * SUT: make_video_url_minter(client) en _shared/clients.ts
 *
 * Framework: Deno.test + @std/assert
 * Ejecutar: deno test --allow-net supabase/functions/_shared/video_url_minter.test.ts
 *
 * ─── ESTRATEGIA DE FAKES ─────────────────────────────────────────────────────
 * El SupabaseClient real se sustituye por un fake que:
 *   - Registra cada llamada a .from(table), .select(str), .in(), .eq(), .is()
 *     para verificar que la query tiene la shape EXACTA acordada (lección #8:
 *     mock-vs-prod — la shape de la query es el contrato de seguridad).
 *   - Es thenable: await builder resuelve { data, error } configurable.
 *   - Expone .storage.from(bucket).createSignedUrl(path, expiresIn) con
 *     responses configurables por path y registro de cada llamada.
 *
 * ─── EDGE CASES CUBIERTOS ────────────────────────────────────────────────────
 *
 * ### Happy path / shape de la query (lección #8 mock-vs-prod — crítico)
 * - query_usa_tabla_property_videos
 * - select_embebe_properties_inner_status
 * - filtro_in_property_ids_con_array_exacto
 * - filtro_eq_status_ready
 * - filtro_eq_properties_status_active  ← CLAVE de seguridad
 * - filtro_is_deleted_at_null
 *
 * ### createSignedUrl
 * - bucket_es_property_videos_con_guion
 * - expires_in_exactamente_3600
 * - happy_una_fila_devuelve_un_minted_video
 * - batch_tres_filas_devuelve_tres_minted_videos
 *
 * ### Exclusión (no romper el batch)
 * - storage_path_nulo_excluido_sin_llamar_storage
 * - create_signed_url_con_error_excluye_solo_esa_fila
 * - query_error_devuelve_array_vacio  ← decisión: batch degradado, no lanza
 * - property_ids_vacio_devuelve_array_vacio
 */

import { assertEquals, assertExists } from "@std/assert";
import { make_video_url_minter } from "./clients.ts";
import type { MintedVideo } from "../mint-video-url/types.ts";

// ── Tipos internos del fake ───────────────────────────────────────────────────

interface FilterCall {
  method: "in" | "eq" | "is";
  column: string;
  value: unknown;
}

interface StorageCall {
  bucket: string;
  path: string;
  expires_in: number;
}

interface VideoRow {
  id: string;
  property_id: string;
  storage_path: string | null;
}

// ── FakeQueryBuilder (thenable y chainable) ───────────────────────────────────

class FakeQueryBuilder {
  table: string;
  select_str = "";
  filters: FilterCall[] = [];
  private _data: VideoRow[] | null;
  private _error: { message: string } | null;

  constructor(
    table: string,
    data: VideoRow[] | null,
    error: { message: string } | null,
  ) {
    this.table = table;
    this._data = data;
    this._error = error;
  }

  select(str: string): this {
    this.select_str = str;
    return this;
  }

  in(column: string, value: unknown): this {
    this.filters.push({ method: "in", column, value });
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ method: "eq", column, value });
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push({ method: "is", column, value });
    return this;
  }

  // Hace el builder thenable: `await builder` ejecuta la "query"
  then<T>(
    onfulfilled: (
      value: { data: VideoRow[] | null; error: { message: string } | null },
    ) => T,
    onrejected?: (reason: unknown) => T,
  ): Promise<T> {
    return Promise.resolve({
      data: this._data,
      error: this._error,
    }).then(onfulfilled, onrejected);
  }
}

// ── FakeSupabaseClient ────────────────────────────────────────────────────────

function make_fake_client(opts: {
  query_data: VideoRow[] | null;
  query_error: { message: string } | null;
  /** map de storage_path → signed_url (null = simular error de storage) */
  storage_responses: Record<string, string | null>;
}): {
  client: unknown; // typed as unknown para pasar al adapter
  last_builder: FakeQueryBuilder | null;
  storage_calls: StorageCall[];
} {
  let last_builder: FakeQueryBuilder | null = null;
  const storage_calls: StorageCall[] = [];

  const client = {
    from(table: string): FakeQueryBuilder {
      const builder = new FakeQueryBuilder(
        table,
        opts.query_data,
        opts.query_error,
      );
      last_builder = builder;
      return builder;
    },
    storage: {
      from(bucket: string) {
        return {
          async createSignedUrl(
            path: string,
            expiresIn: number,
          ): Promise<{
            data: { signedUrl: string } | null;
            error: { message: string } | null;
          }> {
            storage_calls.push({ bucket, path, expires_in: expiresIn });
            const signed_url = opts.storage_responses[path];
            if (signed_url === null || signed_url === undefined) {
              return {
                data: null,
                error: { message: `storage error for path ${path}` },
              };
            }
            return {
              data: { signedUrl: signed_url },
              error: null,
            };
          },
        };
      },
    },
  };

  return { client, last_builder: null, storage_calls };
}

// helper: construye un wrapper que expone last_builder tras la llamada
function make_fake_client_tracked(opts: {
  query_data: VideoRow[] | null;
  query_error: { message: string } | null;
  storage_responses: Record<string, string | null>;
}): {
  get_last_builder(): FakeQueryBuilder | null;
  storage_calls: StorageCall[];
  client: unknown;
} {
  let _last_builder: FakeQueryBuilder | null = null;
  const storage_calls: StorageCall[] = [];

  const client = {
    from(table: string): FakeQueryBuilder {
      const builder = new FakeQueryBuilder(
        table,
        opts.query_data,
        opts.query_error,
      );
      _last_builder = builder;
      return builder;
    },
    storage: {
      from(bucket: string) {
        return {
          async createSignedUrl(
            path: string,
            expiresIn: number,
          ): Promise<{
            data: { signedUrl: string } | null;
            error: { message: string } | null;
          }> {
            storage_calls.push({ bucket, path, expires_in: expiresIn });
            const signed_url = opts.storage_responses[path];
            if (signed_url === null || signed_url === undefined) {
              return {
                data: null,
                error: { message: `storage error for path ${path}` },
              };
            }
            return { data: { signedUrl: signed_url }, error: null };
          },
        };
      },
    },
  };

  return {
    get_last_builder: () => _last_builder,
    storage_calls,
    client,
  };
}

// ── Factories de filas ────────────────────────────────────────────────────────

const PROP_ID_1 = "00000000-0000-0000-0001-000000000001";
const PROP_ID_2 = "00000000-0000-0000-0001-000000000002";
const PROP_ID_3 = "00000000-0000-0000-0001-000000000003";
const VIDEO_ID_1 = "00000000-0000-0000-0002-000000000001";
const VIDEO_ID_2 = "00000000-0000-0000-0002-000000000002";
const VIDEO_ID_3 = "00000000-0000-0000-0002-000000000003";

function make_video_row(overrides: Partial<VideoRow> = {}): VideoRow {
  return {
    id: VIDEO_ID_1,
    property_id: PROP_ID_1,
    storage_path: `${PROP_ID_1}/${VIDEO_ID_1}.mp4`,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — shape de la query (lección #8: estos son la barrera de seguridad)
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("query_usa_tabla_property_videos", async () => {
  const { client, get_last_builder } = make_fake_client_tracked({
    query_data: [make_video_row()],
    query_error: null,
    storage_responses: {
      [`${PROP_ID_1}/${VIDEO_ID_1}.mp4`]: "https://cdn.example.com/signed?tok=abc",
    },
  });

  const minter = make_video_url_minter(client as never);
  await minter.mint_signed_urls([PROP_ID_1]);

  const builder = get_last_builder();
  assertExists(builder, "El adapter debe llamar .from() en el client");
  assertEquals(
    builder.table,
    "property_videos",
    "La tabla debe ser 'property_videos', no otra",
  );
});

Deno.test("select_embebe_properties_inner_status", async () => {
  const { client, get_last_builder } = make_fake_client_tracked({
    query_data: [make_video_row()],
    query_error: null,
    storage_responses: {
      [`${PROP_ID_1}/${VIDEO_ID_1}.mp4`]: "https://cdn.example.com/signed?tok=abc",
    },
  });

  const minter = make_video_url_minter(client as never);
  await minter.mint_signed_urls([PROP_ID_1]);

  const builder = get_last_builder();
  assertExists(builder);
  const sel = builder.select_str;
  // El JOIN con properties debe ser !inner para que draft/closed devuelvan 0 filas
  assertEquals(
    sel.includes("properties!inner"),
    true,
    `select debe incluir 'properties!inner'; recibido: '${sel}'`,
  );
  assertEquals(
    sel.includes("storage_path"),
    true,
    `select debe incluir 'storage_path'; recibido: '${sel}'`,
  );
  assertEquals(
    sel.includes("property_id"),
    true,
    `select debe incluir 'property_id'; recibido: '${sel}'`,
  );
  // 'id' puede aparecer como parte de property_id; validamos que el string de select lo incluya
  // Verificamos con una regex separada para evitar falso positivo de 'property_id'
  const has_id = /\bid\b/.test(sel) || sel.startsWith("id") || sel.includes(", id") || sel.includes("id,");
  assertEquals(
    has_id,
    true,
    `select debe incluir la columna 'id' del video; recibido: '${sel}'`,
  );
});

Deno.test("filtro_in_property_ids_con_array_exacto", async () => {
  const property_ids = [PROP_ID_1, PROP_ID_2];
  const { client, get_last_builder } = make_fake_client_tracked({
    query_data: [],
    query_error: null,
    storage_responses: {},
  });

  const minter = make_video_url_minter(client as never);
  await minter.mint_signed_urls(property_ids);

  const builder = get_last_builder();
  assertExists(builder);

  const in_filter = builder.filters.find(
    (f) => f.method === "in" && f.column === "property_id",
  );
  assertExists(
    in_filter,
    "Debe existir un filtro .in('property_id', ...) en la query",
  );
  assertEquals(
    in_filter!.value,
    property_ids,
    ".in('property_id') debe recibir exactamente el array de property_ids sin mutaciones",
  );
});

Deno.test("filtro_eq_status_ready", async () => {
  const { client, get_last_builder } = make_fake_client_tracked({
    query_data: [],
    query_error: null,
    storage_responses: {},
  });

  const minter = make_video_url_minter(client as never);
  await minter.mint_signed_urls([PROP_ID_1]);

  const builder = get_last_builder();
  assertExists(builder);

  const ready_filter = builder.filters.find(
    (f) => f.method === "eq" && f.column === "status" && f.value === "ready",
  );
  assertExists(
    ready_filter,
    "Debe existir .eq('status','ready') para excluir videos no procesados (processing/failed)",
  );
});

Deno.test("filtro_eq_properties_status_active", async () => {
  // CLAVE DE SEGURIDAD: service_role bypassa RLS; este filtro es la única
  // barrera que impide mintar URLs de propiedades draft/paused/closed.
  const { client, get_last_builder } = make_fake_client_tracked({
    query_data: [],
    query_error: null,
    storage_responses: {},
  });

  const minter = make_video_url_minter(client as never);
  await minter.mint_signed_urls([PROP_ID_1]);

  const builder = get_last_builder();
  assertExists(builder);

  const active_filter = builder.filters.find(
    (f) =>
      f.method === "eq" &&
      f.column === "properties.status" &&
      f.value === "active",
  );
  assertExists(
    active_filter,
    "CRÍTICO: debe existir .eq('properties.status','active') — sin este filtro, " +
      "service_role devolvería videos de propiedades draft/paused/closed",
  );
});

Deno.test("filtro_is_deleted_at_null", async () => {
  const { client, get_last_builder } = make_fake_client_tracked({
    query_data: [],
    query_error: null,
    storage_responses: {},
  });

  const minter = make_video_url_minter(client as never);
  await minter.mint_signed_urls([PROP_ID_1]);

  const builder = get_last_builder();
  assertExists(builder);

  const soft_delete_filter = builder.filters.find(
    (f) => f.method === "is" && f.column === "deleted_at" && f.value === null,
  );
  assertExists(
    soft_delete_filter,
    "Debe existir .is('deleted_at', null) para excluir videos soft-deleted",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — createSignedUrl
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("bucket_es_property_videos_con_guion", async () => {
  const path = `${PROP_ID_1}/${VIDEO_ID_1}.mp4`;
  const { client, storage_calls } = make_fake_client_tracked({
    query_data: [make_video_row({ storage_path: path })],
    query_error: null,
    storage_responses: { [path]: "https://cdn.example.com/signed?tok=abc" },
  });

  const minter = make_video_url_minter(client as never);
  await minter.mint_signed_urls([PROP_ID_1]);

  assertEquals(
    storage_calls.length > 0,
    true,
    "createSignedUrl debe ser llamado para la fila válida",
  );
  assertEquals(
    storage_calls[0].bucket,
    "property-videos",
    "El bucket debe ser 'property-videos' (con guion), no 'property_videos' ni otro",
  );
});

Deno.test("expires_in_exactamente_3600", async () => {
  const path = `${PROP_ID_1}/${VIDEO_ID_1}.mp4`;
  const { client, storage_calls } = make_fake_client_tracked({
    query_data: [make_video_row({ storage_path: path })],
    query_error: null,
    storage_responses: { [path]: "https://cdn.example.com/signed?tok=abc" },
  });

  const minter = make_video_url_minter(client as never);
  await minter.mint_signed_urls([PROP_ID_1]);

  assertEquals(
    storage_calls.length > 0,
    true,
    "createSignedUrl debe ser llamado",
  );
  assertEquals(
    storage_calls[0].expires_in,
    3600,
    "expiresIn debe ser exactamente 3600 segundos (1 hora); no 3599, no 7200",
  );
});

Deno.test("happy_una_fila_devuelve_un_minted_video", async () => {
  const path = `${PROP_ID_1}/${VIDEO_ID_1}.mp4`;
  const expected_signed_url = "https://cdn.example.com/signed?tok=abc123";
  const { client } = make_fake_client_tracked({
    query_data: [
      make_video_row({
        id: VIDEO_ID_1,
        property_id: PROP_ID_1,
        storage_path: path,
      }),
    ],
    query_error: null,
    storage_responses: { [path]: expected_signed_url },
  });

  const minter = make_video_url_minter(client as never);
  const result: MintedVideo[] = await minter.mint_signed_urls([PROP_ID_1]);

  assertEquals(result.length, 1, "Una fila válida debe producir 1 MintedVideo");
  assertEquals(
    result[0].property_id,
    PROP_ID_1,
    "MintedVideo.property_id debe corresponder a la fila",
  );
  assertEquals(
    result[0].video_id,
    VIDEO_ID_1,
    "MintedVideo.video_id debe ser el id de la fila (row.id)",
  );
  assertEquals(
    result[0].signed_url,
    expected_signed_url,
    "MintedVideo.signed_url debe ser el valor de signedUrl retornado por storage",
  );
});

Deno.test("batch_tres_filas_devuelve_tres_minted_videos", async () => {
  const path1 = `${PROP_ID_1}/${VIDEO_ID_1}.mp4`;
  const path2 = `${PROP_ID_2}/${VIDEO_ID_2}.mp4`;
  const path3 = `${PROP_ID_3}/${VIDEO_ID_3}.mp4`;
  const { client, storage_calls } = make_fake_client_tracked({
    query_data: [
      make_video_row({ id: VIDEO_ID_1, property_id: PROP_ID_1, storage_path: path1 }),
      make_video_row({ id: VIDEO_ID_2, property_id: PROP_ID_2, storage_path: path2 }),
      make_video_row({ id: VIDEO_ID_3, property_id: PROP_ID_3, storage_path: path3 }),
    ],
    query_error: null,
    storage_responses: {
      [path1]: "https://cdn.example.com/signed?tok=aaa",
      [path2]: "https://cdn.example.com/signed?tok=bbb",
      [path3]: "https://cdn.example.com/signed?tok=ccc",
    },
  });

  const minter = make_video_url_minter(client as never);
  const result = await minter.mint_signed_urls([PROP_ID_1, PROP_ID_2, PROP_ID_3]);

  assertEquals(result.length, 3, "Tres filas válidas deben producir 3 MintedVideo");
  assertEquals(
    storage_calls.length,
    3,
    "createSignedUrl debe ser llamado exactamente 3 veces (una por fila)",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — Exclusión (no romper el batch)
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("storage_path_nulo_excluido_sin_llamar_storage", async () => {
  // Una fila con storage_path=null (video subido pero sin path registrado aún)
  // debe ser silenciosamente excluida; NO debe llamar createSignedUrl.
  const { client, storage_calls } = make_fake_client_tracked({
    query_data: [
      make_video_row({ id: VIDEO_ID_1, property_id: PROP_ID_1, storage_path: null }),
    ],
    query_error: null,
    storage_responses: {},
  });

  const minter = make_video_url_minter(client as never);
  const result = await minter.mint_signed_urls([PROP_ID_1]);

  assertEquals(
    result.length,
    0,
    "Fila con storage_path null debe ser excluida del resultado",
  );
  assertEquals(
    storage_calls.length,
    0,
    "createSignedUrl NO debe ser llamado para filas con storage_path null",
  );
});

Deno.test("create_signed_url_con_error_excluye_solo_esa_fila", async () => {
  // Si storage devuelve error para 1 fila, esa fila se excluye
  // pero las demás siguen siendo procesadas (batch no se rompe).
  const path_ok = `${PROP_ID_2}/${VIDEO_ID_2}.mp4`;
  const path_error = `${PROP_ID_1}/${VIDEO_ID_1}.mp4`;
  const { client, storage_calls } = make_fake_client_tracked({
    query_data: [
      make_video_row({ id: VIDEO_ID_1, property_id: PROP_ID_1, storage_path: path_error }),
      make_video_row({ id: VIDEO_ID_2, property_id: PROP_ID_2, storage_path: path_ok }),
    ],
    query_error: null,
    // path_error → null simula error de storage; path_ok → URL válida
    storage_responses: {
      [path_error]: null, // null = simular error (ver make_fake_client_tracked)
      [path_ok]: "https://cdn.example.com/signed?tok=bbb",
    },
  });

  const minter = make_video_url_minter(client as never);
  const result = await minter.mint_signed_urls([PROP_ID_1, PROP_ID_2]);

  assertEquals(
    result.length,
    1,
    "Solo la fila con URL válida debe aparecer en el resultado",
  );
  assertEquals(
    result[0].property_id,
    PROP_ID_2,
    "La fila exitosa debe ser la del PROP_ID_2",
  );
  assertEquals(
    storage_calls.length,
    2,
    "createSignedUrl debe ser llamado para ambas filas (el error lo maneja el adapter, no lo evita)",
  );
});

Deno.test("query_error_devuelve_array_vacio", async () => {
  // Decisión de dominio: si la query PostgREST falla (red, timeout, etc.),
  // el adapter devuelve [] sin lanzar excepción.
  // Justificación: el handler del feed no debe crashear por un error de storage
  // transitorio; el cliente simplemente no verá videos en ese batch.
  const { client } = make_fake_client_tracked({
    query_data: null,
    query_error: { message: "connection timeout" },
    storage_responses: {},
  });

  const minter = make_video_url_minter(client as never);
  // NO debe lanzar
  const result = await minter.mint_signed_urls([PROP_ID_1]);

  assertEquals(
    result.length,
    0,
    "Error en la query PostgREST debe devolver [] (batch degradado, no lanza)",
  );
});

Deno.test("property_ids_vacio_devuelve_array_vacio", async () => {
  // Defensa: si se llama con [] (feed vacío o bug del caller),
  // devuelve [] sin invocar la query ni storage.
  const { client, get_last_builder, storage_calls } = make_fake_client_tracked({
    query_data: [],
    query_error: null,
    storage_responses: {},
  });

  const minter = make_video_url_minter(client as never);
  const result = await minter.mint_signed_urls([]);

  assertEquals(
    result.length,
    0,
    "property_ids vacío debe devolver []",
  );
  assertEquals(
    storage_calls.length,
    0,
    "No debe llamar storage cuando property_ids está vacío",
  );
  // Idealmente ni siquiera hace la query DB, pero como mínimo el resultado es []
  // Si el adapter sí llama .from() con array vacío, el resultado debe seguir siendo [].
  void get_last_builder; // presencia de builder opcional; lo que importa es result === []
});
