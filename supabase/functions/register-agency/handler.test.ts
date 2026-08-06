// supabase/functions/register-agency/handler.test.ts
// Tests RED — subtarea 71.4 (registro de inmobiliaria, flujo separado, §4.7).
// Framework: Deno.test + @std/assert. Patrón DI mirror de
// upgrade-to-agent/handler.test.ts (fakes con `calls`, `make_request`, sin red
// real — el handler es puro y recibe deps inyectadas).
// Runner: deno test supabase/functions/register-agency/handler.test.ts
//
// SEAM bajo test: el contrato público del handler HTTP (request → status +
// body) construido sobre dos dependencias inyectables (CallerVerifier,
// AgencyRegistrar que envuelve la RPC register_agency_atomic — ver
// supabase/tests/24_register_agency_test.sql para el contrato de esa RPC).
//
// FASE RED: handler.ts es un STUB que SIEMPRE devuelve 501 NOT_IMPLEMENTED
// (no importa supabase-js, no tiene lógica de negocio) — cada caso de abajo
// falla por aserción de status/body, nunca por import faltante.
//
// EDGE CASES:
//
// ### CORS / Métodos HTTP
// - R-1: OPTIONS → 200 con headers CORS
// - R-2: GET → 405
// - R-3: DELETE → 405
//
// ### Body / parse
// - R-4: JSON inválido (texto no-JSON) → 400
// - R-5: name ausente → 400
// - R-6: name vacío "" → 400
// - R-7: name con menos de 2 caracteres → 400 (mismo criterio que admin-create-agency)
// - R-8: slug ausente → 400
// - R-9: slug con formato inválido (mayúsculas/espacios) → 400
// - R-10: contact_name ausente → 400 (OBLIGATORIO aquí — delta vs admin-create-agency,
//         donde es opcional; PRD §4.7 "se capturan datos de empresa: razón
//         social, contacto, logotipo" en el registro self-service)
// - R-11: contact_phone ausente → 400
// - R-12: contact_email ausente → 400
// - R-13: contact_email con formato inválido → 400
//
// ### Auth — CallerVerifier DI
// - R-14: sin Authorization / verifier UNAUTHENTICATED → 401, el registrar NO se llama
//
// ### Anti-spoofing (created_by_user_id SIEMPRE del JWT)
// - R-15: created_by_user_id falsificado en el payload se IGNORA — el registrar
//         recibe el user_id del verifier, nunca el del body
//
// ### Mapeo P0001 → HTTP (contrato fijado en esta fase RED)
// - R-16 SLUG_DUPLICATE → 409
// - R-17 NAME_DUPLICATE → 409
// - R-18 CREATED_BY_REQUIRED → 400 (defensivo; en la práctica created_by_user_id
//        siempre viaja resuelto desde el JWT verificado, nunca null)
// - R-19 FIELDS_INCOMPLETE → 400 (defensivo; el parseo en memoria ya bloquea
//        antes de llamar al registrar, pero el contrato de mapeo queda fijado)
// - R-20 USER_NOT_FOUND → 500
// - R-21 código desconocido (no mapeado) → 500 (fallback ?? 500)
//
// ### Happy path
// - R-22: éxito → 201 { agency_id, name, slug, status: 'pending_approval', logo_url: null }
//         cuando logo_url NO viene en el payload (opcional, se persiste null)
// - R-23: éxito con logo_url presente en el payload → 201 con logo_url ecoado
//         en la respuesta y recibido tal cual por el registrar
// - R-24: dos altas consecutivas del MISMO usuario (distinto name/slug) → ambas
//         201 (permitido en beta — SEAM documentado: la EF NO bloquea
//         múltiples agencias pending por usuario; solo el unique de slug/name
//         en la RPC lo haría si coinciden)

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  AgencyRegistrar,
  CallerVerifier,
  CallerVerifyResult,
  RegisterAgencyAtomicParams,
  RegisterAgencyAtomicResult,
  RegisteredAgency,
} from "./types.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const USER_ID = "00000000-0000-0000-0000-000000000001";
const SPOOFED_USER_ID = "99999999-9999-9999-9999-999999999999";
const AGENCY_ID = "00000000-0000-0000-0000-00000000000a";

