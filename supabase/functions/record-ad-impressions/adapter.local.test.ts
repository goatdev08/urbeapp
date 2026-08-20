// supabase/functions/record-ad-impressions/adapter.local.test.ts
// Tests RED — fix guardián 170.6 (V1 + V4b): adaptadores REALES de
// record-ad-impressions (_shared/clients.ts: make_impressions_writer) contra
// el stack LOCAL REAL (Postgres real vía supabase-js + service_role), NUNCA
// contra el FakeWriter de handler.test.ts. Lección de #73 (moderación,
// 2026-08-09): "los 3 defectos críticos solo aparecieron al verificar contra
// el stack local real" — un mock solo espeja los argumentos que recibe, no
// la semántica real de `upsert(rows, {onConflict:'id'})` (reescribe TODAS
// las columnas) ni la validación de tipo `uuid` que hace Postgres.
//
// Requiere el stack local levantado (`supabase status`). Deliberadamente
// SEPARADO de handler.test.ts (que es 100% DI con fakes, sin red I/O) para
// que la suite mockeada se pueda correr sin el stack arriba.
//
// Runner:
//   cd supabase/functions && deno test --allow-env --allow-net --allow-read \
//     --config deno.json record-ad-impressions/adapter.local.test.ts
//
// SEAM bajo prueba: make_impressions_writer(client).upsert_impressions /
// .record_cta_tap — el contrato observable contra la tabla REAL
// public.ad_impressions (no internals, no mocks).
//
// EDGE CASES (RED) — fix guardián 170.6:
//
// V1 — el upsert degrada filas ya facturadas (criterio duro: "Solo
// cta_tapped_at es actualizable por el upsert. watched_ms/viewed/completed
// NO se reescriben tras el insert"):
//   - escribir una impresión (watched_ms=9000/viewed=true/completed=true) +
//     tap al CTA, reenviar EL MISMO id con watched_ms=0/viewed=false/
//     completed=false -> la fila NO debe degradarse: watched_ms/viewed/
//     completed deben seguir siendo los del primer insert, cta_tapped_at
//     debe seguir presente. Pareado con la aceptación (no vacuo): se
//     asierta primero que, tras el 1er upsert+tap, la fila SÍ quedó con los
//     valores esperados.
//
// V4b — el fail-closed por item se rompe en el adaptador real
// (is_well_formed_impression valida session_id como string no vacío, pero
// la columna es `uuid not null`):
//   - upsert_impressions([fila_valida, fila_con_session_id_no_uuid]) hace UN
//     SOLO INSERT multi-fila -> Postgres aborta el statement COMPLETO
//     (22P02): documentamos el mecanismo (throws) y aserta que la fila
//     VÁLIDA del mismo batch NO debería perderse por culpa de la otra
//     (mismo criterio fail-closed POR ITEM que ya aplica en el resto de la
//     EF) -- hoy SÍ se pierde.

import { assertEquals, assertExists } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { make_impressions_writer } from "../_shared/clients.ts";
import type { ImpressionRow } from "./types.ts";

// Well-known local dev keys de `supabase status` (no secretas, solo válidas
// contra 127.0.0.1 con el stack levantado localmente) -- mismo patrón que
// el resto de los scripts locales del repo (ver wiki:
// supabase_cli_use_brew_global, remote_auth_autoconfirm_enabled).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

let fixture_counter = 0;

interface AgencyAdFixture {
  agency_id: string;
  ad_id: string;
  cleanup: () => Promise<void>;
}

/** Fixture self-contained (mismo criterio que 54_*.sql: prefijo dedicado,
 * se crea y se BORRA al final de cada test -- este archivo no corre dentro
 * de una transacción que se revierta sola, a diferencia de pgTAP). */
