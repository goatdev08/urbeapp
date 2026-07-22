/**
 * Tests RED — subtareas 21.3 (legacy Supabase Storage) y 68.6 (dual-ref Stream HLS)
 * SUT: make_video_url_minter(client, hlsConfig?) en _shared/clients.ts
 *
 * Framework: Deno.test + @std/assert + jose (verificación de JWT RS256)
 * Ejecutar:
 *   cd supabase/functions && deno test --allow-env --allow-net --allow-read \
 *     --config deno.json _shared/video_url_minter.test.ts
 *
 * ─── ESTRATEGIA DE FAKES ─────────────────────────────────────────────────────
 * El SupabaseClient real se sustituye por un fake que:
 *   - Registra cada llamada a .from(table), .select(str), .in(), .eq(), .is()
 *     para verificar que la query tiene la shape EXACTA acordada (lección #8:
 *     mock-vs-prod — la shape de la query es el contrato de seguridad).
 *   - Es thenable: await builder resuelve { data, error } configurable.
 *   - Expone .storage.from(bucket).createSignedUrl(path, expiresIn) con
 *     responses configurables por path y registro de cada llamada.
 * Para la rama Stream (68.6) se genera una llave RSA real de prueba con
 * crypto.subtle.generateKey vía jose (`generateKeyPair("RS256")`), se exporta a
 * JWK y se inyecta como `hlsConfig.streamSigningJwk` (mismo encoding que el
 * secret real: JSON → base64 estándar). El JWT emitido se verifica con la
 * pública de prueba — nunca se mockea el firmado en sí (frontera de confianza).
 *
 * ─── EDGE CASES CUBIERTOS ────────────────────────────────────────────────────
 *
 * ### Happy path / shape de la query (lección #8 mock-vs-prod — crítico)
 * - query_usa_tabla_property_videos
 * - select_embebe_properties_inner_status
 * - select_incluye_cloudflare_uid_para_dual_ref  ← NUEVO (68.6)
 * - filtro_in_property_ids_con_array_exacto
 * - filtro_eq_status_ready
 * - filtro_eq_properties_status_active  ← CLAVE de seguridad
 * - filtro_is_deleted_at_null
 *
 * ### createSignedUrl (legacy Supabase Storage)
 * - bucket_es_property_videos_con_guion
 * - expires_in_exactamente_3600
 * - happy_una_fila_devuelve_un_minted_video
 * - batch_tres_filas_devuelve_tres_minted_videos
 *
 * ### Exclusión (no romper el batch) — legacy
 * - storage_path_nulo_excluido_sin_llamar_storage
 * - create_signed_url_con_error_excluye_solo_esa_fila
 * - query_error_devuelve_array_vacio  ← decisión: batch degradado, no lanza
 * - property_ids_vacio_devuelve_array_vacio
 *
 * ### Dual-ref Stream HLS (68.6, NUEVO)
 * - fila_con_cloudflare_uid_devuelve_url_hls_firmada_con_jwt_valido
 * - fila_sin_cloudflare_uid_con_storage_path_sigue_usando_supabase_storage_signed_url
 * - exp_del_jwt_respeta_signed_url_ttl_seconds_inyectado
 * - stream_row_sin_hls_config_inyectado_se_excluye_del_batch_sin_lanzar
 * - stream_row_con_jwk_invalido_se_excluye_solo_esa_fila_legacy_no_se_rompe
 * - batch_mixto_stream_y_legacy_devuelve_ambas_correctamente_firmadas
 * - precedencia_cloudflare_uid_sobre_storage_path_cuando_fila_tiene_ambos
 *
 * ### Poster URL — portada firmada (subtarea 68.15, NUEVO)
 * - poster_url_stream_thumbnail_pct_50_duration_92_da_time_46_0s_y_token_valido
 * - poster_url_stream_thumbnail_pct_null_usa_default_50_duration_80_da_time_40_0s
 * - poster_url_stream_thumbnail_pct_25_duration_8_da_time_2_0s
 * - poster_url_stream_duration_null_omite_time_pero_token_presente
 * - poster_url_null_en_fila_legacy_storage
 * - poster_url_comparte_dominio_con_signed_url_hls
 * - campos_existentes_property_id_video_id_signed_url_siguen_intactos_con_posterUrl
 */

