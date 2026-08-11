// supabase/functions/_shared/video_status_checker.test.ts
// Tests del VideoStatusChecker REAL (make_video_status_checker) — #126 (fix 73.4).
//
// El bug: el gate de publicar exigía status==='ready' Y duration_seconds en
// [60,120]. Pero la fila de property_videos nace 'uploading' (mint-upload-url)
// y SOLO el webhook de Stream la pasa a 'ready' llenando duration_seconds —
// nadie escribe 'processing' en DB jamás. Publicar recién subido → 409
// VIDEO_NOT_READY; y un 'ready' cuyo webhook no reportó duración → 400
// VIDEO_DURATION_INVALID sin salida posible desde la app.
//
// Contrato NUEVO (#126, alineado con la RPC publish_property_atomic, que
// enlaza videos con status in ('processing','ready')):
//   - uploading / failed / missing → VIDEO_NOT_READY / VIDEO_NOT_FOUND (igual).
//   - processing → OK (gate alineado con la RPC; hoy inalcanzable — nadie
//     escribe 'processing' en DB — pero el desalineamiento era el bug latente).
//   - duration_seconds se valida SOLO cuando se conoce (≠ null): fuera de
//     [60,120] → VIDEO_DURATION_INVALID. null → pasa (el cliente valida la
//     duración al elegir el video, ANTES de subir; bloquear aquí dejaba un
//     callejón sin salida al final del wizard).
//
// Matriz (testStrategy #126): {uploading, processing, ready, failed} ×
// {null, 45, 90, 150} + sin fila + error de query.

import { assertEquals } from "@std/assert";
import { make_video_status_checker } from "./clients.ts";

const UID = "cf-uid-test-126";
const AGENT = "00000000-0000-0000-0000-000000000001";

// Fake client mínimo: una sola query encadenable que resuelve maybeSingle().
function fake_client(
  response: { data: unknown; error: { message: string } | null },
) {
  const b = {
    select(_c?: string) {
      return this;
    },
    eq(_col: string, _v: unknown) {
      return this;
    },
    is(_col: string, _v: unknown) {
      return this;
    },
    maybeSingle() {
      return Promise.resolve(response);
    },
  };
  // deno-lint-ignore no-explicit-any
  return { from: (_t: string) => b } as any;
}

function row(status: string, duration_seconds: number | null) {
  return { data: { status, duration_seconds }, error: null };
}

// ── La matriz completa status × duration ──────────────────────────────────────
// expected: "ok" | error_code
const MATRIX: Array<[string, number | null, string]> = [
  // uploading: el binario aún no termina — nunca publicable, da igual la duración
  ["uploading", null, "VIDEO_NOT_READY"],
  ["uploading", 45, "VIDEO_NOT_READY"],
  ["uploading", 90, "VIDEO_NOT_READY"],
  ["uploading", 150, "VIDEO_NOT_READY"],
  // processing: subido, transcodificando — la RPC lo acepta, el checker también (#126)
  ["processing", null, "ok"],
  ["processing", 5, "VIDEO_DURATION_INVALID"],
  ["processing", 45, "ok"], // #149: el mínimo bajó a 10 s — 45 ya es válido
  ["processing", 90, "ok"],
  ["processing", 150, "VIDEO_DURATION_INVALID"],
  // ready: el caso pleno — duración conocida se valida [10,120] inclusive (#149)
  ["ready", null, "ok"], // #126: sin duración conocida NO bloquea (antes: 400 sin salida)
  ["ready", 5, "VIDEO_DURATION_INVALID"],
  ["ready", 45, "ok"], // #149
  ["ready", 90, "ok"],
  ["ready", 150, "VIDEO_DURATION_INVALID"],
  // failed: transcodificación muerta — jamás publicable
  ["failed", null, "VIDEO_NOT_READY"],
  ["failed", 45, "VIDEO_NOT_READY"],
  ["failed", 90, "VIDEO_NOT_READY"],
  ["failed", 150, "VIDEO_NOT_READY"],
];

Deno.test("checker_matriz_status_x_duration", async () => {
  for (const [status, duration, expected] of MATRIX) {
    const checker = make_video_status_checker(fake_client(row(status, duration)));
    const result = await checker.check(UID, AGENT);
    if (expected === "ok") {
      assertEquals(
        result.ok,
        true,
        `${status}×${duration}: se esperaba OK, se obtuvo ${
          result.ok ? "OK" : (result as { error_code: string }).error_code
        }`,
      );
    } else {
      assertEquals(result.ok, false, `${status}×${duration}: se esperaba ${expected}`);
      if (!result.ok) {
        assertEquals(result.error_code, expected, `${status}×${duration}`);
      }
    }
  }
});

// ── Bordes exactos de duración (inclusive por PRD §14 paso 5) ─────────────────

Deno.test("checker_ready_duration_10_y_120_son_validos_inclusive", async () => {
  // #149: el mínimo bajó de 60 a 10 s (decisión de producto 2026-08-10).
  for (const d of [10, 60, 120]) {
    const checker = make_video_status_checker(fake_client(row("ready", d)));
    const result = await checker.check(UID, AGENT);
    assertEquals(result.ok, true, `ready×${d} debe ser válido (límite inclusive)`);
  }
});

Deno.test("checker_ready_duration_9_y_121_son_invalidos", async () => {
  for (const d of [9, 121]) {
    const checker = make_video_status_checker(fake_client(row("ready", d)));
    const result = await checker.check(UID, AGENT);
    assertEquals(result.ok, false, `ready×${d} debe rechazarse`);
    if (!result.ok) assertEquals(result.error_code, "VIDEO_DURATION_INVALID");
  }
});

// ── Sin fila / error de query ─────────────────────────────────────────────────

Deno.test("checker_sin_fila_devuelve_VIDEO_NOT_FOUND", async () => {
  const checker = make_video_status_checker(fake_client({ data: null, error: null }));
  const result = await checker.check(UID, AGENT);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "VIDEO_NOT_FOUND");
});

Deno.test("checker_error_de_query_devuelve_VIDEO_NOT_FOUND_fail_closed", async () => {
  const checker = make_video_status_checker(
    fake_client({ data: null, error: { message: "boom" } }),
  );
  const result = await checker.check(UID, AGENT);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "VIDEO_NOT_FOUND");
});

// ── ok expone la duración conocida (o null si no la hay) ──────────────────────

Deno.test("checker_ok_expone_duration_seconds_conocida", async () => {
  const checker = make_video_status_checker(fake_client(row("ready", 90)));
  const result = await checker.check(UID, AGENT);
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.duration_seconds, 90);
});

Deno.test("checker_ok_sin_duracion_expone_null", async () => {
  const checker = make_video_status_checker(fake_client(row("ready", null)));
  const result = await checker.check(UID, AGENT);
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.duration_seconds, null);
});