async function seed_agency_and_ad(): Promise<AgencyAdFixture> {
  fixture_counter++;
  const suffix = `${Date.now()}-${fixture_counter}`;
  const email = `adapter-local-170-6-${suffix}@urbea.mx`;

  const { data: created, error: user_err } = await client.auth.admin.createUser({
    email,
    password: "urbea2026-adapter-local-test",
    email_confirm: true,
  });
  if (user_err || !created.user) {
    throw new Error(`no se pudo crear el usuario fixture: ${user_err?.message}`);
  }
  const user_id = created.user.id;

  const { data: agency, error: agency_err } = await client
    .from("agencies")
    .insert({
      name: `Adapter Local 170.6 ${suffix}`,
      slug: `adapter-local-170-6-${suffix}`,
      status: "active",
      created_by_user_id: user_id,
    })
    .select("id")
    .single();
  if (agency_err || !agency) {
    throw new Error(`no se pudo crear la agencia fixture: ${agency_err?.message}`);
  }

  const { data: creative, error: creative_err } = await client
    .from("ad_creatives")
    .insert({
      agency_id: agency.id,
      cloudflare_uid: `cfuid-adapter-local-170-6-${suffix}`,
      duration_seconds: 15,
      status: "ready",
    })
    .select("id")
    .single();
  if (creative_err || !creative) {
    throw new Error(`no se pudo crear el creative fixture: ${creative_err?.message}`);
  }

  const now = Date.now();
  const { data: ad, error: ad_err } = await client
    .from("ads")
    .insert({
      agency_id: agency.id,
      creative_id: creative.id,
      title: `Anuncio fixture adapter local 170.6 ${suffix}`,
      cta_type: "whatsapp",
      cta_value: "+525500000000",
      status: "active",
      starts_at: new Date(now - 86_400_000).toISOString(),
      ends_at: new Date(now + 86_400_000).toISOString(),
    })
    .select("id")
    .single();
  if (ad_err || !ad) {
    throw new Error(`no se pudo crear el ad fixture: ${ad_err?.message}`);
  }

  return {
    agency_id: agency.id,
    ad_id: ad.id,
    cleanup: async () => {
      await client.from("ad_impressions").delete().eq("ad_id", ad.id);
      await client.from("ads").delete().eq("id", ad.id);
      await client.from("ad_creatives").delete().eq("id", creative.id);
      await client.from("agencies").delete().eq("id", agency.id);
      await client.auth.admin.deleteUser(user_id);
    },
  };
}

function make_row(
  overrides: Partial<ImpressionRow> & {
    id: string;
    ad_id: string;
    agency_id: string;
    user_id: string;
    session_id: string;
  },
): ImpressionRow {
  return {
    municipality_id: null,
    neighborhood_id: null,
    shown_at: new Date().toISOString(),
    watched_ms: 9000,
    viewed: true,
    completed: true,
    device: "android",
    ...overrides,
  };
}