import { assertEquals, assertExists, assertMatch, assertNotEquals } from "@std/assert";
import { exportJWK, generateKeyPair, importJWK, type JWK, jwtVerify } from "jose";
import { make_video_url_minter } from "./clients.ts";
import type { HlsSignerConfig, MintedVideo } from "../mint-video-url/types.ts";

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
  cloudflare_uid?: string | null;
  /** % (0-100) del timestamp del thumbnail respecto a duration_seconds; null → default 50 (68.15) */
  thumbnail_pct?: number | null;
  /** Duración del video en segundos; null → posterUrl sin '?time=' (68.15) */
  duration_seconds?: number | null;
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
    cloudflare_uid: null,
    thumbnail_pct: null,
    duration_seconds: null,
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

Deno.test("select_incluye_cloudflare_uid_para_dual_ref", async () => {
  // 68.6: el select debe traer cloudflare_uid además de storage_path para que
  // el minter pueda decidir la rama dual-ref (Stream vs Supabase Storage).
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
  assertEquals(
    builder.select_str.includes("cloudflare_uid"),
    true,
    `select debe incluir 'cloudflare_uid' para la rama dual-ref; recibido: '${builder.select_str}'`,
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

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — Dual-ref Stream HLS (subtarea 68.6)
// ─────────────────────────────────────────────────────────────────────────────
//
// Fuente de verdad del formato: subtask 68.6 (Taskmaster) + docs/ADR Cloudflare
// Stream. JWT: header { alg: RS256, kid }, payload { sub: cloudflare_uid, kid, exp }.
//
// ⚠️ CONTRATO CORREGIDO (verificado en vivo 2026-07-22, prueba E2E contra un video
// real con requireSignedURLs=true): el TOKEN va EN EL PATH, sustituyendo al uid —
// NUNCA como query param. `.../<uid>/manifest/video.m3u8?token=<JWT>` → 401
// unauthorized; `.../<TOKEN>/manifest/video.m3u8` → 200. El uid ya viaja dentro
// del JWT (claim `sub`), por eso no se repite en la ruta.
// URL: https://customer-<CODE>.cloudflarestream.com/<TOKEN>/manifest/video.m3u8
//   (o la variante videodelivery.net/<TOKEN>/manifest/video.m3u8).

const TEST_KEY_ID = "test-stream-signing-key-01";
const DEFAULT_TTL_SECONDS = 14400; // valor real sembrado en app_config (signed_url_ttl_seconds)
const CLOUDFLARE_UID_1 = "cf-uid-0000000000000000000001";
const CLOUDFLARE_UID_2 = "cf-uid-0000000000000000000002";

// Regex de invariantes de la URL HLS: NO hardcodea un customer code inventado;
// acepta ambos dominios legítimos de Stream (customer subdomain o videodelivery.net).
// El único segmento de path capturado es el TOKEN (el uid ya no viaja en la URL,
// solo dentro del JWT como claim 'sub') — sin query string alguno.
const HLS_URL_RE =
  /^https:\/\/(?:customer-[a-z0-9]+\.cloudflarestream\.com|(?:[a-z0-9.-]*\.)?videodelivery\.net)\/([^/]+)\/manifest\/video\.m3u8$/i;

/** Genera un par de llaves RSA de prueba (RS256) y exporta la privada como JWK. */
async function generate_test_signing_key(): Promise<{
  public_jwk: JWK;
  private_jwk_base64: string;
}> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const private_jwk = await exportJWK(privateKey);
  private_jwk.kid = TEST_KEY_ID;
  private_jwk.alg = "RS256";
  private_jwk.use = "sig";
  const public_jwk = await exportJWK(publicKey);

  return {
    public_jwk,
    // Mismo encoding que el secret real STREAM_SIGNING_JWK: JSON → base64 estándar.
    private_jwk_base64: btoa(JSON.stringify(private_jwk)),
  };
}

function make_hls_config(
  private_jwk_base64: string,
  overrides: Partial<HlsSignerConfig> = {},
): HlsSignerConfig {
  return {
    streamSigningKeyId: TEST_KEY_ID,
    streamSigningJwk: private_jwk_base64,
    signedUrlTtlSeconds: DEFAULT_TTL_SECONDS,
    ...overrides,
  };
}

/**
 * Extrae { token } del path de una URL HLS firmada; lanza si no matchea el patrón.
 * El uid YA NO viaja en la URL (contrato corregido 2026-07-22): solo se verifica
 * decodificando el JWT (claim 'sub'), nunca parseando la ruta.
 */
function parse_hls_url(url: string): { token: string } {
  const match = HLS_URL_RE.exec(url);
  if (!match) {
    throw new Error(`signed_url no matchea el formato HLS de Stream: '${url}'`);
  }
  return { token: match[1] };
}

Deno.test("fila_con_cloudflare_uid_devuelve_url_hls_firmada_con_jwt_valido", async () => {
  const { public_jwk, private_jwk_base64 } = await generate_test_signing_key();
  const hls_config = make_hls_config(private_jwk_base64);

  const { client } = make_fake_client_tracked({
    query_data: [
      make_video_row({
        id: VIDEO_ID_1,
        property_id: PROP_ID_1,
        storage_path: null,
        cloudflare_uid: CLOUDFLARE_UID_1,
      }),
    ],
    query_error: null,
    storage_responses: {},
  });

  const minter = make_video_url_minter(client as never, hls_config);
  const result = await minter.mint_signed_urls([PROP_ID_1]);

  assertEquals(
    result.length,
    1,
    "Una fila con cloudflare_uid y hlsConfig válido debe producir 1 MintedVideo",
  );
  assertEquals(result[0].property_id, PROP_ID_1);
  assertEquals(result[0].video_id, VIDEO_ID_1);
  assertMatch(
    result[0].signed_url,
    HLS_URL_RE,
    `signed_url debe ser un manifest HLS de Stream; recibido: '${result[0].signed_url}'`,
  );

  // ANTI-REGRESIÓN (bug verificado en vivo 2026-07-22): Cloudflare exige el token
  // EN EL PATH — nunca como query param '?token=' ni '&token='. Ese query param
  // es exactamente el bug que devolvía 401 unauthorized en todo el feed.
  assertEquals(
    result[0].signed_url.includes("?token="),
    false,
    "signed_url NO debe llevar '?token=' como query param (el token va en el path)",
  );
  assertEquals(
    result[0].signed_url.includes("&token="),
    false,
    "signed_url NO debe llevar '&token=' como query param (el token va en el path)",
  );

  const { token } = parse_hls_url(result[0].signed_url);

  const token_segments = token.split(".");
  assertEquals(token_segments.length, 3, "El token debe ser un JWT de 3 segmentos (header.payload.signature)");

  const public_key = await importJWK(public_jwk, "RS256");
  const { payload, protectedHeader } = await jwtVerify(token, public_key, {
    algorithms: ["RS256"],
  });

  assertEquals(protectedHeader.kid, TEST_KEY_ID, "El header del JWT debe traer el kid de la signing key");
  assertEquals(
    payload.sub,
    CLOUDFLARE_UID_1,
    "El claim 'sub' del JWT (no la URL: el uid ya no viaja en el path) debe ser el cloudflare_uid del video",
  );
  assertEquals(payload.kid, TEST_KEY_ID, "El claim 'kid' del payload debe ser la signing key id");
});

Deno.test(
  "fila_sin_cloudflare_uid_con_storage_path_sigue_usando_supabase_storage_signed_url",
  async () => {
    // Rama legacy intacta: apps viejas sin cloudflare_uid conviven con el dual-ref.
    const { public_jwk: _unused, private_jwk_base64 } = await generate_test_signing_key();
    void _unused;
    const hls_config = make_hls_config(private_jwk_base64);
    const path = `${PROP_ID_1}/${VIDEO_ID_1}.mp4`;
    const expected_storage_url = "https://cdn.example.com/signed?tok=legacy123";

    const { client, storage_calls } = make_fake_client_tracked({
      query_data: [
        make_video_row({
          id: VIDEO_ID_1,
          property_id: PROP_ID_1,
          storage_path: path,
          cloudflare_uid: null,
        }),
      ],
      query_error: null,
      storage_responses: { [path]: expected_storage_url },
    });

    // hlsConfig SÍ está inyectado, pero la fila no tiene cloudflare_uid → debe
    // seguir yendo por Supabase Storage, no por Stream.
    const minter = make_video_url_minter(client as never, hls_config);
    const result = await minter.mint_signed_urls([PROP_ID_1]);

    assertEquals(result.length, 1);
    assertEquals(
      result[0].signed_url,
      expected_storage_url,
      "Sin cloudflare_uid, signed_url debe seguir siendo la Supabase Storage signed URL",
    );
    assertEquals(
      storage_calls.length,
      1,
      "createSignedUrl de Supabase Storage debe seguir llamándose para la rama legacy",
    );
  },
);

Deno.test("exp_del_jwt_respeta_signed_url_ttl_seconds_inyectado", async () => {
  const { public_jwk, private_jwk_base64 } = await generate_test_signing_key();
  const custom_ttl_seconds = 1800; // valor deliberadamente distinto de 3600 y de 14400
  const hls_config = make_hls_config(private_jwk_base64, {
    signedUrlTtlSeconds: custom_ttl_seconds,
  });

  const { client } = make_fake_client_tracked({
    query_data: [
      make_video_row({
        id: VIDEO_ID_1,
        property_id: PROP_ID_1,
        storage_path: null,
        cloudflare_uid: CLOUDFLARE_UID_1,
      }),
    ],
    query_error: null,
    storage_responses: {},
  });

  const before = Math.floor(Date.now() / 1000);
  const minter = make_video_url_minter(client as never, hls_config);
  const result = await minter.mint_signed_urls([PROP_ID_1]);

  const { token } = parse_hls_url(result[0].signed_url);
  const public_key = await importJWK(public_jwk, "RS256");
  const { payload } = await jwtVerify(token, public_key, { algorithms: ["RS256"] });

  assertExists(payload.exp, "El JWT debe traer claim 'exp'");
  const expected_exp = before + custom_ttl_seconds;
  const drift = Math.abs((payload.exp as number) - expected_exp);
  assertEquals(
    drift <= 5,
    true,
    `exp debe ser ~now+signedUrlTtlSeconds (±5s); esperado≈${expected_exp}, recibido=${payload.exp}, drift=${drift}s`,
  );
  assertNotEquals(
    payload.exp,
    before + 3600,
    "exp NO debe usar el TTL legacy hardcodeado de 3600s cuando se inyecta un TTL distinto",
  );
});

Deno.test(
  "stream_row_sin_hls_config_inyectado_se_excluye_del_batch_sin_lanzar",
  async () => {
    // Fail-closed: si el caller no inyecta hlsConfig (p.ej. secrets STREAM_* ausentes
    // en el entorno), una fila Stream se excluye; el batch NO debe lanzar y las
    // filas legacy del mismo batch deben seguir apareciendo.
    const legacy_path = `${PROP_ID_2}/${VIDEO_ID_2}.mp4`;
    const legacy_url = "https://cdn.example.com/signed?tok=legacy456";

    const { client } = make_fake_client_tracked({
      query_data: [
        make_video_row({
          id: VIDEO_ID_1,
          property_id: PROP_ID_1,
          storage_path: null,
          cloudflare_uid: CLOUDFLARE_UID_1,
        }),
        make_video_row({
          id: VIDEO_ID_2,
          property_id: PROP_ID_2,
          storage_path: legacy_path,
          cloudflare_uid: null,
        }),
      ],
      query_error: null,
      storage_responses: { [legacy_path]: legacy_url },
    });

    // Sin segundo argumento: hlsConfig === undefined.
    const minter = make_video_url_minter(client as never);
    const result = await minter.mint_signed_urls([PROP_ID_1, PROP_ID_2]);

    assertEquals(
      result.length,
      1,
      "Sin hlsConfig, solo la fila legacy debe aparecer (la Stream se excluye, fail-closed)",
    );
    assertEquals(result[0].property_id, PROP_ID_2);
    assertEquals(result[0].signed_url, legacy_url);
  },
);

Deno.test(
  "stream_row_con_jwk_invalido_se_excluye_solo_esa_fila_legacy_no_se_rompe",
  async () => {
    const legacy_path = `${PROP_ID_2}/${VIDEO_ID_2}.mp4`;
    const legacy_url = "https://cdn.example.com/signed?tok=legacy789";
    const invalid_hls_config = make_hls_config("esto-no-es-un-jwk-base64-valido---");

    const { client } = make_fake_client_tracked({
      query_data: [
        make_video_row({
          id: VIDEO_ID_1,
          property_id: PROP_ID_1,
          storage_path: null,
          cloudflare_uid: CLOUDFLARE_UID_1,
        }),
        make_video_row({
          id: VIDEO_ID_2,
          property_id: PROP_ID_2,
          storage_path: legacy_path,
          cloudflare_uid: null,
        }),
      ],
      query_error: null,
      storage_responses: { [legacy_path]: legacy_url },
    });

    const minter = make_video_url_minter(client as never, invalid_hls_config);
    const result = await minter.mint_signed_urls([PROP_ID_1, PROP_ID_2]);

    assertEquals(
      result.length,
      1,
      "JWK inválido excluye SOLO la fila Stream; la legacy del mismo batch debe seguir presente",
    );
    assertEquals(result[0].property_id, PROP_ID_2);
    assertEquals(result[0].signed_url, legacy_url);
  },
);

Deno.test("batch_mixto_stream_y_legacy_devuelve_ambas_correctamente_firmadas", async () => {
  const { public_jwk, private_jwk_base64 } = await generate_test_signing_key();
  const hls_config = make_hls_config(private_jwk_base64);
  const legacy_path = `${PROP_ID_2}/${VIDEO_ID_2}.mp4`;
  const legacy_url = "https://cdn.example.com/signed?tok=legacy999";

  const { client } = make_fake_client_tracked({
    query_data: [
      make_video_row({
        id: VIDEO_ID_1,
        property_id: PROP_ID_1,
        storage_path: null,
        cloudflare_uid: CLOUDFLARE_UID_1,
      }),
      make_video_row({
        id: VIDEO_ID_2,
        property_id: PROP_ID_2,
        storage_path: legacy_path,
        cloudflare_uid: null,
      }),
    ],
    query_error: null,
    storage_responses: { [legacy_path]: legacy_url },
  });

  const minter = make_video_url_minter(client as never, hls_config);
  const result = await minter.mint_signed_urls([PROP_ID_1, PROP_ID_2]);

  assertEquals(result.length, 2, "El batch mixto debe devolver ambas filas firmadas");

  const stream_result = result.find((v) => v.property_id === PROP_ID_1);
  const legacy_result = result.find((v) => v.property_id === PROP_ID_2);

  assertExists(stream_result, "Debe aparecer el MintedVideo de la fila Stream");
  assertExists(legacy_result, "Debe aparecer el MintedVideo de la fila legacy");

  assertMatch(stream_result!.signed_url, HLS_URL_RE, "La fila Stream debe traer URL HLS");
  assertEquals(
    legacy_result!.signed_url,
    legacy_url,
    "La fila legacy debe traer la Supabase Storage signed URL sin modificar",
  );

  const public_key = await importJWK(public_jwk, "RS256");
  const { token } = parse_hls_url(stream_result!.signed_url);
  const { payload } = await jwtVerify(token, public_key, { algorithms: ["RS256"] });
  assertEquals(payload.sub, CLOUDFLARE_UID_1);
});

Deno.test(
  "precedencia_cloudflare_uid_sobre_storage_path_cuando_fila_tiene_ambos",
  async () => {
    // Migración dual-ref: si una fila tuviera AMBOS storage_path Y cloudflare_uid
    // (transición legacy→Stream), la rama Stream siempre gana.
    const { public_jwk, private_jwk_base64 } = await generate_test_signing_key();
    const hls_config = make_hls_config(private_jwk_base64);
    const path = `${PROP_ID_1}/${VIDEO_ID_1}.mp4`;

    const { client, storage_calls } = make_fake_client_tracked({
      query_data: [
        make_video_row({
          id: VIDEO_ID_1,
          property_id: PROP_ID_1,
          storage_path: path, // legacy ref presente...
          cloudflare_uid: CLOUDFLARE_UID_1, // ...pero también Stream: debe ganar Stream
        }),
      ],
      query_error: null,
      // Si el minter (incorrectamente) usara la rama legacy, este sería el resultado:
      storage_responses: { [path]: "https://cdn.example.com/signed?tok=NO-DEBE-USARSE" },
    });

    const minter = make_video_url_minter(client as never, hls_config);
    const result = await minter.mint_signed_urls([PROP_ID_1]);

    assertEquals(result.length, 1);
    assertMatch(
      result[0].signed_url,
      HLS_URL_RE,
      "Con ambas refs presentes, signed_url debe ser HLS de Stream (cloudflare_uid gana)",
    );
    assertEquals(
      storage_calls.length,
      0,
      "createSignedUrl de Supabase Storage NO debe llamarse cuando cloudflare_uid está presente",
    );

    const public_key = await importJWK(public_jwk, "RS256");
    const { token } = parse_hls_url(result[0].signed_url);
    const { payload } = await jwtVerify(token, public_key, { algorithms: ["RS256"] });
    assertEquals(
      payload.sub,
      CLOUDFLARE_UID_1,
      "El claim 'sub' del JWT (no la URL) debe ser el cloudflare_uid — el uid ya no viaja en el path",
    );
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — Poster URL (portada firmada), subtarea 68.15
// ─────────────────────────────────────────────────────────────────────────────
//
// Contrato (68.15, corregido 2026-07-22): para una fila Stream (cloudflare_uid
// presente), además del signed_url HLS se computa posterUrl:
//   https://<domain>/<TOKEN>/thumbnails/thumbnail.jpg[?time=<T>s]
//   T = COALESCE(thumbnail_pct,50)/100 × duration_seconds, formateado .toFixed(1).
//   Sin duration_seconds → posterUrl SIN '?time=' (sin query string alguno).
// ⚠️ El TOKEN va EN EL PATH (mismo contrato que el HLS, ver arriba) — NUNCA como
// query param '?token='/'&token='. Fila legacy Storage (sin cloudflare_uid) →
// posterUrl siempre null. El token firma sub=uid con el MISMO mecanismo que el
// HLS (jose RS256).
//
// Los valores esperados de T son literales calculados a mano (fuente
// independiente de la fórmula que implementará el GREEN):
//   50/100×92=46.0 · 50/100×80=40.0 (default por thumbnail_pct null) · 25/100×8=2.0

// Grupo 1 = TOKEN (path, no query — el uid ya no viaja en la URL); grupo 2 = time.
const POSTER_URL_WITH_TIME_RE =
  /^https:\/\/(?:customer-[a-z0-9]+\.cloudflarestream\.com|(?:[a-z0-9.-]*\.)?videodelivery\.net)\/([^/]+)\/thumbnails\/thumbnail\.jpg\?time=([0-9]+\.[0-9]s)$/i;

// Sin duration_seconds: ni '?time=' ni '?token=' — la URL termina en el token de path.
const POSTER_URL_NO_TIME_RE =
  /^https:\/\/(?:customer-[a-z0-9]+\.cloudflarestream\.com|(?:[a-z0-9.-]*\.)?videodelivery\.net)\/([^/]+)\/thumbnails\/thumbnail\.jpg$/i;

/** Extrae el host (dominio) de cualquier URL https. */
function extract_host(url: string): string {
  const match = /^https:\/\/([^/]+)\//.exec(url);
  if (!match) {
    throw new Error(`No se pudo extraer el host de la URL: '${url}'`);
  }
  return match[1];
}

Deno.test(
  "poster_url_stream_thumbnail_pct_50_duration_92_da_time_46_0s_y_token_valido",
  async () => {
    const { public_jwk, private_jwk_base64 } = await generate_test_signing_key();
    const hls_config = make_hls_config(private_jwk_base64);

    const { client } = make_fake_client_tracked({
      query_data: [
        make_video_row({
          id: VIDEO_ID_1,
          property_id: PROP_ID_1,
          storage_path: null,
          cloudflare_uid: CLOUDFLARE_UID_1,
          thumbnail_pct: 50,
          duration_seconds: 92,
        }),
      ],
      query_error: null,
      storage_responses: {},
    });

    const minter = make_video_url_minter(client as never, hls_config);
    const result = await minter.mint_signed_urls([PROP_ID_1]);

    assertEquals(result.length, 1);
    assertExists(
      result[0].posterUrl,
      "La fila Stream con thumbnail_pct/duration_seconds debe traer posterUrl",
    );
    assertMatch(
      result[0].posterUrl as string,
      POSTER_URL_WITH_TIME_RE,
      `posterUrl debe matchear el patrón de thumbnail con time; recibido: '${result[0].posterUrl}'`,
    );

    // ANTI-REGRESIÓN (bug verificado en vivo 2026-07-22): el token va EN EL PATH,
    // nunca como query param '?token=' ni '&token=' — ese era exactamente el bug
    // que devolvía 401 unauthorized en la portada del video.
    assertEquals(
      (result[0].posterUrl as string).includes("?token="),
      false,
      "posterUrl NO debe llevar '?token=' como query param (el token va en el path)",
    );
    assertEquals(
      (result[0].posterUrl as string).includes("&token="),
      false,
      "posterUrl NO debe llevar '&token=' como query param (el token va en el path)",
    );

    const match = POSTER_URL_WITH_TIME_RE.exec(result[0].posterUrl as string)!;
    assertEquals(
      match[2],
      "46.0s",
      "T = thumbnail_pct(50)/100 × duration_seconds(92) = 46.0, formateado 'time=46.0s'",
    );

    const public_key = await importJWK(public_jwk, "RS256");
    const { payload } = await jwtVerify(match[1], public_key, {
      algorithms: ["RS256"],
    });
    assertEquals(
      payload.sub,
      CLOUDFLARE_UID_1,
      "El token del posterUrl (extraído del path, no de una query) debe firmar sub=cloudflare_uid",
    );
  },
);

Deno.test(
  "poster_url_stream_thumbnail_pct_null_usa_default_50_duration_80_da_time_40_0s",
  async () => {
    const { private_jwk_base64 } = await generate_test_signing_key();
    const hls_config = make_hls_config(private_jwk_base64);

    const { client } = make_fake_client_tracked({
      query_data: [
        make_video_row({
          id: VIDEO_ID_1,
          property_id: PROP_ID_1,
          storage_path: null,
          cloudflare_uid: CLOUDFLARE_UID_1,
          thumbnail_pct: null,
          duration_seconds: 80,
        }),
      ],
      query_error: null,
      storage_responses: {},
    });

    const minter = make_video_url_minter(client as never, hls_config);
    const result = await minter.mint_signed_urls([PROP_ID_1]);

    assertExists(result[0].posterUrl, "thumbnail_pct null no debe omitir posterUrl");
    const match = POSTER_URL_WITH_TIME_RE.exec(result[0].posterUrl as string);
    assertExists(match, `posterUrl debe traer '?time=' usando el default 50%; recibido: '${result[0].posterUrl}'`);
    assertEquals(
      match![2],
      "40.0s",
      "thumbnail_pct null → default 50; T = 50/100 × 80 = 40.0 ('time=40.0s')",
    );
  },
);

Deno.test("poster_url_stream_thumbnail_pct_25_duration_8_da_time_2_0s", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const hls_config = make_hls_config(private_jwk_base64);

  const { client } = make_fake_client_tracked({
    query_data: [
      make_video_row({
        id: VIDEO_ID_1,
        property_id: PROP_ID_1,
        storage_path: null,
        cloudflare_uid: CLOUDFLARE_UID_1,
        thumbnail_pct: 25,
        duration_seconds: 8,
      }),
    ],
    query_error: null,
    storage_responses: {},
  });

  const minter = make_video_url_minter(client as never, hls_config);
  const result = await minter.mint_signed_urls([PROP_ID_1]);

  assertExists(result[0].posterUrl);
  const match = POSTER_URL_WITH_TIME_RE.exec(result[0].posterUrl as string);
  assertExists(match, `posterUrl debe traer '?time='; recibido: '${result[0].posterUrl}'`);
  assertEquals(
    match![2],
    "2.0s",
    "T = thumbnail_pct(25)/100 × duration_seconds(8) = 2.0 ('time=2.0s')",
  );
});

Deno.test(
  "poster_url_stream_duration_null_omite_time_pero_token_presente",
  async () => {
    const { public_jwk, private_jwk_base64 } = await generate_test_signing_key();
    const hls_config = make_hls_config(private_jwk_base64);

    const { client } = make_fake_client_tracked({
      query_data: [
        make_video_row({
          id: VIDEO_ID_1,
          property_id: PROP_ID_1,
          storage_path: null,
          cloudflare_uid: CLOUDFLARE_UID_1,
          thumbnail_pct: 50,
          duration_seconds: null,
        }),
      ],
      query_error: null,
      storage_responses: {},
    });

    const minter = make_video_url_minter(client as never, hls_config);
    const result = await minter.mint_signed_urls([PROP_ID_1]);

    assertExists(
      result[0].posterUrl,
      "duration_seconds null debe seguir produciendo posterUrl (sin '?time=', Stream sirve su frame default)",
    );
    assertEquals(
      (result[0].posterUrl as string).includes("time="),
      false,
      "Sin duration_seconds, posterUrl NO debe incluir el parámetro 'time='",
    );
    assertMatch(
      result[0].posterUrl as string,
      POSTER_URL_NO_TIME_RE,
      `posterUrl debe matchear el patrón sin time (token en el path, sin query string); recibido: '${result[0].posterUrl}'`,
    );

    // ANTI-REGRESIÓN: nunca '?token=' ni '&token=' como query param.
    assertEquals(
      (result[0].posterUrl as string).includes("?token="),
      false,
      "posterUrl NO debe llevar '?token=' como query param (el token va en el path)",
    );
    assertEquals(
      (result[0].posterUrl as string).includes("&token="),
      false,
      "posterUrl NO debe llevar '&token=' como query param (el token va en el path)",
    );

    const match = POSTER_URL_NO_TIME_RE.exec(result[0].posterUrl as string)!;
    const public_key = await importJWK(public_jwk, "RS256");
    const { payload } = await jwtVerify(match[1], public_key, {
      algorithms: ["RS256"],
    });
    assertEquals(payload.sub, CLOUDFLARE_UID_1);
  },
);

Deno.test("poster_url_null_en_fila_legacy_storage", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const hls_config = make_hls_config(private_jwk_base64);
  const path = `${PROP_ID_1}/${VIDEO_ID_1}.mp4`;
  const expected_storage_url = "https://cdn.example.com/signed?tok=legacy-poster";

  const { client } = make_fake_client_tracked({
    query_data: [
      make_video_row({
        id: VIDEO_ID_1,
        property_id: PROP_ID_1,
        storage_path: path,
        cloudflare_uid: null,
        thumbnail_pct: null,
        duration_seconds: null,
      }),
    ],
    query_error: null,
    storage_responses: { [path]: expected_storage_url },
  });

  // hlsConfig SÍ inyectado (podría estarlo en prod); la fila es legacy (sin
  // cloudflare_uid) → posterUrl debe ser null, no undefined ni la signed_url.
  const minter = make_video_url_minter(client as never, hls_config);
  const result = await minter.mint_signed_urls([PROP_ID_1]);

  assertEquals(result.length, 1);
  assertEquals(
    result[0].signed_url,
    expected_storage_url,
    "signed_url legacy debe seguir intacto",
  );
  assertEquals(
    result[0].posterUrl,
    null,
    "El poster de Stream NO aplica a filas legacy Storage: posterUrl debe ser null explícito (no undefined)",
  );
});

Deno.test("poster_url_comparte_dominio_con_signed_url_hls", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const hls_config = make_hls_config(private_jwk_base64, {
    streamCustomerSubdomain: "abc123customer",
  });

  const { client } = make_fake_client_tracked({
    query_data: [
      make_video_row({
        id: VIDEO_ID_1,
        property_id: PROP_ID_1,
        storage_path: null,
        cloudflare_uid: CLOUDFLARE_UID_1,
        thumbnail_pct: 50,
        duration_seconds: 92,
      }),
    ],
    query_error: null,
    storage_responses: {},
  });

  const minter = make_video_url_minter(client as never, hls_config);
  const result = await minter.mint_signed_urls([PROP_ID_1]);

  assertExists(result[0].posterUrl, "posterUrl debe existir para comparar su dominio con el del HLS");
  const hls_host = extract_host(result[0].signed_url);
  const poster_host = extract_host(result[0].posterUrl as string);
  assertEquals(
    poster_host,
    hls_host,
    `El posterUrl debe usar el MISMO dominio que el signed_url HLS; hls='${hls_host}' poster='${poster_host}'`,
  );
});

Deno.test(
  "campos_existentes_property_id_video_id_signed_url_siguen_intactos_con_posterUrl",
  async () => {
    // Regresión: agregar posterUrl NO debe romper el contrato original del feed
    // (#21/#9) — property_id/video_id/signed_url deben seguir presentes y
    // correctos, y posterUrl debe ser una propiedad propia explícita (incluida
    // como null en legacy), no un campo ausente/omitido.
    const { private_jwk_base64 } = await generate_test_signing_key();
    const hls_config = make_hls_config(private_jwk_base64);
    const legacy_path = `${PROP_ID_2}/${VIDEO_ID_2}.mp4`;
    const legacy_url = "https://cdn.example.com/signed?tok=legacy-regresion";

    const { client } = make_fake_client_tracked({
      query_data: [
        make_video_row({
          id: VIDEO_ID_1,
          property_id: PROP_ID_1,
          storage_path: null,
          cloudflare_uid: CLOUDFLARE_UID_1,
          thumbnail_pct: 50,
          duration_seconds: 92,
        }),
        make_video_row({
          id: VIDEO_ID_2,
          property_id: PROP_ID_2,
          storage_path: legacy_path,
          cloudflare_uid: null,
        }),
      ],
      query_error: null,
      storage_responses: { [legacy_path]: legacy_url },
    });

    const minter = make_video_url_minter(client as never, hls_config);
    const result = await minter.mint_signed_urls([PROP_ID_1, PROP_ID_2]);

    assertEquals(result.length, 2, "El batch mixto debe seguir devolviendo ambas filas");

    const stream_row = result.find((v) => v.property_id === PROP_ID_1)!;
    const legacy_row = result.find((v) => v.property_id === PROP_ID_2)!;

    assertExists(stream_row, "Contrato original: la fila Stream debe seguir apareciendo");
    assertExists(legacy_row, "Contrato original: la fila legacy debe seguir apareciendo");
    assertEquals(stream_row.video_id, VIDEO_ID_1, "video_id de la fila Stream intacto");
    assertEquals(legacy_row.video_id, VIDEO_ID_2, "video_id de la fila legacy intacto");
    assertEquals(legacy_row.signed_url, legacy_url, "signed_url de la fila legacy intacto");

    // posterUrl debe existir como propiedad propia en AMBAS filas (Stream: string; legacy: null).
    assertEquals(
      Object.prototype.hasOwnProperty.call(stream_row, "posterUrl"),
      true,
      "La fila Stream debe traer la propiedad 'posterUrl' (no omitida)",
    );
    assertEquals(
      Object.prototype.hasOwnProperty.call(legacy_row, "posterUrl"),
      true,
      "La fila legacy debe traer la propiedad 'posterUrl' explícita (null, no omitida)",
    );
    assertEquals(legacy_row.posterUrl, null, "posterUrl de la fila legacy debe ser null explícito");
  },
);