const VALID_PAYLOAD = {
  name: "Inmobiliaria Bosques SA de CV",
  slug: "inmobiliaria-bosques",
  contact_name: "Ana Torres",
  contact_phone: "+525511119301",
  contact_email: "ana@inmobiliariabosques.mx",
};

// ── Fakes ─────────────────────────────────────────────────────────────────────

interface FakeVerifier extends CallerVerifier {
  calls: (string | null)[];
}

function verifier_ok(user_id = USER_ID): FakeVerifier {
  return {
    calls: [],
    verify_caller(header: string | null): Promise<CallerVerifyResult> {
      this.calls.push(header);
      return Promise.resolve({ ok: true, user_id });
    },
  } as FakeVerifier;
}

function verifier_unauthenticated(): FakeVerifier {
  return {
    calls: [],
    verify_caller(header: string | null): Promise<CallerVerifyResult> {
      this.calls.push(header);
      return Promise.resolve({ ok: false, error_code: "UNAUTHENTICATED" });
    },
  } as FakeVerifier;
}

interface FakeRegistrar extends AgencyRegistrar {
  calls: RegisterAgencyAtomicParams[];
}

function registered_agency(
  overrides: Partial<RegisteredAgency> = {},
): RegisteredAgency {
  return {
    agency_id: AGENCY_ID,
    name: VALID_PAYLOAD.name,
    slug: VALID_PAYLOAD.slug,
    status: "pending_approval",
    logo_url: null,
    ...overrides,
  };
}

function registrar_ok(agency: RegisteredAgency = registered_agency()): FakeRegistrar {
  return {
    calls: [],
    register_atomic(
      params: RegisterAgencyAtomicParams,
    ): Promise<RegisterAgencyAtomicResult> {
      this.calls.push({ ...params });
      return Promise.resolve({ ok: true, agency });
    },
  } as FakeRegistrar;
}

function registrar_error(error_code: string): FakeRegistrar {
  return {
    calls: [],
    register_atomic(
      params: RegisterAgencyAtomicParams,
    ): Promise<RegisterAgencyAtomicResult> {
      this.calls.push({ ...params });
      return Promise.resolve({ ok: false, error_code });
    },
  } as FakeRegistrar;
}

// ── Helper de requests ────────────────────────────────────────────────────────

function make_request(
  body: string | null,
  method = "POST",
  withAuth = true,
): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (withAuth) headers["Authorization"] = "Bearer jwt-fake";
  return new Request("http://localhost/register-agency", {
    method,
    headers,
    body: method === "POST" || method === "PUT" ? body : null,
  });
}

// ── CORS / Métodos ────────────────────────────────────────────────────────────

Deno.test("R-1: OPTIONS → 200 con headers CORS", async () => {
  const res = await handler(
    new Request("http://localhost/register-agency", { method: "OPTIONS" }),
    { callerVerifier: verifier_ok(), agencyRegistrar: registrar_ok() },
  );
  assertEquals(res.status, 200);
  assertExists(res.headers.get("Access-Control-Allow-Origin"));
});

Deno.test("R-2: GET → 405", async () => {
  const res = await handler(
    new Request("http://localhost/register-agency", { method: "GET" }),
    { callerVerifier: verifier_ok(), agencyRegistrar: registrar_ok() },
  );
  assertEquals(res.status, 405);
});

Deno.test("R-3: DELETE → 405", async () => {
  const res = await handler(
    new Request("http://localhost/register-agency", { method: "DELETE" }),
    { callerVerifier: verifier_ok(), agencyRegistrar: registrar_ok() },
  );
  assertEquals(res.status, 405);
});

// ── Body / parse / validación ─────────────────────────────────────────────────

Deno.test("R-4: JSON inválido → 400", async () => {
  const res = await handler(make_request("esto no es json"), {
    callerVerifier: verifier_ok(),
    agencyRegistrar: registrar_ok(),
  });
  assertEquals(res.status, 400);
});

