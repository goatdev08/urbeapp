// supabase/functions/contact-agent/property_resolver.test.ts
// Tests RED — subtarea 75.4.
//
// SEAM bajo test: `make_property_resolver(client)` (types.ts#PropertyResolver).
// HOY el stub lanza `not_implemented` → todo falla por EXCEPCIÓN, no por import:
// es el caso "SUT no existe, stub mínimo que lanza" del protocolo TDD del repo.
//
// POR QUÉ ESTE ARCHIVO EXISTE: el adapter vivía dentro del closure de `Deno.serve`
// en index.ts, o sea sin un solo test. Ahí se escondían dos cosas:
//   1. `video_id` nunca se llenaba (ponytail explícito en index.ts:80-81) → en
//      producción lead_origin_properties.property_video_id es NULL en TODAS las filas,
//      contra §9.6 ("contacto asociado a propiedad + video de origen").
//   2. La query traía `price`, que el template metía en el mensaje de WhatsApp
//      ignorando `price_visible`.
// Ambas son propiedades de la QUERY, así que se pinean sobre la query.
//
// EDGE CASES (RED):
// ### Columnas pedidas
// - el select pide property_type y zone (insumos del template §19.3)
// - el select pide property_videos (video de origen §9.6)
// - el select NO pide price (una columna que no se lee no se puede filtrar)
// ### Video de origen
// - varios videos → gana el de `position` menor (el principal), no el primero del array
// - videos borrados (deleted_at != null) se ignoran aunque tengan position menor
// - propiedad sin videos → video_id undefined (no null, no crash)
// ### Mapeo
// - property_type y zone se propagan al resultado
// - zone NULL se propaga como null (no "" ni "null")
// - agent_name concatena first_name + last_name (no-regresión de 14.3)
// ### Errores
// - fila inexistente → PROPERTY_NOT_FOUND
// - propiedad sin dueño en users → PROPERTY_NOT_FOUND (no-regresión)
// - error de infraestructura → DB_ERROR

import { assertEquals } from "@std/assert";
import { make_property_resolver } from "./property_resolver.ts";

const PROPERTY_ID = "00000000-0000-0000-0000-0000000004a1";
const OWNER_ID = "00000000-0000-0000-0000-0000000004a2";

interface FakeRow {
  id: string;
  address: string;
  property_type: string;
  zone: string | null;
  status: string;
  owner_user_id: string;
  users: unknown;
  property_videos?: unknown;
}

function make_row(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: PROPERTY_ID,
    address: "Av. Insurgentes Sur 1234",
    property_type: "casa",
    zone: "Del Valle",
    status: "active",
    owner_user_id: OWNER_ID,
    users: { id: OWNER_ID, first_name: "Carlos", last_name: "García", phone: "+5215512345678" },
    property_videos: [],
    ...overrides,
  };
}

/**
 * Fake client chainable mínimo — mismo patrón que lead_repo.test.ts#make_fake_client,
 * adaptado a la cadena que usa el resolver: .from().select().eq().is().maybeSingle().
 * `captured.cols` guarda el string del select para poder asertar QUÉ columnas se piden.
 */
function make_fake_client(
  result: { data: unknown; error: unknown },
): {
  // deno-lint-ignore no-explicit-any
  client: { from(table: string): any };
  captured: { table: string | null; cols: string };
} {
  const captured = { table: null as string | null, cols: "" };

  const client = {
    from(table: string) {
      captured.table = table;
      return {
        select(cols: string) {
          captured.cols = cols;
          return this;
        },
        eq(_col: string, _val: unknown) {
          return this;
        },
        is(_col: string, _val: unknown) {
          return this;
        },
        maybeSingle() {
          return Promise.resolve(result);
        },
      };
    },
  };

  return { client, captured };
}

/** Corre el resolver contra una fila y devuelve el resultado ya resuelto. */
async function resolve_row(row: unknown, error: unknown = null) {
  const { client, captured } = make_fake_client({ data: row, error });
  const result = await make_property_resolver(client).resolve(PROPERTY_ID);
  return { result, captured };
}

// ── Columnas pedidas ─────────────────────────────────────────────────────────

Deno.test("resolver_75_4_select_pide_property_type_y_zone", async () => {
  // El template §19.3 es "[tipo + zona]": si la query no las trae, el mensaje
  // no puede construirse. RED: el stub lanza not_implemented.
  const { captured } = await resolve_row(make_row());
  assertEquals(
    captured.cols.includes("property_type"),
    true,
    `75.4: el select debe pedir property_type, recibido: ${captured.cols}`,
  );
  assertEquals(
    captured.cols.includes("zone"),
    true,
    `75.4: el select debe pedir zone, recibido: ${captured.cols}`,
  );
});

