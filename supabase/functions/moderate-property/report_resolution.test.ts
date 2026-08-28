// supabase/functions/moderate-property/report_resolution.test.ts
//
// Tests RED — subtarea 220.3 (resolución admin de reportes, tarea 220 "reportes
// de usuarios", PRD §24). EXTENSIÓN ADITIVA de la EF moderate-property (ya
// desplegada, usada por la cola de revisiones #218 — decisión Abraham
// 2026-08-28: 1 EF con action parametrizada, moderacion.md, NO una EF nueva).
// Archivo HERMANO de handler.test.ts (mismo patrón que property_updater.test.ts
// de 73.9: concern nuevo, mismos handler.ts/types.ts, archivo de test propio en
// vez de inflar el archivo de 870 líneas ya existente).
//
// Framework: Deno.test + @std/assert (nativo Deno), igual que handler.test.ts.
// Runner: deno test --config supabase/functions/deno.json --allow-net
//   supabase/functions/moderate-property/report_resolution.test.ts
//
// SEAM bajo test: el mismo contrato HTTP de handler.ts (request → status+body)
// vía DI — NINGUNA de estas fakes toca Postgres real. Fase RED: handler.ts NO
// SE TOCA (extensión aditiva pendiente de GREEN) — con el código vigente, las
// 4 acciones nuevas caen en `action fuera del catálogo` → 400 INVALID_INPUT
// (parse_input/VALID_ACTIONS), así que TODOS los casos de abajo fallan por
// ASERCIÓN de status/body/llamadas-a-fakes, nunca por import ni compilación:
// el seam nuevo (`ReportsResolutionWriter` + acciones) se define en types.ts
// como PURO ADITIVO (types nuevos exportados, cero cambios a lo existente) —
// deno test type-checkea por defecto y esto compila limpio contra el types.ts
// ya extendido en este mismo commit RED.
//
// ════════════════════════════════════════════════════════════════════════════
// DECISIONES fijadas por el test-author (ver también types.ts y bitácora de
// la subtarea 220.3 en Taskmaster — sección SEAMS/DECISIONES):
//   - 4 acciones nuevas, literales DISTINTOS de los 4 vigentes:
//     restore | request_changes | keep_suspended | delete. NO se reusa
//     'needs_changes' (ya significa "resolver una property_revision" — el
//     origen 'suspended' es un contexto distinto, reusar el literal sería
//     ambiguo).
//   - Solo válidas si property.status === 'suspended' (mismo PropertyFetcher
//     ya existente decide el guard); si no, 400 INVALID_TRANSITION (mismo
//     código que ya usa la rama `suspend` para sus estados bloqueados) y
//     `reportsResolutionWriter`/`revisionFinder` NUNCA se llaman.
//   - Nunca tocan property_revisions (mismo criterio que 'suspend').
//   - status RESULTANTE en la respuesta: restore→active,
//     request_changes→needs_changes, keep_suspended→suspended,
//     delete→suspended (deleted_at es responsabilidad de la RPC, invisible en
//     el body de respuesta — igual que la RPC nunca expone deleted_at hoy).
// ════════════════════════════════════════════════════════════════════════════
//
// EDGE CASES (RED) — 220.3:
//
// ### Happy path — 4 acciones nuevas, origen 'suspended'
// - restore → 200 {status:'active'}, reportsResolutionWriter.apply({property_id,
//   admin_id, action_type:'restore', reason}), revisionFinder NUNCA llamado.
// - request_changes → 200 {status:'needs_changes'}, mismo contrato de writer.
// - keep_suspended → 200 {status:'suspended'}.
// - delete → 200 {status:'suspended'} (el body NO refleja deleted_at).
//
// ### Guard de origen — solo aplican sobre 'suspended'
// - restore/request_changes/keep_suspended/delete con property.status='active'
//   → 400 INVALID_TRANSITION, reportsResolutionWriter NUNCA se llama (4 tests).
//
// ### Auth / 404 / 500 — comunes a las 4, representativo con 'restore'
// - sin Authorization → 401 UNAUTHENTICATED, reportsResolutionWriter nunca se llama.
// - verifier FORBIDDEN → 403, reportsResolutionWriter nunca se llama.
// - propertyFetcher PROPERTY_NOT_FOUND → 404, reportsResolutionWriter nunca se llama.
// - reportsResolutionWriter DB_ERROR → 500 DB_ERROR.
//
// ### Boundary payload — el parseo común sigue aplicando
// - action fuera del catálogo TOTAL (ni los 4 vigentes ni los 4 nuevos, ej.
//   'archive') → 400 INVALID_INPUT.
// - reason no-string (number) con una acción nueva → 400 INVALID_INPUT.
// - reason vacío/espacios con una acción nueva → 400 INVALID_INPUT.
//
// ### Regresión (#218) — el contrato vigente queda INTACTO
// - approve SIN revisión activa y property.status='suspended' (nunca antes
//   ejercitado contra 'suspended' específicamente) → sigue 400
//   NOTHING_TO_MODERATE — la rama nueva NO intercepta las acciones vigentes.
// - reject SIN revisión activa y property.status='suspended' → 400
//   NOTHING_TO_MODERATE.
// - suspend sobre una propiedad YA 'suspended' → sigue permitido, 200 (
//   SUSPEND_BLOCKED_STATES no incluye 'suspended', sin cambios).
// - approve CON revisión activa sobre una propiedad 'suspended' → sigue
//   enrutando por la rama CON-revisión de siempre (moderationWriter llamado,
//   reportsResolutionWriter NUNCA).
// - needs_changes CON revisión activa sobre 'active' (smoke: el archivo
//   hermano no perturba el comportamiento vigente ya cubierto en
//   handler.test.ts).

