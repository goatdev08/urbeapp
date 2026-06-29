// supabase/functions/mint-video-url/handler.test.ts
// Tests RED — subtarea 21.2
// Edge Function: mint-video-url/handler.ts  (MINTER PURO de signed URLs)
// Framework: Deno.test + @std/assert
// Runner: deno test --allow-net supabase/functions/mint-video-url/handler.test.ts
//         (desde el repo raíz, con deno.json en supabase/functions/)
//
// EDGE CASES (RED) — 21.2:
//
// ### Happy path
// - 1 property_id con video válido → minter devuelve 1 MintedVideo → 200 body.videos tiene 1 elemento
// - body.videos[0] tiene property_id/video_id/signed_url correctos
// - batch de 3 property_ids con videos → 200 body.videos tiene 3 elementos
// - minter llamado exactamente una vez con el array exacto de property_ids (shape — lección #8)
//
// ### Exclusión silenciosa (decisión usuario — NUNCA 404)
// - property_id sin video válido → minter devuelve [] → 200 con { videos: [] } (no 404)
// - batch parcial: minter devuelve subconjunto → 200 con ese subconjunto, sin error
//
// ### CORS / métodos HTTP
// - OPTIONS → 200 con header Access-Control-Allow-Origin
// - GET → 405
// - PUT → 405
//
// ### Body / parse / validación de input
// - body no-JSON → 400 INVALID_INPUT
// - payload {} (property_ids ausente) → 400 INVALID_INPUT
// - property_ids es string (no array) → 400 INVALID_INPUT
// - property_ids es número (no array) → 400 INVALID_INPUT
// - property_ids array vacío [] → 400 INVALID_INPUT
// - property_ids con elemento no-string (número) → 400 INVALID_INPUT
// - property_ids con elemento cadena vacía '' → 400 INVALID_INPUT
//
// ### Fallo del minter
// - minter lanza Error → 500 INTERNAL_ERROR (handler lo captura; no propaga excepción cruda)
// - deps undefined → TypeError capturado por el handler → 500 INTERNAL_ERROR

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import type { MintedVideo, MintVideoUrlDeps, VideoUrlMinter } from "./types.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const PROP_ID_1 = "00000000-0000-0000-0000-000000000001";
const PROP_ID_2 = "00000000-0000-0000-0000-000000000002";
const PROP_ID_3 = "00000000-0000-0000-0000-000000000003";
const VIDEO_ID_1 = "aaaaaaaa-0000-0000-0000-000000000001";
const VIDEO_ID_2 = "aaaaaaaa-0000-0000-0000-000000000002";
const VIDEO_ID_3 = "aaaaaaaa-0000-0000-0000-000000000003";

const MINTED_1: MintedVideo = {
  property_id: PROP_ID_1,
  video_id: VIDEO_ID_1,
  signed_url: "https://storage.supabase.co/signed/prop1.mp4?token=abc",
};
const MINTED_2: MintedVideo = {
  property_id: PROP_ID_2,
  video_id: VIDEO_ID_2,
  signed_url: "https://storage.supabase.co/signed/prop2.mp4?token=def",
};
const MINTED_3: MintedVideo = {
  property_id: PROP_ID_3,
  video_id: VIDEO_ID_3,
  signed_url: "https://storage.supabase.co/signed/prop3.mp4?token=ghi",
};

// ── Factories de fakes — VideoUrlMinter ───────────────────────────────────────

interface FakeVideoUrlMinter extends VideoUrlMinter {
  calls: string[][];
}

function minter_ok(result: MintedVideo[]): FakeVideoUrlMinter {
  return {
    calls: [],
    mint_signed_urls(property_ids: string[]): Promise<MintedVideo[]> {
      this.calls.push(property_ids);
      return Promise.resolve(result);
    },
  } as FakeVideoUrlMinter;
}

