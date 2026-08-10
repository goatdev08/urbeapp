// supabase/functions/moderate-property/handler.test.ts
// Tests RED — subtarea 73.9 (aprobación admin, PRD §15.6)
// Edge Function: moderate-property/handler.ts
// Framework: Deno.test + @std/assert (nativo Deno)
// Runner: deno test --allow-net supabase/functions/moderate-property/handler.test.ts
//
// SEAM bajo test: el contrato público del handler HTTP (request → status + body)
// construido sobre 6 dependencias inyectables puras (AdminVerifier, PropertyFetcher,
// RevisionFinder, PropertyUpdater, RevisionResolver, AdminActionRecorder) — ninguna
// habla con Postgres real, todas son fakes que graban sus llamadas. Fase RED:
// handler.ts es un STUB que SIEMPRE devuelve 501 NOT_IMPLEMENTED (sin lógica de
// negocio) — cada caso de abajo falla por aserción de status/body, nunca por import.
//
// EDGE CASES (RED) — 73.9:
//
// ### Happy path — grid 3×2 (approve|needs_changes|reject × con-revisión|sin-revisión)
// - approve CON revisión activa → 200, apply_revision_snapshot(property_id, changed_fields),
//   revisionResolver.resolve(status='approved', reason=null), properties.status NO cambia
//   (propertyUpdater.set_status NO se llama), admin_actions con old/new_values de revision_status
// - needs_changes CON revisión activa → 200, revisionResolver.resolve(status='needs_changes',
//   reason=payload.reason), propertyUpdater NO se llama (ni set_status ni apply_revision_snapshot),
//   admin_actions con old/new_values de revision_status
// - reject CON revisión activa → 200, revisionResolver.resolve(status='rejected', reason=payload.reason),
//   propertyUpdater NO se llama, admin_actions con old/new_values de revision_status
// - approve SIN revisión (properties.status='pending_review') → 200, propertyUpdater.set_status(id,'active'),
//   revisionResolver NO se llama, admin_actions con old/new_values de status
// - needs_changes SIN revisión → 200, propertyUpdater.set_status(id,'needs_changes'), revisionResolver NO se llama
// - reject SIN revisión → 200, propertyUpdater.set_status(id,'rejected'), revisionResolver NO se llama
//
// ### Rama suspend (independiente del estado de la revisión — PRD §15.6 excepción)
// - suspend desde 'active' → 200, propertyUpdater.set_status(id,'suspended'), revisionFinder NUNCA llamado
// - suspend desde 'pending_review' → 200, propertyUpdater.set_status(id,'suspended')
// - suspend con una revisión 'pending' YA EXISTENTE → 200, revisionFinder.calls.length===0 Y
//   revisionResolver.calls.length===0 (la revisión pendiente se queda intacta, sin tocar)
// - suspend con properties.status='sold' (terminal) → 400 INVALID_TRANSITION, propertyUpdater NO se llama
// - suspend con properties.status='rented' (terminal) → 400 INVALID_TRANSITION
// - suspend con properties.status='deleted_hard' (terminal) → 400 INVALID_TRANSITION
// - suspend con properties.status='deleted_soft' (terminal) → 400 INVALID_TRANSITION
//
// ### Ramas de reglas no obvias
// - approve/needs_changes/reject SIN revisión activa Y properties.status≠'pending_review'
//   (ej. 'active', nada que resolver) → 400 NOTHING_TO_MODERATE, ningún updater/resolver/recorder se llama
// - admin_actions.action_type === el action del payload en TODAS las ramas (approve/needs_changes/reject/suspend)
// - admin_actions.reason === payload.reason ?? null en TODAS las ramas (incluida approve, donde
//   rejection_reason de la revisión es null pero el log de auditoría igual guarda lo que mandó el admin)
//
// ### Auth — AdminVerifier DI (_shared/admin_auth.ts)
// - Sin Authorization header → verifier llamado con null → 401 UNAUTHENTICATED, ningún otro dep se llama
// - Verifier devuelve FORBIDDEN (no-admin) → 403, ningún otro dep se llama
// - Verifier recibe el header Authorization exacto de la petición
//
// ### 404
// - propertyFetcher devuelve PROPERTY_NOT_FOUND → 404, revisionFinder/propertyUpdater/
//   revisionResolver/adminActionRecorder NUNCA se llaman
//
// ### Boundary / error de payload
// - Body no-JSON → 400 INVALID_INPUT
// - Payload vacío {} → 400 INVALID_INPUT
// - property_id ausente → 400 INVALID_INPUT
// - property_id cadena vacía → 400 INVALID_INPUT
// - property_id solo espacios → 400 INVALID_INPUT
// - action ausente → 400 INVALID_INPUT
// - action con valor fuera del enum ('delete') → 400 INVALID_INPUT
// - reason presente pero no-string (number) → 400 INVALID_INPUT
// - reason presente pero cadena vacía/solo espacios → 400 INVALID_INPUT
//
// ### CORS / Métodos HTTP
// - OPTIONS → 200 con header Access-Control-Allow-Origin
// - OPTIONS → header Access-Control-Allow-Methods presente
// - GET → 405
// - PUT → 405
// - DELETE → 405
//
// ### DB_ERROR (500) — cada dependencia inyectada puede fallar
// - propertyFetcher DB_ERROR → 500, ningún otro dep se llama
// - revisionFinder DB_ERROR → 500 (rama approve/needs_changes/reject)
// - propertyUpdater.set_status DB_ERROR → 500 (rama sin-revisión)
// - propertyUpdater.apply_revision_snapshot DB_ERROR → 500 (approve con-revisión);
//   revisionResolver NO se llama tras el fallo (no se cierra la revisión si el snapshot no se aplicó)
// - revisionResolver DB_ERROR → 500 (needs_changes con-revisión); adminActionRecorder NO se llama
// - adminActionRecorder DB_ERROR → 500 aunque la escritura principal ya haya tenido éxito
//   (la acción de moderación no se considera completa sin su auditoría)

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  ActiveRevisionResult,
  AdminActionRecordParams,
  AdminActionRecordResult,
  AdminActionRecorder,
  ModerateAction,
  ModeratePropertyDeps,
  PropertyFetchResult,
  PropertyFetcher,
  PropertyUpdater,
  PropertyWriteResult,
  RevisionFinder,
  RevisionResolveParams,
  RevisionResolveResult,
  RevisionResolver,
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