import { assertEquals } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  ActiveRevisionResult,
  ModerateAction,
  ModeratePropertyDeps,
  ModerationWriteParams,
  ModerationWriteResult,
  ModerationWriter,
  PropertyFetchResult,
  PropertyFetcher,
  ReportsResolutionAction,
  ReportsResolutionWriteParams,
  ReportsResolutionWriteResult,
  ReportsResolutionWriter,
  RevisionFinder,
} from "./types.ts";
import type { AdminVerifier, AdminVerifyResult } from "../_shared/admin_auth.ts";

// ── Constantes ───────────────────────────────────────────────────────────────

const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const PROPERTY_ID = "00000000-0000-0000-0000-000000000002";
const REVISION_ID = "00000000-0000-0000-0000-000000000003";
const AUTH_HEADER = "Bearer admin.jwt.token";
const CHANGED_FIELDS = { price: 15500, description: "Depa remodelado, 2 recámaras" };

// ── Fakes — AdminVerifier ─────────────────────────────────────────────────────

interface FakeVerifier extends AdminVerifier {
  calls: (string | null)[];
}

function verifier_admin_ok(): FakeVerifier {
  return {
    calls: [],
    verify_caller(header: string | null): Promise<AdminVerifyResult> {
      this.calls.push(header);
      return Promise.resolve({ ok: true, user_id: ADMIN_ID });
    },
  } as FakeVerifier;
}

function verifier_unauthenticated(): FakeVerifier {
  return {
    calls: [],
    verify_caller(header: string | null): Promise<AdminVerifyResult> {
      this.calls.push(header);
      return Promise.resolve({ ok: false, error_code: "UNAUTHENTICATED" });
    },
  } as FakeVerifier;
}

function verifier_forbidden(): FakeVerifier {
  return {
    calls: [],
    verify_caller(header: string | null): Promise<AdminVerifyResult> {
      this.calls.push(header);
      return Promise.resolve({ ok: false, error_code: "FORBIDDEN" });
    },
  } as FakeVerifier;
}

// ── Fakes — PropertyFetcher ───────────────────────────────────────────────────

interface FakeFetcher extends PropertyFetcher {
  calls: string[];
}

function fetcher_status(status: string): FakeFetcher {
  return {
    calls: [],
    fetch(property_id: string): Promise<PropertyFetchResult> {
      this.calls.push(property_id);
      return Promise.resolve({ ok: true, property: { id: property_id, status } });
    },
  } as FakeFetcher;
}

function fetcher_not_found(): FakeFetcher {
  return {
    calls: [],
    fetch(property_id: string): Promise<PropertyFetchResult> {
      this.calls.push(property_id);
      return Promise.resolve({ ok: false, error_code: "PROPERTY_NOT_FOUND" });
    },
  } as FakeFetcher;
}

// ── Fakes — RevisionFinder ─────────────────────────────────────────────────────

