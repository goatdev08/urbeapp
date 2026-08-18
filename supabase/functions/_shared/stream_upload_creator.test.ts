/**
 * Tests RED — 192.1 (límite de video a 500 MB vía TUS)
 * SUT: make_stream_upload_creator(fetch_impl).create_tus_upload en _shared/clients.ts
 *
 * Ejecutar:
 *   cd supabase/functions && deno test --allow-env --config deno.json \
 *     _shared/stream_upload_creator.test.ts
 *
 * SEAM bajo test: la llamada HTTP REAL que crea el upload TUS en Cloudflare
 * Stream (frontera de red). `fetch` se INYECTA (parámetro opcional del factory,
 * default `globalThis.fetch`) y se captura Request completa: URL, método,
 * headers y body. Nunca red real.
 *
 * Contrato de Cloudflare (Direct Creator Upload con tus):
 *   POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/stream?direct_user=true
 *   Headers: Authorization Bearer, Tus-Resumable 1.0.0, Upload-Length <bytes>,
 *            Upload-Creator <creator>, Upload-Metadata "maxDurationSeconds <b64>,requiresignedurls"
 *   201 → header `Location` (URL de PATCH del cliente) + `stream-media-id` (uid).
 *
 * EDGE CASES (RED):
 * - (A-1) url_metodo_y_headers_tus_exactos (Upload-Length numérico en string,
 *         Tus-Resumable 1.0.0, Upload-Creator = creator, Authorization Bearer)
 * - (A-2) upload_metadata_lleva_maxDurationSeconds_en_base64_y_requiresignedurls_como_flag
 * - (A-3) requireSignedURLs_false_omite_el_flag_requiresignedurls
 * - (A-4) devuelve_uploadURL_desde_Location_y_uid_desde_stream_media_id
 * - (A-5) respuesta_no_2xx_lanza (nunca fila huérfana — el handler lo mapea a 502)
 * - (A-6) respuesta_2xx_sin_Location_lanza
 * - (A-7) sin_env_STREAM_ACCOUNT_ID_o_TOKEN_lanza_sin_llamar_a_fetch
 * - (A-8) el_metodo_basico_create_direct_upload_sigue_existiendo (no regresión
 *         del contrato viejo — mismo objeto sirve a los dos caminos)
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { make_stream_upload_creator } from "./clients.ts";

const ACCOUNT = "acct-test-0001";
const TOKEN = "tok-test-secret";
const CREATOR = "00000000-0000-0000-0000-0000000000aa";
const LOCATION = "https://upload.cloudflarestream.com/tus/uid-xyz?tusv2=true";
const MEDIA_ID = "uid-xyz";

function set_env(): void {
  Deno.env.set("STREAM_ACCOUNT_ID", ACCOUNT);
  Deno.env.set("STREAM_API_TOKEN", TOKEN);
}
function clear_env(): void {
  Deno.env.delete("STREAM_ACCOUNT_ID");
  Deno.env.delete("STREAM_API_TOKEN");
}

interface Captured {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

function fake_fetch(
  respond: () => Response,
): { fetch_impl: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetch_impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({ url, method, headers, body });
    return respond();
  }) as typeof fetch;
  return { fetch_impl, calls };
}

function created_201(): Response {
  return new Response(null, {
    status: 201,
    headers: { Location: LOCATION, "stream-media-id": MEDIA_ID },
  });
}

const PARAMS = {
  creator: CREATOR,
  maxDurationSeconds: 120,
  requireSignedURLs: true,
  uploadLength: 250 * 1024 * 1024,
};

Deno.test("(A-1) url_metodo_y_headers_tus_exactos", async () => {
  set_env();
  try {
    const { fetch_impl, calls } = fake_fetch(created_201);
    await make_stream_upload_creator(fetch_impl).create_tus_upload(PARAMS);
    assertEquals(calls.length, 1);
    assertEquals(
      calls[0].url,
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/stream?direct_user=true`,
    );
    assertEquals(calls[0].method, "POST");
    assertEquals(calls[0].headers.get("Authorization"), `Bearer ${TOKEN}`);
    assertEquals(calls[0].headers.get("Tus-Resumable"), "1.0.0");
    assertEquals(calls[0].headers.get("Upload-Length"), String(250 * 1024 * 1024));
    assertEquals(calls[0].headers.get("Upload-Creator"), CREATOR);
  } finally {
    clear_env();
  }
});

Deno.test("(A-2) upload_metadata_lleva_maxDurationSeconds_en_base64_y_requiresignedurls_como_flag", async () => {
  set_env();
  try {
    const { fetch_impl, calls } = fake_fetch(created_201);
    await make_stream_upload_creator(fetch_impl).create_tus_upload(PARAMS);
    const meta = calls[0].headers.get("Upload-Metadata") ?? "";
    // pares "clave valorBase64" separados por coma; los flags van sin valor.
    const parts = meta.split(",").map((p) => p.trim());
    assertEquals(parts.includes(`maxDurationSeconds ${btoa("120")}`), true, `metadata: ${meta}`);
    assertEquals(parts.includes("requiresignedurls"), true, `metadata: ${meta}`);
  } finally {
    clear_env();
  }
});

Deno.test("(A-3) requireSignedURLs_false_omite_el_flag_requiresignedurls", async () => {
  set_env();
  try {
    const { fetch_impl, calls } = fake_fetch(created_201);
    await make_stream_upload_creator(fetch_impl).create_tus_upload({
      ...PARAMS,
      requireSignedURLs: false,
    });
    const meta = calls[0].headers.get("Upload-Metadata") ?? "";
    assertEquals(meta.includes("requiresignedurls"), false, `metadata: ${meta}`);
    assertStringIncludes(meta, `maxDurationSeconds ${btoa("120")}`);
  } finally {
    clear_env();
  }
});

Deno.test("(A-4) devuelve_uploadURL_desde_Location_y_uid_desde_stream_media_id", async () => {
  set_env();
  try {
    const { fetch_impl } = fake_fetch(created_201);
    const result = await make_stream_upload_creator(fetch_impl).create_tus_upload(PARAMS);
    assertEquals(result, { uploadURL: LOCATION, uid: MEDIA_ID });
  } finally {
    clear_env();
  }
});

Deno.test("(A-5) respuesta_no_2xx_lanza", async () => {
  set_env();
  try {
    const { fetch_impl } = fake_fetch(() =>
      new Response(JSON.stringify({ success: false, errors: [{ code: 10005, message: "bad" }] }), {
        status: 400,
      })
    );
    await assertRejects(() => make_stream_upload_creator(fetch_impl).create_tus_upload(PARAMS));
  } finally {
    clear_env();
  }
});

Deno.test("(A-6) respuesta_2xx_sin_Location_lanza", async () => {
  set_env();
  try {
    const { fetch_impl } = fake_fetch(() => new Response(null, { status: 201 }));
    await assertRejects(() => make_stream_upload_creator(fetch_impl).create_tus_upload(PARAMS));
  } finally {
    clear_env();
  }
});

Deno.test("(A-7) sin_env_lanza_sin_llamar_a_fetch", async () => {
  clear_env();
  const { fetch_impl, calls } = fake_fetch(created_201);
  await assertRejects(() => make_stream_upload_creator(fetch_impl).create_tus_upload(PARAMS));
  assertEquals(calls.length, 0);
});

Deno.test("(A-8) el_metodo_basico_create_direct_upload_sigue_existiendo", () => {
  const creator = make_stream_upload_creator();
  assertEquals(typeof creator.create_direct_upload, "function");
  assertEquals(typeof creator.create_tus_upload, "function");
});