Deno.test({
  name: "V1_adapter_real_reenviar_mismo_id_con_watched_ms_menor_no_degrada_la_fila_ya_facturada",
  fn: async () => {
    const { ad_id, agency_id, cleanup } = await seed_agency_and_ad();
    try {
      const writer = make_impressions_writer(client);
      const id = crypto.randomUUID();
      const user_id = crypto.randomUUID();
      const session_id = crypto.randomUUID();

      // 1er POST: watched_ms alto, viewed/completed true.
      await writer.upsert_impressions([
        make_row({ id, ad_id, agency_id, user_id, session_id, watched_ms: 9000, viewed: true, completed: true }),
      ]);
      const cta_tapped_at = new Date().toISOString();
      await writer.record_cta_tap(id, cta_tapped_at);

      // Aceptación (pareo, no vacuo): tras el 1er upsert + tap, la fila SÍ
      // tiene los valores esperados -- si esto fallara, el resto del test
      // sería vacuo.
      const { data: after_first, error: err1 } = await client
        .from("ad_impressions")
        .select("watched_ms, viewed, completed, cta_tapped_at")
        .eq("id", id)
        .single();
      if (err1) throw new Error(`no se pudo leer la fila tras el 1er upsert: ${err1.message}`);
      assertEquals(after_first?.watched_ms, 9000, "la fila recién escrita debe tener el watched_ms del 1er POST");
      assertEquals(after_first?.viewed, true);
      assertEquals(after_first?.completed, true);
      assertExists(after_first?.cta_tapped_at, "el tap ya debió quedar registrado");

      // 2do POST del MISMO trío/id (reintento típico): watched_ms MENOR,
      // viewed/completed false -- NO debe degradar la fila ya facturada.
      await writer.upsert_impressions([
        make_row({ id, ad_id, agency_id, user_id, session_id, watched_ms: 0, viewed: false, completed: false }),
      ]);

      const { data: after_resend, error: err2 } = await client
        .from("ad_impressions")
        .select("watched_ms, viewed, completed, cta_tapped_at")
        .eq("id", id)
        .single();
      if (err2) throw new Error(`no se pudo leer la fila tras el reenvío: ${err2.message}`);
      assertEquals(
        after_resend?.watched_ms,
        9000,
        "reenviar el mismo id con watched_ms menor NO debe degradar la fila ya facturada",
      );
      assertEquals(after_resend?.viewed, true, "viewed no debe reescribirse tras el insert inicial");
      assertEquals(after_resend?.completed, true, "completed no debe reescribirse tras el insert inicial");
      assertExists(
        after_resend?.cta_tapped_at,
        "cta_tapped_at (la ÚNICA columna que el upsert debe poder tocar) debe seguir presente",
      );
    } finally {
      await cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "V4b_adapter_real_item_con_session_id_no_uuid_en_el_mismo_batch_no_debe_tumbar_la_fila_valida",
  fn: async () => {
    const { ad_id, agency_id, cleanup } = await seed_agency_and_ad();
    try {
      const writer = make_impressions_writer(client);
      const valid_id = crypto.randomUUID();
      const user_id = crypto.randomUUID();

      const valid_row = make_row({ id: valid_id, ad_id, agency_id, user_id, session_id: crypto.randomUUID() });
      const malformed_row = make_row({
        id: crypto.randomUUID(),
        ad_id,
        agency_id,
        user_id,
        // deno-lint-ignore no-explicit-any
        session_id: "no-es-uuid" as any,
      });

      // Documenta el mecanismo real: el adaptador hoy hace UN SOLO upsert
      // multi-fila -> Postgres rechaza el statement COMPLETO por una fila
      // con `uuid` inválido (22P02).
      let threw = false;
      try {
        await writer.upsert_impressions([valid_row, malformed_row]);
      } catch {
        threw = true;
      }
      assertEquals(
        threw,
        true,
        "documenta el mecanismo real: Postgres rechaza el batch COMPLETO por 1 fila con uuid inválido",
      );

      // La aserción que debe volverse verde en GREEN: la fila VÁLIDA del
      // mismo batch no debería perderse por culpa de la otra (mismo
      // criterio fail-closed POR ITEM que ya aplica en el resto de la EF)
      // -- hoy SÍ se pierde, éste es el RED.
      const { data: valid_row_in_db } = await client
        .from("ad_impressions")
        .select("id")
        .eq("id", valid_id)
        .maybeSingle();
      assertExists(
        valid_row_in_db,
        "la fila válida del batch NO debe perderse por culpa de un item malformado en el mismo lote",
      );
    } finally {
      await cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ═══════════════════════════════════════════════════════════════════════════
// RED #198 — el tap HUÉRFANO se pierde en silencio, y el contador miente.
//
// record_cta_tap es un UPDATE (a propósito: su firma acotada es lo que impide
// estructuralmente que toque watched_ms/viewed/completed, el fix del
// bloqueante V1). La consecuencia no buscada: si el tap llega ANTES que su
// impresión, no matchea ninguna fila y NO PASA NADA — sin error, sin rastro.
//
// Y el contador de la respuesta lo tapa: `cta_taps_recorded` se incrementa por
// cada tap PROCESADO, no por cada tap que efectivamente escribió. Un tap
// huérfano suma igual. En un producto donde el CTA es lo que se factura por
// clic, ese es el evento más caro y el que peor falla.
//
// El arreglo NO es hacer que el UPDATE pueda crear la fila (eso reabriría la
// superficie que V1 cerró). Es que el adapter DIGA cuántas filas tocó, para
// que el sistema pueda responder "cuántos taps se perdieron".
// ═══════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "198_record_cta_tap_devuelve_1_cuando_la_fila_existe",
  fn: async () => {
    const { ad_id, agency_id, cleanup } = await seed_agency_and_ad();
    try {
      const writer = make_impressions_writer(client);
      const id = crypto.randomUUID();
      const user_id = crypto.randomUUID();
      const session_id = crypto.randomUUID();
      await writer.upsert_impressions([make_row({ id, ad_id, agency_id, user_id, session_id })]);

      const affected = await writer.record_cta_tap(id, new Date().toISOString());
      assertEquals(affected, 1, "un tap sobre una impresion existente debe reportar 1 fila afectada");
    } finally {
      await cleanup();
    }
  },
});

Deno.test({
  name: "198_record_cta_tap_devuelve_0_cuando_el_tap_es_HUERFANO",
  fn: async () => {
    const { cleanup } = await seed_agency_and_ad();
    try {
      const writer = make_impressions_writer(client);
      // Un id derivado que NUNCA se escribio: es exactamente el caso "el tap
      // adelanto a su batch de impresiones".
      const orphan_id = crypto.randomUUID();

      const affected = await writer.record_cta_tap(orphan_id, new Date().toISOString());
      assertEquals(
        affected,
        0,
        "un tap sin impresion debe reportar 0 filas — hoy devuelve void y se pierde mudo",
      );
    } finally {
      await cleanup();
    }
  },
});