interface FakeRevisionFinder extends RevisionFinder {
  calls: string[];
}

function revision_finder_none(): FakeRevisionFinder {
  return {
    calls: [],
    find_active(property_id: string): Promise<ActiveRevisionResult> {
      this.calls.push(property_id);
      return Promise.resolve({ ok: true, revision: null });
    },
  } as FakeRevisionFinder;
}

function revision_finder_active(
  status: "pending" | "needs_changes" = "pending",
): FakeRevisionFinder {
  return {
    calls: [],
    find_active(property_id: string): Promise<ActiveRevisionResult> {
      this.calls.push(property_id);
      return Promise.resolve({
        ok: true,
        revision: { id: REVISION_ID, status, changed_fields: CHANGED_FIELDS },
      });
    },
  } as FakeRevisionFinder;
}

// ── Fakes — ModerationWriter (las 4 acciones vigentes, #130) ──────────────────

interface FakeWriter extends ModerationWriter {
  calls: ModerationWriteParams[];
}

function writer_ok(): FakeWriter {
  return {
    calls: [],
    apply(params: ModerationWriteParams): Promise<ModerationWriteResult> {
      this.calls.push(params);
      return Promise.resolve({ ok: true });
    },
  } as FakeWriter;
}

// ── Fakes — ReportsResolutionWriter (220.3, seam NUEVO) ────────────────────────

interface FakeReportsWriter extends ReportsResolutionWriter {
  calls: ReportsResolutionWriteParams[];
}

function reports_writer_ok(): FakeReportsWriter {
  return {
    calls: [],
    apply(
      params: ReportsResolutionWriteParams,
    ): Promise<ReportsResolutionWriteResult> {
      this.calls.push(params);
      return Promise.resolve({ ok: true });
    },
  } as FakeReportsWriter;
}

function reports_writer_db_error(): FakeReportsWriter {
  return {
    calls: [],
    apply(
      params: ReportsResolutionWriteParams,
    ): Promise<ReportsResolutionWriteResult> {
      this.calls.push(params);
      return Promise.resolve({ ok: false, error_code: "DB_ERROR", message: "boom" });
    },
  } as FakeReportsWriter;
}

// ── Helpers de request ─────────────────────────────────────────────────────────

