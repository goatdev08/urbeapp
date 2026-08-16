// supabase/functions/_shared/ad_creative_registrar.test.ts
// Tests del AdCreativeRegistrar REAL (make_ad_creative_registrar) — subtarea
// 169.4 (cierre pedido por el guardián, 2026-08-16: "los 3 adapters nuevos
// tienen cero cobertura").
//
// GAP: la suite DI de mint-ad-upload-url/handler.test.ts solo prueba el
// CONTRATO del handler contra un mock (register_uploading_ad_creative
// configurado por escenario) — la correctitud del INSERT real (tabla, shape
// exacto de columnas) no tenía cobertura automatizada.
//
// Framework: Deno.test + @std/assert
// Ejecutar:
//   cd supabase/functions && deno test --allow-env --allow-net --allow-read \
//     --config deno.json _shared/ad_creative_registrar.test.ts
//
// ─── EDGE CASES CUBIERTOS ─────────────────────────────────────────────────────
// - inserta_en_la_tabla_ad_creatives
// - insert_shape_exacto_agency_id_status_cloudflare_uid_sin_columnas_de_property_videos
// - insert_exitoso_no_lanza
// - insert_fallido_lanza_con_mensaje_que_incluye_el_error_original

import { assertEquals, assertRejects } from "@std/assert";
import { make_ad_creative_registrar } from "./clients.ts";

// ── Fake client — captura tabla + payload del insert ──────────────────────────

interface InsertResponse {
  error: { message: string } | null;
}

function make_fake_client(response: InsertResponse) {
  const from_calls: string[] = [];
  let inserted: Record<string, unknown> | undefined;
  const client = {
    from(table: string) {
      from_calls.push(table);
      return {
        insert(payload: Record<string, unknown>): Promise<InsertResponse> {
          inserted = payload;
          return Promise.resolve(response);
        },
      };
    },
  };
  return {
    client,
    from_calls,
    get inserted_payload(): Record<string, unknown> | undefined {
      return inserted;
    },
  };
}

// ── Constantes ──────────────────────────────────────────────────────────────

const AGENCY_ID = "10000000-0000-0000-0000-000000000001";
const CLOUDFLARE_UID = "aaaaaaaabbbbccccdddd000000000001";

// ── Tests ──────────────────────────────────────────────────────────────────

Deno.test("inserta_en_la_tabla_ad_creatives", async () => {
  const fake = make_fake_client({ error: null });
  const registrar = make_ad_creative_registrar(fake.client as never);
  await registrar.register_uploading_ad_creative({
    agency_id: AGENCY_ID,
    status: "uploading",
    cloudflare_uid: CLOUDFLARE_UID,
  });
  assertEquals(fake.from_calls, ["ad_creatives"]);
});

Deno.test(
  "insert_shape_exacto_agency_id_status_cloudflare_uid_sin_columnas_de_property_videos",
  async () => {
    const fake = make_fake_client({ error: null });
    const registrar = make_ad_creative_registrar(fake.client as never);
    await registrar.register_uploading_ad_creative({
      agency_id: AGENCY_ID,
      status: "uploading",
      cloudflare_uid: CLOUDFLARE_UID,
    });
    assertEquals(
      fake.inserted_payload,
      { agency_id: AGENCY_ID, status: "uploading", cloudflare_uid: CLOUDFLARE_UID },
      "el insert debe tener EXACTAMENTE estas 3 columnas — ad_creatives no tiene " +
        "property_id/position/tus_upload_url (schema de 169.1)",
    );
  },
);

Deno.test("insert_exitoso_no_lanza", async () => {
  const fake = make_fake_client({ error: null });
  const registrar = make_ad_creative_registrar(fake.client as never);
  await registrar.register_uploading_ad_creative({
    agency_id: AGENCY_ID,
    status: "uploading",
    cloudflare_uid: CLOUDFLARE_UID,
  });
  // Si llegó aquí sin lanzar, el caso feliz pasó — no hay más que afirmar.
});

Deno.test("insert_fallido_lanza_con_mensaje_que_incluye_el_error_original", async () => {
  const fake = make_fake_client({ error: { message: "duplicate key value violates unique constraint" } });
  const registrar = make_ad_creative_registrar(fake.client as never);
  await assertRejects(
    () =>
      registrar.register_uploading_ad_creative({
        agency_id: AGENCY_ID,
        status: "uploading",
        cloudflare_uid: CLOUDFLARE_UID,
      }),
    Error,
    "duplicate key value violates unique constraint",
    "el handler traduce cualquier throw a 500 — el mensaje debe preservar el error real para logs",
  );
});