function fetcher_db_error(): FakeFetcher {
  return {
    calls: [],
    fetch(property_id: string): Promise<PropertyFetchResult> {
      this.calls.push(property_id);
      return Promise.resolve({ ok: false, error_code: "DB_ERROR", message: "boom" });
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

function revision_finder_active(status: "pending" | "needs_changes" = "pending"): FakeRevisionFinder {
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

function revision_finder_db_error(): FakeRevisionFinder {
  return {
    calls: [],
    find_active(property_id: string): Promise<ActiveRevisionResult> {
      this.calls.push(property_id);
      return Promise.resolve({ ok: false, error_code: "DB_ERROR", message: "boom" });
    },
  } as FakeRevisionFinder;
}

// ── Fakes — PropertyUpdater ────────────────────────────────────────────────────

interface FakeUpdater extends PropertyUpdater {
  set_status_calls: { property_id: string; status: string }[];
  apply_revision_calls: { property_id: string; changed_fields: Record<string, unknown> }[];
}

function updater_ok(): FakeUpdater {
  return {
    set_status_calls: [],
    apply_revision_calls: [],
    set_status(property_id: string, status: string): Promise<PropertyWriteResult> {
      this.set_status_calls.push({ property_id, status });
      return Promise.resolve({ ok: true });
    },
    apply_revision_snapshot(
      property_id: string,
      changed_fields: Record<string, unknown>,
    ): Promise<PropertyWriteResult> {
      this.apply_revision_calls.push({ property_id, changed_fields });
      return Promise.resolve({ ok: true });
    },
  } as FakeUpdater;
}

function updater_set_status_fails(): FakeUpdater {
  const u = updater_ok();
  u.set_status = function (property_id: string, status: string): Promise<PropertyWriteResult> {
    this.set_status_calls.push({ property_id, status });
    return Promise.resolve({ ok: false, error_code: "DB_ERROR", message: "boom" });
  };
  return u;
}

function updater_apply_revision_fails(): FakeUpdater {
  const u = updater_ok();
  u.apply_revision_snapshot = function (
    property_id: string,
    changed_fields: Record<string, unknown>,
  ): Promise<PropertyWriteResult> {
    this.apply_revision_calls.push({ property_id, changed_fields });
    return Promise.resolve({ ok: false, error_code: "DB_ERROR", message: "boom" });
  };
  return u;
}

// ── Fakes — RevisionResolver ───────────────────────────────────────────────────

interface FakeResolver extends RevisionResolver {
  calls: RevisionResolveParams[];
}

function resolver_ok(): FakeResolver {
  return {
    calls: [],
    resolve(params: RevisionResolveParams): Promise<RevisionResolveResult> {
      this.calls.push(params);
      return Promise.resolve({ ok: true });
    },
  } as FakeResolver;
}

function resolver_db_error(): FakeResolver {
  return {
    calls: [],
    resolve(params: RevisionResolveParams): Promise<RevisionResolveResult> {
      this.calls.push(params);
      return Promise.resolve({ ok: false, error_code: "DB_ERROR", message: "boom" });
    },
  } as FakeResolver;
}

// ── Fakes — AdminActionRecorder ────────────────────────────────────────────────

interface FakeRecorder extends AdminActionRecorder {
  calls: AdminActionRecordParams[];
}

function recorder_ok(): FakeRecorder {
  return {
    calls: [],
    record(params: AdminActionRecordParams): Promise<AdminActionRecordResult> {
      this.calls.push(params);
      return Promise.resolve({ ok: true });
    },
  } as FakeRecorder;
}

function recorder_db_error(): FakeRecorder {
  return {
    calls: [],
    record(params: AdminActionRecordParams): Promise<AdminActionRecordResult> {
      this.calls.push(params);
      return Promise.resolve({ ok: false, error_code: "DB_ERROR", message: "boom" });
    },
  } as FakeRecorder;
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

function payload(action: ModerateAction, reason?: string) {
  const p: Record<string, unknown> = { property_id: PROPERTY_ID, action };
  if (reason !== undefined) p.reason = reason;
  return p;
}

interface Deps extends ModeratePropertyDeps {
  adminVerifier: FakeVerifier;
  propertyFetcher: FakeFetcher;
  revisionFinder: FakeRevisionFinder;
  propertyUpdater: FakeUpdater;
  revisionResolver: FakeResolver;
  adminActionRecorder: FakeRecorder;
}

function build_deps(overrides: Partial<Deps> = {}): Deps {
  return {
    adminVerifier: verifier_admin_ok(),
    propertyFetcher: fetcher_status("active"),
    revisionFinder: revision_finder_none(),
    propertyUpdater: updater_ok(),
    revisionResolver: resolver_ok(),
    adminActionRecorder: recorder_ok(),
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Happy path — grid 3×2
// ════════════════════════════════════════════════════════════════════════════

Deno.test("approve CON revisión activa: aplica snapshot completo, resuelve revisión, NO cambia properties.status", async () => {
  const deps = build_deps({
    propertyFetcher: fetcher_status("active"),
    revisionFinder: revision_finder_active("pending"),
  });
  const res = await handler(make_request("POST", payload("approve")), deps);

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { property_id: PROPERTY_ID, status: "active" });

  assertEquals(deps.propertyUpdater.apply_revision_calls, [
    { property_id: PROPERTY_ID, changed_fields: CHANGED_FIELDS },
  ]);
  assertEquals(deps.propertyUpdater.set_status_calls, []);
  assertEquals(deps.revisionResolver.calls, [
    { revision_id: REVISION_ID, status: "approved", admin_id: ADMIN_ID, reason: null },
  ]);
  assertEquals(deps.adminActionRecorder.calls, [
    {
      admin_id: ADMIN_ID,
      action_type: "approve",
      entity_type: "property",
      entity_id: PROPERTY_ID,
      old_values: { revision_status: "pending" },
      new_values: { revision_status: "approved" },
      reason: null,
    },
  ]);
});

Deno.test("needs_changes CON revisión activa: revisión→needs_changes con reason, properties intacta", async () => {
  const deps = build_deps({
    propertyFetcher: fetcher_status("active"),
    revisionFinder: revision_finder_active("pending"),
  });
  const res = await handler(
    make_request("POST", payload("needs_changes", "Falta permiso de venta")),
    deps,
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { property_id: PROPERTY_ID, status: "active" });

  assertEquals(deps.propertyUpdater.set_status_calls, []);
  assertEquals(deps.propertyUpdater.apply_revision_calls, []);
  assertEquals(deps.revisionResolver.calls, [
    {
      revision_id: REVISION_ID,
      status: "needs_changes",
      admin_id: ADMIN_ID,
      reason: "Falta permiso de venta",
    },
  ]);
  assertEquals(deps.adminActionRecorder.calls, [
    {
      admin_id: ADMIN_ID,
      action_type: "needs_changes",
      entity_type: "property",
      entity_id: PROPERTY_ID,
      old_values: { revision_status: "pending" },
      new_values: { revision_status: "needs_changes" },
      reason: "Falta permiso de venta",
    },
  ]);
});

Deno.test("reject CON revisión activa: revisión→rejected con reason, properties intacta", async () => {
  const deps = build_deps({
    propertyFetcher: fetcher_status("active"),
    revisionFinder: revision_finder_active("needs_changes"),
  });
  const res = await handler(
    make_request("POST", payload("reject", "Contenido fraudulento")),
    deps,
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { property_id: PROPERTY_ID, status: "active" });

  assertEquals(deps.propertyUpdater.set_status_calls, []);
  assertEquals(deps.propertyUpdater.apply_revision_calls, []);
  assertEquals(deps.revisionResolver.calls, [
    {
      revision_id: REVISION_ID,
      status: "rejected",
      admin_id: ADMIN_ID,
      reason: "Contenido fraudulento",
    },
  ]);
  assertEquals(deps.adminActionRecorder.calls, [
    {
      admin_id: ADMIN_ID,
      action_type: "reject",
      entity_type: "property",
      entity_id: PROPERTY_ID,
      old_values: { revision_status: "needs_changes" },
      new_values: { revision_status: "rejected" },
      reason: "Contenido fraudulento",
    },
  ]);
});

Deno.test("approve SIN revisión (publicación inicial pending_review) → properties.status='active'", async () => {
  const deps = build_deps({ propertyFetcher: fetcher_status("pending_review") });
  const res = await handler(make_request("POST", payload("approve")), deps);

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { property_id: PROPERTY_ID, status: "active" });

  assertEquals(deps.revisionFinder.calls, [PROPERTY_ID]);
  assertEquals(deps.propertyUpdater.set_status_calls, [
    { property_id: PROPERTY_ID, status: "active" },
  ]);
  assertEquals(deps.propertyUpdater.apply_revision_calls, []);
  assertEquals(deps.revisionResolver.calls, []);
  assertEquals(deps.adminActionRecorder.calls, [
    {
      admin_id: ADMIN_ID,
      action_type: "approve",
      entity_type: "property",
      entity_id: PROPERTY_ID,
      old_values: { status: "pending_review" },
      new_values: { status: "active" },
      reason: null,
    },
  ]);
});

Deno.test("needs_changes SIN revisión (publicación inicial) → properties.status='needs_changes'", async () => {
  const deps = build_deps({ propertyFetcher: fetcher_status("pending_review") });
  const res = await handler(
    make_request("POST", payload("needs_changes", "Falta video")),
    deps,
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { property_id: PROPERTY_ID, status: "needs_changes" });

  assertEquals(deps.propertyUpdater.set_status_calls, [
    { property_id: PROPERTY_ID, status: "needs_changes" },
  ]);
  assertEquals(deps.revisionResolver.calls, []);
  assertEquals(deps.adminActionRecorder.calls, [
    {
      admin_id: ADMIN_ID,
      action_type: "needs_changes",
      entity_type: "property",
      entity_id: PROPERTY_ID,
      old_values: { status: "pending_review" },
      new_values: { status: "needs_changes" },
      reason: "Falta video",
    },
  ]);
});

Deno.test("reject SIN revisión (publicación inicial) → properties.status='rejected'", async () => {
  const deps = build_deps({ propertyFetcher: fetcher_status("pending_review") });
  const res = await handler(
    make_request("POST", payload("reject", "Dirección inexistente")),
    deps,
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { property_id: PROPERTY_ID, status: "rejected" });

  assertEquals(deps.propertyUpdater.set_status_calls, [
    { property_id: PROPERTY_ID, status: "rejected" },
  ]);
  assertEquals(deps.revisionResolver.calls, []);
  assertEquals(deps.adminActionRecorder.calls, [
    {
      admin_id: ADMIN_ID,
      action_type: "reject",
      entity_type: "property",
      entity_id: PROPERTY_ID,
      old_values: { status: "pending_review" },
      new_values: { status: "rejected" },
      reason: "Dirección inexistente",
    },
  ]);
});

// ════════════════════════════════════════════════════════════════════════════
// Rama suspend
// ════════════════════════════════════════════════════════════════════════════

Deno.test("suspend desde 'active' → properties.status='suspended', revisionFinder NUNCA llamado", async () => {
  const deps = build_deps({ propertyFetcher: fetcher_status("active") });
  const res = await handler(
    make_request("POST", payload("suspend", "Reporte de fraude")),
    deps,
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { property_id: PROPERTY_ID, status: "suspended" });

  assertEquals(deps.revisionFinder.calls, []);
  assertEquals(deps.propertyUpdater.set_status_calls, [
    { property_id: PROPERTY_ID, status: "suspended" },
  ]);
  assertEquals(deps.adminActionRecorder.calls, [
    {
      admin_id: ADMIN_ID,
      action_type: "suspend",
      entity_type: "property",
      entity_id: PROPERTY_ID,
      old_values: { status: "active" },
      new_values: { status: "suspended" },
      reason: "Reporte de fraude",
    },
  ]);
});

Deno.test("suspend desde 'pending_review' → properties.status='suspended'", async () => {
  const deps = build_deps({ propertyFetcher: fetcher_status("pending_review") });
  const res = await handler(make_request("POST", payload("suspend")), deps);

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { property_id: PROPERTY_ID, status: "suspended" });
  assertEquals(deps.propertyUpdater.set_status_calls, [
    { property_id: PROPERTY_ID, status: "suspended" },
  ]);
});

Deno.test("suspend con una revisión 'pending' YA EXISTENTE: la revisión se queda intacta (revisionFinder/revisionResolver nunca se tocan)", async () => {
  const deps = build_deps({
    propertyFetcher: fetcher_status("active"),
    revisionFinder: revision_finder_active("pending"),
  });
  const res = await handler(make_request("POST", payload("suspend")), deps);

  assertEquals(res.status, 200);
  assertEquals(deps.revisionFinder.calls.length, 0, "suspend nunca consulta property_revisions");
  assertEquals(deps.revisionResolver.calls.length, 0, "suspend nunca resuelve property_revisions");
});

Deno.test("suspend con properties.status='sold' (terminal) → 400 INVALID_TRANSITION, sin escritura", async () => {
  const deps = build_deps({ propertyFetcher: fetcher_status("sold") });
  const res = await handler(make_request("POST", payload("suspend")), deps);

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_TRANSITION");
  assertEquals(deps.propertyUpdater.set_status_calls, []);
  assertEquals(deps.adminActionRecorder.calls, []);
});

Deno.test("suspend con properties.status='rented' (terminal) → 400 INVALID_TRANSITION", async () => {
  const deps = build_deps({ propertyFetcher: fetcher_status("rented") });
  const res = await handler(make_request("POST", payload("suspend")), deps);

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_TRANSITION");
});

Deno.test("suspend con properties.status='deleted_hard' (terminal) → 400 INVALID_TRANSITION", async () => {
  const deps = build_deps({ propertyFetcher: fetcher_status("deleted_hard") });
  const res = await handler(make_request("POST", payload("suspend")), deps);

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_TRANSITION");
});

Deno.test("suspend con properties.status='deleted_soft' (terminal) → 400 INVALID_TRANSITION", async () => {
  const deps = build_deps({ propertyFetcher: fetcher_status("deleted_soft") });
  const res = await handler(make_request("POST", payload("suspend")), deps);

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_TRANSITION");
});

// ════════════════════════════════════════════════════════════════════════════
// Ramas de reglas no obvias — nada que resolver
// ════════════════════════════════════════════════════════════════════════════

Deno.test("approve SIN revisión Y properties.status≠'pending_review' → 400 NOTHING_TO_MODERATE, sin escritura", async () => {
  const deps = build_deps({ propertyFetcher: fetcher_status("active") });
  const res = await handler(make_request("POST", payload("approve")), deps);

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "NOTHING_TO_MODERATE");
  assertEquals(deps.propertyUpdater.set_status_calls, []);
  assertEquals(deps.propertyUpdater.apply_revision_calls, []);
  assertEquals(deps.revisionResolver.calls, []);
  assertEquals(deps.adminActionRecorder.calls, []);
});

Deno.test("reject SIN revisión Y properties.status≠'pending_review' → 400 NOTHING_TO_MODERATE", async () => {
  const deps = build_deps({ propertyFetcher: fetcher_status("paused") });
  const res = await handler(make_request("POST", payload("reject")), deps);

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "NOTHING_TO_MODERATE");
});

// ════════════════════════════════════════════════════════════════════════════
// Auth
// ════════════════════════════════════════════════════════════════════════════

Deno.test("sin Authorization header → verifier llamado con null → 401 UNAUTHENTICATED, ningún otro dep se llama", async () => {
  const deps = build_deps({ adminVerifier: verifier_unauthenticated() });
  const res = await handler(make_request("POST", payload("approve"), null), deps);

  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
  assertEquals(deps.adminVerifier.calls, [null]);
  assertEquals(deps.propertyFetcher.calls, []);
});

Deno.test("verifier FORBIDDEN (no-admin) → 403, ningún otro dep se llama", async () => {
  const deps = build_deps({ adminVerifier: verifier_forbidden() });
  const res = await handler(make_request("POST", payload("approve")), deps);

  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "FORBIDDEN");
  assertEquals(deps.propertyFetcher.calls, []);
});

Deno.test("verifier recibe el header Authorization exacto de la petición", async () => {
  const deps = build_deps({ propertyFetcher: fetcher_status("pending_review") });
  await handler(make_request("POST", payload("approve"), "Bearer xyz-token"), deps);

  assertEquals(deps.adminVerifier.calls, ["Bearer xyz-token"]);
});

// ════════════════════════════════════════════════════════════════════════════
// 404
// ════════════════════════════════════════════════════════════════════════════

Deno.test("property inexistente → 404 PROPERTY_NOT_FOUND, ningún otro dep se llama", async () => {
  const deps = build_deps({ propertyFetcher: fetcher_not_found() });
  const res = await handler(make_request("POST", payload("approve")), deps);

  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error.code, "PROPERTY_NOT_FOUND");
  assertEquals(deps.revisionFinder.calls, []);
  assertEquals(deps.propertyUpdater.set_status_calls, []);
  assertEquals(deps.adminActionRecorder.calls, []);
});