Deno.test("R-5: name ausente → 400", async () => {
  const { name: _name, ...rest } = VALID_PAYLOAD;
  const res = await handler(make_request(JSON.stringify(rest)), {
    callerVerifier: verifier_ok(),
    agencyRegistrar: registrar_ok(),
  });
  assertEquals(res.status, 400);
});

Deno.test("R-6: name vacío → 400", async () => {
  const res = await handler(
    make_request(JSON.stringify({ ...VALID_PAYLOAD, name: "" })),
    { callerVerifier: verifier_ok(), agencyRegistrar: registrar_ok() },
  );
  assertEquals(res.status, 400);
});

Deno.test("R-7: name con menos de 2 caracteres → 400", async () => {
  const res = await handler(
    make_request(JSON.stringify({ ...VALID_PAYLOAD, name: "A" })),
    { callerVerifier: verifier_ok(), agencyRegistrar: registrar_ok() },
  );
  assertEquals(res.status, 400);
});

Deno.test("R-8: slug ausente → 400", async () => {
  const { slug: _slug, ...rest } = VALID_PAYLOAD;
  const res = await handler(make_request(JSON.stringify(rest)), {
    callerVerifier: verifier_ok(),
    agencyRegistrar: registrar_ok(),
  });
  assertEquals(res.status, 400);
});

Deno.test("R-9: slug con formato inválido (mayúsculas/espacios) → 400", async () => {
  const res = await handler(
    make_request(
      JSON.stringify({ ...VALID_PAYLOAD, slug: "Slug Invalido!" }),
    ),
    { callerVerifier: verifier_ok(), agencyRegistrar: registrar_ok() },
  );
  assertEquals(res.status, 400);
});

Deno.test("R-10: contact_name ausente → 400 (obligatorio en self-service)", async () => {
  const { contact_name: _contact_name, ...rest } = VALID_PAYLOAD;
  const res = await handler(make_request(JSON.stringify(rest)), {
    callerVerifier: verifier_ok(),
    agencyRegistrar: registrar_ok(),
  });
  assertEquals(res.status, 400);
});

Deno.test("R-11: contact_phone ausente → 400 (obligatorio en self-service)", async () => {
  const { contact_phone: _contact_phone, ...rest } = VALID_PAYLOAD;
  const res = await handler(make_request(JSON.stringify(rest)), {
    callerVerifier: verifier_ok(),
    agencyRegistrar: registrar_ok(),
  });
  assertEquals(res.status, 400);
});

Deno.test("R-12: contact_email ausente → 400 (obligatorio en self-service)", async () => {
  const { contact_email: _contact_email, ...rest } = VALID_PAYLOAD;
  const res = await handler(make_request(JSON.stringify(rest)), {
    callerVerifier: verifier_ok(),
    agencyRegistrar: registrar_ok(),
  });
  assertEquals(res.status, 400);
});

Deno.test("R-13: contact_email con formato inválido → 400", async () => {
  const res = await handler(
    make_request(
      JSON.stringify({ ...VALID_PAYLOAD, contact_email: "no-es-un-email" }),
    ),
    { callerVerifier: verifier_ok(), agencyRegistrar: registrar_ok() },
  );
  assertEquals(res.status, 400);
});

// ── Auth ──────────────────────────────────────────────────────────────────────

Deno.test("R-14: sin autenticación → 401 y el registrar NO se llama", async () => {
  const registrar = registrar_ok();
  const res = await handler(
    make_request(JSON.stringify(VALID_PAYLOAD)),
    { callerVerifier: verifier_unauthenticated(), agencyRegistrar: registrar },
  );
  assertEquals(res.status, 401);
  assertEquals(registrar.calls.length, 0);
});

// ── Anti-spoofing ──────────────────────────────────────────────────────────────

Deno.test("R-15: created_by_user_id falsificado en el payload se IGNORA (JWT manda)", async () => {
  const registrar = registrar_ok();
  const res = await handler(
    make_request(
      JSON.stringify({
        ...VALID_PAYLOAD,
        created_by_user_id: SPOOFED_USER_ID,
      }),
    ),
    { callerVerifier: verifier_ok(), agencyRegistrar: registrar },
  );
  assertEquals(res.status, 201);
  assertEquals(registrar.calls.length, 1);
  assertEquals(registrar.calls[0].created_by_user_id, USER_ID);
});