Deno.test("resolver_75_4_select_pide_property_videos", async () => {
  // §9.6: el contacto queda asociado a propiedad + video de origen.
  const { captured } = await resolve_row(make_row());
  assertEquals(
    captured.cols.includes("property_videos"),
    true,
    `75.4: el select debe pedir property_videos, recibido: ${captured.cols}`,
  );
});

Deno.test("resolver_75_4_select_no_pide_price", async () => {
  // El precio salía en el mensaje de WhatsApp ignorando price_visible. La EF ya
  // no lo necesita; no traerlo es el arreglo de raíz (no se filtra lo que no se lee).
  const { captured } = await resolve_row(make_row());
  assertEquals(
    captured.cols.includes("price"),
    false,
    `75.4: el select NO debe pedir price (ni price_visible), recibido: ${captured.cols}`,
  );
});

// ── Video de origen ──────────────────────────────────────────────────────────

Deno.test("resolver_75_4_video_id_es_el_de_position_menor", async () => {
  // Orden del array != orden de position. El video principal es position=1.
  const row = make_row({
    property_videos: [
      { id: "video-pos-3", position: 3, deleted_at: null },
      { id: "video-pos-1", position: 1, deleted_at: null },
      { id: "video-pos-2", position: 2, deleted_at: null },
    ],
  });
  const { result } = await resolve_row(row);
  assertEquals(result.ok, true, "75.4: la propiedad existe → ok:true");
  assertEquals(
    result.ok && result.data.video_id,
    "video-pos-1",
    "75.4: video_id debe ser el de position menor, no el primero del array",
  );
});

Deno.test("resolver_75_4_ignora_videos_borrados", async () => {
  // Un video borrado con position 1 no debe ganarle al vivo con position 2.
  const row = make_row({
    property_videos: [
      { id: "video-borrado", position: 1, deleted_at: "2026-08-01T00:00:00Z" },
      { id: "video-vivo", position: 2, deleted_at: null },
    ],
  });
  const { result } = await resolve_row(row);
  assertEquals(
    result.ok && result.data.video_id,
    "video-vivo",
    "75.4: los videos con deleted_at no cuentan como video de origen",
  );
});

Deno.test("resolver_75_4_sin_videos_video_id_undefined", async () => {
  // Sin videos el campo queda undefined: el handler lo pasa tal cual a insert_origin,
  // que ya trata undefined como "sin video" (property_video_id → null).
  const { result } = await resolve_row(make_row({ property_videos: [] }));
  assertEquals(
    result.ok && result.data.video_id,
    undefined,
    "75.4: propiedad sin videos → video_id undefined",
  );
});

Deno.test("resolver_75_4_todos_los_videos_borrados_video_id_undefined", async () => {
  // Boundary: hay filas, pero ninguna viva.
  const row = make_row({
    property_videos: [{ id: "video-borrado", position: 1, deleted_at: "2026-08-01T00:00:00Z" }],
  });
  const { result } = await resolve_row(row);
  assertEquals(
    result.ok && result.data.video_id,
    undefined,
    "75.4: si todos los videos están borrados → video_id undefined",
  );
});

// ── Mapeo ────────────────────────────────────────────────────────────────────

Deno.test("resolver_75_4_property_type_y_zone_se_propagan", async () => {
  const { result } = await resolve_row(make_row({ property_type: "departamento", zone: "Roma Norte" }));
  assertEquals(result.ok && result.data.property_type, "departamento");
  assertEquals(result.ok && result.data.zone, "Roma Norte");
});

Deno.test("resolver_75_4_zone_null_se_propaga_como_null", async () => {
  // Las propiedades viejas tienen zone NULL; el template debe poder omitirla.
  const { result } = await resolve_row(make_row({ zone: null }));
  assertEquals(result.ok && result.data.zone, null, "75.4: zone NULL se propaga como null");
});

Deno.test("resolver_75_4_agent_name_concatena_nombre_y_apellido", async () => {
  // No-regresión de 14.3.
  const { result } = await resolve_row(make_row());
  assertEquals(result.ok && result.data.agent_name, "Carlos García");
});

// ── Errores ──────────────────────────────────────────────────────────────────

Deno.test("resolver_75_4_fila_inexistente_property_not_found", async () => {
  const { result } = await resolve_row(null);
  assertEquals(result.ok, false);
  assertEquals(!result.ok && result.error_code, "PROPERTY_NOT_FOUND");
});

Deno.test("resolver_75_4_sin_owner_property_not_found", async () => {
  // No-regresión de 14.3: propiedad huérfana se trata como no encontrada.
  const { result } = await resolve_row(make_row({ users: null }));
  assertEquals(!result.ok && result.error_code, "PROPERTY_NOT_FOUND");
});

Deno.test("resolver_75_4_error_de_infraestructura_db_error", async () => {
  const { result } = await resolve_row(null, { message: "timeout" });
  assertEquals(!result.ok && result.error_code, "DB_ERROR");
});