function minter_throws(): FakeVideoUrlMinter {
  return {
    calls: [],
    mint_signed_urls(property_ids: string[]): Promise<MintedVideo[]> {
      this.calls.push(property_ids);
      return Promise.reject(new Error("storage unavailable"));
    },
  } as FakeVideoUrlMinter;
}

// ── Helpers de Request ────────────────────────────────────────────────────────

function post_request(body: unknown): Request {
  return new Request("http://localhost/mint-video-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function method_request(method: string): Request {
  return new Request("http://localhost/mint-video-url", { method });
}

function make_deps(minter: VideoUrlMinter): MintVideoUrlDeps {
  return { videoUrlMinter: minter };
}

// ── Happy path ────────────────────────────────────────────────────────────────

Deno.test("happy_path_un_property_id_retorna_200_con_un_video", async () => {
  const m = minter_ok([MINTED_1]);
  const res = await handler(post_request({ property_ids: [PROP_ID_1] }), make_deps(m));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertExists(body.videos, "body debe tener campo 'videos'");
  assertEquals(body.videos.length, 1, "videos debe tener 1 elemento");
});

Deno.test("happy_path_un_property_id_body_tiene_property_id_video_id_signed_url", async () => {
  const m = minter_ok([MINTED_1]);
  const res = await handler(post_request({ property_ids: [PROP_ID_1] }), make_deps(m));
  assertEquals(res.status, 200);
  const body = await res.json();
  const video = body.videos[0];
  assertEquals(video.property_id, PROP_ID_1, "videos[0].property_id debe coincidir");
  assertEquals(video.video_id, VIDEO_ID_1, "videos[0].video_id debe coincidir");
  assertEquals(video.signed_url, MINTED_1.signed_url, "videos[0].signed_url debe coincidir");
});

Deno.test("happy_path_batch_tres_property_ids_retorna_200_con_tres_videos", async () => {
  const m = minter_ok([MINTED_1, MINTED_2, MINTED_3]);
  const res = await handler(
    post_request({ property_ids: [PROP_ID_1, PROP_ID_2, PROP_ID_3] }),
    make_deps(m),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.videos.length, 3, "videos debe tener 3 elementos para un batch de 3");
});

Deno.test("happy_path_minter_llamado_exactamente_una_vez_con_array_exacto", async () => {
  const m = minter_ok([MINTED_1, MINTED_2]);
  const ids = [PROP_ID_1, PROP_ID_2];
  await handler(post_request({ property_ids: ids }), make_deps(m));
  assertEquals(m.calls.length, 1, "minter debe ser llamado exactamente una vez");
  assertEquals(
    m.calls[0],
    ids,
    "minter debe recibir el array de property_ids sin modificaciones (shape exacto)",
  );
});

// ── Exclusión silenciosa (decisión usuario — NUNCA 404) ───────────────────────

Deno.test("exclusion_property_sin_video_minter_retorna_vacio_200_videos_vacio", async () => {
  // El minter excluye silenciosamente los ids sin video válido → devuelve []
  // El handler NO debe retornar 404; retorna 200 con videos:[]
  const m = minter_ok([]);
  const res = await handler(post_request({ property_ids: [PROP_ID_1] }), make_deps(m));
  assertEquals(res.status, 200, "debe ser 200, no 404 — exclusión silenciosa");
  const body = await res.json();
  assertEquals(body.videos.length, 0, "videos debe ser array vacío cuando el minter no encuentra video");
});

Deno.test("exclusion_batch_parcial_minter_retorna_subconjunto_200_con_subconjunto", async () => {
  // Batch de 3 ids pero solo 1 tiene video → minter devuelve 1 elemento
  // Handler retorna 200 con ese subconjunto, no error
  const m = minter_ok([MINTED_2]); // solo PROP_ID_2 tiene video
  const res = await handler(
    post_request({ property_ids: [PROP_ID_1, PROP_ID_2, PROP_ID_3] }),
    make_deps(m),
  );
  assertEquals(res.status, 200, "batch parcial debe ser 200 con subconjunto");
  const body = await res.json();
  assertEquals(body.videos.length, 1, "videos debe contener solo el elemento con video");
  assertEquals(body.videos[0].property_id, PROP_ID_2);
});

// ── CORS / Métodos HTTP ───────────────────────────────────────────────────────

Deno.test("cors_options_preflight_retorna_200", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertEquals(
    res.status >= 200 && res.status <= 204,
    true,
    "OPTIONS debe retornar 200-204",
  );
});