// ── Mapeo P0001 → HTTP ─────────────────────────────────────────────────────────

const ERROR_STATUS_CASES: Array<[string, number]> = [
  ["SLUG_DUPLICATE", 409],
  ["NAME_DUPLICATE", 409],
  ["CREATED_BY_REQUIRED", 400],
  ["FIELDS_INCOMPLETE", 400],
  ["USER_NOT_FOUND", 500],
];

for (const [code, status] of ERROR_STATUS_CASES) {
  Deno.test(`R-16..20: ${code} → ${status}`, async () => {
    const res = await handler(
      make_request(JSON.stringify(VALID_PAYLOAD)),
      { callerVerifier: verifier_ok(), agencyRegistrar: registrar_error(code) },
    );
    assertEquals(res.status, status);
    const body = await res.json();
    assertEquals(body.error.code, code);
  });
}

Deno.test("R-21: código de error desconocido → 500 (fallback)", async () => {
  const res = await handler(
    make_request(JSON.stringify(VALID_PAYLOAD)),
    {
      callerVerifier: verifier_ok(),
      agencyRegistrar: registrar_error("ALGO_NUEVO_NO_MAPEADO"),
    },
  );
  assertEquals(res.status, 500);
});

// ── Happy path ─────────────────────────────────────────────────────────────────

Deno.test("R-22: éxito sin logo_url → 201 con agencia pending_approval y logo_url null", async () => {
  const registrar = registrar_ok();
  const res = await handler(
    make_request(JSON.stringify(VALID_PAYLOAD)),
    { callerVerifier: verifier_ok(), agencyRegistrar: registrar },
  );
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.agency_id, AGENCY_ID);
  assertEquals(body.name, VALID_PAYLOAD.name);
  assertEquals(body.slug, VALID_PAYLOAD.slug);
  assertEquals(body.status, "pending_approval");
  assertEquals(body.logo_url, null);
  assertEquals(registrar.calls.length, 1);
  assertEquals(registrar.calls[0].created_by_user_id, USER_ID);
  assertEquals(registrar.calls[0].logo_url, null);
  assertEquals(registrar.calls[0].contact_name, VALID_PAYLOAD.contact_name);
  assertEquals(registrar.calls[0].contact_phone, VALID_PAYLOAD.contact_phone);
  assertEquals(registrar.calls[0].contact_email, VALID_PAYLOAD.contact_email);
});

Deno.test("R-23: éxito con logo_url presente → 201 ecoando logo_url", async () => {
  const logo_url = "https://r2.urbea.mx/agencies/logo-bosques.png";
  const registrar = registrar_ok(
    registered_agency({ logo_url }),
  );
  const res = await handler(
    make_request(JSON.stringify({ ...VALID_PAYLOAD, logo_url })),
    { callerVerifier: verifier_ok(), agencyRegistrar: registrar },
  );
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.logo_url, logo_url);
  assertEquals(registrar.calls[0].logo_url, logo_url);
});

Deno.test("R-24: dos altas consecutivas del MISMO usuario (distinto slug) → ambas 201", async () => {
  const registrar = registrar_ok();
  const res1 = await handler(
    make_request(JSON.stringify(VALID_PAYLOAD)),
    { callerVerifier: verifier_ok(), agencyRegistrar: registrar },
  );
  const res2 = await handler(
    make_request(
      JSON.stringify({
        ...VALID_PAYLOAD,
        name: "Otra Inmobiliaria del Mismo Usuario",
        slug: "otra-inmobiliaria-mismo-usuario",
      }),
    ),
    { callerVerifier: verifier_ok(), agencyRegistrar: registrar },
  );
  assertEquals(res1.status, 201);
  assertEquals(res2.status, 201);
  assertEquals(registrar.calls.length, 2);
  assertEquals(registrar.calls[0].created_by_user_id, USER_ID);
  assertEquals(registrar.calls[1].created_by_user_id, USER_ID);
});