// ════════════════════════════════════════════════════════════════════════════
// Body / parse
// ════════════════════════════════════════════════════════════════════════════

Deno.test("body no-JSON → 400 INVALID_INPUT", async () => {
  const deps = build_deps();
  const req = new Request("https://x.test/moderate-property", {
    method: "POST",
    headers: { Authorization: AUTH_HEADER, "Content-Type": "application/json" },
    body: "esto no es json{{{",
  });
  const res = await handler(req, deps);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("payload vacío {} → 400 INVALID_INPUT", async () => {
  const res = await handler(make_request("POST", {}), build_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_id ausente → 400 INVALID_INPUT", async () => {
  const res = await handler(make_request("POST", { action: "approve" }), build_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_id cadena vacía → 400 INVALID_INPUT", async () => {
  const res = await handler(
    make_request("POST", { property_id: "", action: "approve" }),
    build_deps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_id solo espacios → 400 INVALID_INPUT", async () => {
  const res = await handler(
    make_request("POST", { property_id: "   ", action: "approve" }),
    build_deps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("action ausente → 400 INVALID_INPUT", async () => {
  const res = await handler(
    make_request("POST", { property_id: PROPERTY_ID }),
    build_deps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("action fuera del enum ('delete') → 400 INVALID_INPUT", async () => {
  const res = await handler(
    make_request("POST", { property_id: PROPERTY_ID, action: "delete" }),
    build_deps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("reason presente pero no-string (number) → 400 INVALID_INPUT", async () => {
  const res = await handler(
    make_request("POST", { property_id: PROPERTY_ID, action: "reject", reason: 42 }),
    build_deps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("reason presente pero cadena vacía/solo espacios → 400 INVALID_INPUT", async () => {
  const res = await handler(
    make_request("POST", { property_id: PROPERTY_ID, action: "reject", reason: "   " }),
    build_deps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

// ════════════════════════════════════════════════════════════════════════════
// CORS / Métodos HTTP
// ════════════════════════════════════════════════════════════════════════════

Deno.test("OPTIONS → 200 con header Access-Control-Allow-Origin", async () => {
  const res = await handler(make_request("OPTIONS"), build_deps());
  assertEquals(res.status, 200);
  assertExists(res.headers.get("Access-Control-Allow-Origin"));
});

Deno.test("OPTIONS → header Access-Control-Allow-Methods presente", async () => {
  const res = await handler(make_request("OPTIONS"), build_deps());
  assertExists(res.headers.get("Access-Control-Allow-Methods"));
});

Deno.test("GET → 405", async () => {
  const res = await handler(make_request("GET"), build_deps());
  assertEquals(res.status, 405);
});

Deno.test("PUT → 405", async () => {
  const res = await handler(make_request("PUT"), build_deps());
  assertEquals(res.status, 405);
});

Deno.test("DELETE → 405", async () => {
  const res = await handler(make_request("DELETE"), build_deps());
  assertEquals(res.status, 405);
});

// ════════════════════════════════════════════════════════════════════════════
// DB_ERROR (500)
// ════════════════════════════════════════════════════════════════════════════

Deno.test("propertyFetcher DB_ERROR → 500, ningún otro dep se llama", async () => {
  const deps = build_deps({ propertyFetcher: fetcher_db_error() });
  const res = await handler(make_request("POST", payload("approve")), deps);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "DB_ERROR");
  assertEquals(deps.revisionFinder.calls, []);
});

Deno.test("revisionFinder DB_ERROR → 500", async () => {
  const deps = build_deps({ revisionFinder: revision_finder_db_error() });
  const res = await handler(make_request("POST", payload("approve")), deps);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "DB_ERROR");
});

Deno.test("propertyUpdater.set_status DB_ERROR (rama sin-revisión) → 500", async () => {
  const deps = build_deps({
    propertyFetcher: fetcher_status("pending_review"),
    propertyUpdater: updater_set_status_fails(),
  });
  const res = await handler(make_request("POST", payload("approve")), deps);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "DB_ERROR");
  assertEquals(deps.adminActionRecorder.calls, []);
});

Deno.test("propertyUpdater.apply_revision_snapshot DB_ERROR (approve con-revisión) → 500, revisionResolver NO se llama", async () => {
  const deps = build_deps({
    propertyFetcher: fetcher_status("active"),
    revisionFinder: revision_finder_active("pending"),
    propertyUpdater: updater_apply_revision_fails(),
  });
  const res = await handler(make_request("POST", payload("approve")), deps);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "DB_ERROR");
  assertEquals(deps.revisionResolver.calls, []);
  assertEquals(deps.adminActionRecorder.calls, []);
});

Deno.test("revisionResolver DB_ERROR (needs_changes con-revisión) → 500, adminActionRecorder NO se llama", async () => {
  const deps = build_deps({
    propertyFetcher: fetcher_status("active"),
    revisionFinder: revision_finder_active("pending"),
    revisionResolver: resolver_db_error(),
  });
  const res = await handler(
    make_request("POST", payload("needs_changes", "motivo")),
    deps,
  );
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "DB_ERROR");
  assertEquals(deps.adminActionRecorder.calls, []);
});

Deno.test("adminActionRecorder DB_ERROR → 500 aunque la escritura principal ya tuvo éxito", async () => {
  const deps = build_deps({
    propertyFetcher: fetcher_status("active"),
    adminActionRecorder: recorder_db_error(),
  });
  const res = await handler(
    make_request("POST", payload("suspend", "Reporte de fraude")),
    deps,
  );
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "DB_ERROR");
  // la escritura principal SÍ se intentó/ejecutó antes del fallo de auditoría
  assertEquals(deps.propertyUpdater.set_status_calls, [
    { property_id: PROPERTY_ID, status: "suspended" },
  ]);
});