Deno.test("cors_options_tiene_header_access_control_allow_origin", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertExists(
    res.headers.get("Access-Control-Allow-Origin"),
    "Preflight debe incluir Access-Control-Allow-Origin",
  );
});

Deno.test("metodo_get_retorna_405", async () => {
  const res = await handler(method_request("GET"));
  assertEquals(res.status, 405);
});

Deno.test("metodo_put_retorna_405", async () => {
  const res = await handler(method_request("PUT"));
  assertEquals(res.status, 405);
});

// ── Body / parse / validación de input ───────────────────────────────────────

Deno.test("body_no_json_retorna_400_invalid_input", async () => {
  const req = new Request("http://localhost/mint-video-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "esto no es json{{{",
  });
  const res = await handler(req, make_deps(minter_ok([])));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("payload_vacio_property_ids_ausente_retorna_400_invalid_input", async () => {
  const res = await handler(post_request({}), make_deps(minter_ok([])));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_ids_es_string_no_array_retorna_400_invalid_input", async () => {
  const res = await handler(
    post_request({ property_ids: "00000000-0000-0000-0000-000000000001" }),
    make_deps(minter_ok([])),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_ids_es_numero_no_array_retorna_400_invalid_input", async () => {
  const res = await handler(
    post_request({ property_ids: 42 }),
    make_deps(minter_ok([])),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_ids_array_vacio_retorna_400_invalid_input", async () => {
  const res = await handler(post_request({ property_ids: [] }), make_deps(minter_ok([])));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_ids_elemento_no_string_numero_retorna_400_invalid_input", async () => {
  const res = await handler(
    post_request({ property_ids: [123, PROP_ID_2] }),
    make_deps(minter_ok([])),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_ids_elemento_cadena_vacia_retorna_400_invalid_input", async () => {
  const res = await handler(
    post_request({ property_ids: [PROP_ID_1, ""] }),
    make_deps(minter_ok([])),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

// ── Fallo del minter → 500 INTERNAL_ERROR ────────────────────────────────────

Deno.test("minter_lanza_error_handler_retorna_500_internal_error", async () => {
  const m = minter_throws();
  const res = await handler(post_request({ property_ids: [PROP_ID_1] }), make_deps(m));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(
    body.error.code,
    "INTERNAL_ERROR",
    "error.code debe ser INTERNAL_ERROR cuando el minter lanza — no propagar excepción cruda",
  );
});

Deno.test("deps_undefined_handler_retorna_500_internal_error", async () => {
  // Cuando deps no se inyecta (undefined), el handler intenta usar deps.videoUrlMinter
  // → TypeError → debe capturarse y retornar 500 INTERNAL_ERROR
  const res = await handler(post_request({ property_ids: [PROP_ID_1] }));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "INTERNAL_ERROR");
});

// ── Forma invariante de errores ────────────────────────────────────────────────

Deno.test("error_respuesta_tiene_forma_error_code_message", async () => {
  // Verificar que cualquier respuesta de error sigue { error: { code, message } }
  const res = await handler(post_request({}), make_deps(minter_ok([])));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertExists(body.error, "respuesta de error debe tener campo 'error'");
  assertEquals(typeof body.error.code, "string", "error.code debe ser string");
  assertEquals(typeof body.error.message, "string", "error.message debe ser string");
});