function make_request(
  method: string,
  body?: unknown,
  authHeader: string | null = AUTH_HEADER,
): Request {
  const headers = new Headers();
  if (authHeader !== null) headers.set("Authorization", authHeader);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return new Request("https://x.test/moderate-property", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Deliberadamente `action: string` (NO `ModerateAction`): los 4 literales
// nuevos NO forman parte del union tipado `ModerateAction` (decisión
// documentada arriba) — el payload HTTP siempre fue JSON sin tipar en el
// límite real, así que esto refleja el contrato observable real.
function report_payload(action: string, reason?: string) {
  const p: Record<string, unknown> = { property_id: PROPERTY_ID, action };
  if (reason !== undefined) p.reason = reason;
  return p;
}

function existing_payload(action: ModerateAction, reason?: string) {
  const p: Record<string, unknown> = { property_id: PROPERTY_ID, action };
  if (reason !== undefined) p.reason = reason;
  return p;
}

// Deps extendido LOCALMENTE con el seam nuevo — `ModeratePropertyDeps` (types.ts)
// NO se toca, así que un objeto con esta forma sigue siendo asignable donde el
// handler pide `ModeratePropertyDeps` (TS estructural: más propiedades de las
// requeridas es válido). handler.ts (sin GREEN) simplemente ignora la propiedad
// `reportsResolutionWriter` — no la lee todavía.
interface Deps extends ModeratePropertyDeps {
  adminVerifier: FakeVerifier;
  propertyFetcher: FakeFetcher;
  revisionFinder: FakeRevisionFinder;
  moderationWriter: FakeWriter;
  reportsResolutionWriter: FakeReportsWriter;
}

function build_deps(overrides: Partial<Deps> = {}): Deps {
  return {
    adminVerifier: verifier_admin_ok(),
    propertyFetcher: fetcher_status("suspended"),
    revisionFinder: revision_finder_none(),
    moderationWriter: writer_ok(),
    reportsResolutionWriter: reports_writer_ok(),
    ...overrides,
  };
}

const NEW_ACTIONS: ReportsResolutionAction[] = [
  "restore",
  "request_changes",
  "keep_suspended",
  "delete",
];
const NEW_ACTION_TARGET_STATUS: Record<ReportsResolutionAction, string> = {
  restore: "active",
  request_changes: "needs_changes",
  keep_suspended: "suspended",
  delete: "suspended",
};

// ════════════════════════════════════════════════════════════════════════════
// Happy path — 4 acciones nuevas, origen 'suspended'
// ════════════════════════════════════════════════════════════════════════════

for (const action of NEW_ACTIONS) {
  Deno.test(`${action}: propiedad 'suspended' → 200, status resultante '${NEW_ACTION_TARGET_STATUS[action]}', reportsResolutionWriter llamado, revisionFinder NUNCA`, async () => {
    const deps = build_deps();
    const res = await handler(
      make_request("POST", report_payload(action, "Reportes revisados")),
      deps,
    );

    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body, {
      property_id: PROPERTY_ID,
      status: NEW_ACTION_TARGET_STATUS[action],
    });

    assertEquals(deps.reportsResolutionWriter.calls, [
      {
        property_id: PROPERTY_ID,
        admin_id: ADMIN_ID,
        action_type: action,
        reason: "Reportes revisados",
      },
    ]);
    assertEquals(
      deps.revisionFinder.calls,
      [],
      "las acciones de resolución de reportes NUNCA consultan property_revisions",
    );
  });
}

Deno.test("restore sin reason → reportsResolutionWriter recibe reason:null", async () => {
  const deps = build_deps();
  const res = await handler(make_request("POST", report_payload("restore")), deps);

  assertEquals(res.status, 200);
  assertEquals(deps.reportsResolutionWriter.calls, [
    {
      property_id: PROPERTY_ID,
      admin_id: ADMIN_ID,
      action_type: "restore",
      reason: null,
    },
  ]);
});

// ════════════════════════════════════════════════════════════════════════════
// Guard de origen — solo aplican sobre property.status === 'suspended'
// ════════════════════════════════════════════════════════════════════════════

for (const action of NEW_ACTIONS) {
  Deno.test(`${action} sobre propiedad 'active' (nunca suspendida) → 400 INVALID_TRANSITION, reportsResolutionWriter NUNCA se llama`, async () => {
    const deps = build_deps({ propertyFetcher: fetcher_status("active") });
    const res = await handler(make_request("POST", report_payload(action)), deps);

    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error.code, "INVALID_TRANSITION");
    assertEquals(deps.reportsResolutionWriter.calls, []);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Auth / 404 / 500 — comunes a las 4 acciones, representativo con 'restore'
// ════════════════════════════════════════════════════════════════════════════

Deno.test("restore sin Authorization header → 401 UNAUTHENTICATED, reportsResolutionWriter nunca se llama", async () => {
  const deps = build_deps({ adminVerifier: verifier_unauthenticated() });
  const res = await handler(make_request("POST", report_payload("restore"), null), deps);

  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
  assertEquals(deps.reportsResolutionWriter.calls, []);
});

Deno.test("restore con verifier FORBIDDEN (no-admin) → 403, reportsResolutionWriter nunca se llama", async () => {
  const deps = build_deps({ adminVerifier: verifier_forbidden() });
  const res = await handler(make_request("POST", report_payload("restore")), deps);

  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "FORBIDDEN");
  assertEquals(deps.reportsResolutionWriter.calls, []);
});

Deno.test("restore sobre property inexistente → 404 PROPERTY_NOT_FOUND, reportsResolutionWriter nunca se llama", async () => {
  const deps = build_deps({ propertyFetcher: fetcher_not_found() });
  const res = await handler(make_request("POST", report_payload("restore")), deps);

  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error.code, "PROPERTY_NOT_FOUND");
  assertEquals(deps.reportsResolutionWriter.calls, []);
});

Deno.test("delete con reportsResolutionWriter DB_ERROR → 500 DB_ERROR", async () => {
  const deps = build_deps({ reportsResolutionWriter: reports_writer_db_error() });
  const res = await handler(make_request("POST", report_payload("delete")), deps);

  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "DB_ERROR");
  assertEquals(deps.reportsResolutionWriter.calls.length, 1);
});

// ════════════════════════════════════════════════════════════════════════════
// Boundary payload — el parseo común sigue aplicando
// ════════════════════════════════════════════════════════════════════════════

Deno.test("action fuera del catálogo TOTAL ('archive', ni vigente ni nueva) → 400 INVALID_INPUT", async () => {
  const deps = build_deps();
  const res = await handler(make_request("POST", report_payload("archive")), deps);

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
  assertEquals(deps.reportsResolutionWriter.calls, []);
});

Deno.test("delete con reason no-string (number) → 400 INVALID_INPUT", async () => {
  const deps = build_deps();
  const res = await handler(
    make_request("POST", { property_id: PROPERTY_ID, action: "delete", reason: 42 }),
    deps,
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("delete con reason vacío/solo espacios → 400 INVALID_INPUT", async () => {
  const deps = build_deps();
  const res = await handler(
    make_request("POST", { property_id: PROPERTY_ID, action: "delete", reason: "   " }),
    deps,
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

// ════════════════════════════════════════════════════════════════════════════
// Regresión (#218) — el contrato vigente de las 4 acciones ORIGINALES queda
// INTACTO. Ninguno de estos casos se había ejercitado antes contra
// property.status='suspended' específicamente — son la protección real contra
// que la rama nueva intercepte por accidente las acciones vigentes.
// ════════════════════════════════════════════════════════════════════════════

Deno.test("REGRESIÓN approve SIN revisión activa sobre property.status='suspended' → sigue 400 NOTHING_TO_MODERATE (la rama nueva no la intercepta)", async () => {
  const deps = build_deps({
    propertyFetcher: fetcher_status("suspended"),
    revisionFinder: revision_finder_none(),
  });
  const res = await handler(make_request("POST", existing_payload("approve")), deps);

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "NOTHING_TO_MODERATE");
  assertEquals(deps.moderationWriter.calls, []);
  assertEquals(deps.reportsResolutionWriter.calls, []);
});

Deno.test("REGRESIÓN reject SIN revisión activa sobre property.status='suspended' → sigue 400 NOTHING_TO_MODERATE", async () => {
  const deps = build_deps({
    propertyFetcher: fetcher_status("suspended"),
    revisionFinder: revision_finder_none(),
  });
  const res = await handler(make_request("POST", existing_payload("reject")), deps);

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "NOTHING_TO_MODERATE");
  assertEquals(deps.reportsResolutionWriter.calls, []);
});

Deno.test("REGRESIÓN suspend sobre propiedad YA 'suspended' → sigue permitido, 200 (SUSPEND_BLOCKED_STATES sin cambios)", async () => {
  const deps = build_deps({ propertyFetcher: fetcher_status("suspended") });
  const res = await handler(
    make_request("POST", existing_payload("suspend", "Nuevo reporte de fraude")),
    deps,
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { property_id: PROPERTY_ID, status: "suspended" });
  assertEquals(deps.moderationWriter.calls.length, 1);
  assertEquals(deps.reportsResolutionWriter.calls, []);
});

Deno.test("REGRESIÓN approve CON revisión activa sobre property.status='suspended' → sigue enrutando por la rama CON-revisión de siempre, reportsResolutionWriter NUNCA", async () => {
  const deps = build_deps({
    propertyFetcher: fetcher_status("suspended"),
    revisionFinder: revision_finder_active("pending"),
  });
  const res = await handler(make_request("POST", existing_payload("approve")), deps);

  assertEquals(res.status, 200);
  assertEquals(deps.moderationWriter.calls.length, 1);
  assertEquals(deps.moderationWriter.calls[0].action_type, "approve");
  assertEquals(deps.reportsResolutionWriter.calls, []);
});

Deno.test("REGRESIÓN needs_changes CON revisión activa sobre 'active' (smoke: el archivo hermano no perturba el contrato vigente ya cubierto en handler.test.ts)", async () => {
  const deps = build_deps({
    propertyFetcher: fetcher_status("active"),
    revisionFinder: revision_finder_active("pending"),
  });
  const res = await handler(
    make_request("POST", existing_payload("needs_changes", "Falta permiso de venta")),
    deps,
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { property_id: PROPERTY_ID, status: "active" });
  assertEquals(deps.moderationWriter.calls.length, 1);
  assertEquals(deps.reportsResolutionWriter.calls, []);
});
