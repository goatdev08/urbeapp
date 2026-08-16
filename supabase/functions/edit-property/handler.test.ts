// supabase/functions/edit-property/handler.test.ts
// Tests RED — subtarea 73.6 (Re-revisión por edición, PRD §15.5/§15.6)
// Edge Function: edit-property/handler.ts
// Framework: Deno.test + @std/assert
// Runner: deno test --allow-net --allow-env --allow-read --config deno.json \
//         edit-property/handler.test.ts   (desde supabase/functions/)
//
// SEAM bajo test: el CONTRATO HTTP del handler (request → response, status
// codes) vía DI de 4 fakes — CallerVerifier, PropertyFetcher,
// DirectPropertyUpdater, RevisionUpserter — mismo patrón DI puro que
// update-property-status/handler.test.ts y publish-property/handler.test.ts.
// La lógica REAL de upsert de property_revisions (dedup de fila activa,
// needs_changes→pending) vive en revision_upserter.ts y se prueba aparte en
// revision_upserter.test.ts contra un fake postgrest client (mismo patrón que
// _shared/duplicate_property_checker.test.ts) — aquí el fake de
// RevisionUpserter solo registra llamadas y devuelve un resultado configurado.
//
// EDGE CASES (RED) — 73.6:
//
// ### Happy path
// - sin cambios críticos → 200 {ok:true, mode:'direct'}
// - sin cambios críticos → directPropertyUpdater.apply llamado con el payload completo
// - sin cambios críticos → revisionUpserter NUNCA llamado
// - con 1 cambio crítico → 200 {ok:true, mode:'revision', revision_id}
// - con 1 cambio crítico → revisionUpserter llamado con changed_fields = payload completo
// - con 1 cambio crítico → directPropertyUpdater NUNCA llamado (current_published intacta)
// - OPTIONS preflight → 200 con Access-Control-Allow-Origin
//
// ### PRD §15.5 — campos que DISPARAN re-revisión (uno por cada uno de los 5 alcanzables desde esta EF)
// - solo operation_type cambia → mode='revision'
// - solo property_type cambia → mode='revision'
// - solo address cambia (contenido realmente distinto) → mode='revision'
// - solo location (coordenadas) cambia, address igual → mode='revision' (dirección/coordenadas es una unidad, §15.5)
// - solo price cambia (diferencia mínima, $0.01) → mode='revision' (comparación numérica exacta)
// - solo description cambia → mode='revision'
// - combinación: price (crítico) + bedrooms (no-crítico) en el mismo submit → mode='revision'
//   Y el snapshot changed_fields recibido por revisionUpserter incluye AMBOS campos
//
// ### PRD §15.5 — campos que NO disparan re-revisión (aplican directo)
// - solo price_visible cambia (SIN tocar price) → mode='direct' — caso EXPLÍCITO del PRD §15.5
// - solo bedrooms/bathrooms/square_meters cambian → mode='direct'
// - solo pet_friendly/allows_no_guarantor/student_friendly cambian → mode='direct'
// - ningún campo cambia (payload idéntico al actual) → mode='direct'
// - varios no-críticos cambian juntos → mode='direct', directPropertyUpdater recibe el payload COMPLETO
//
// ### Normalización de address (mismo criterio que duplicatePropertyChecker, 73.4)
// - address con espacios/mayúsculas distintos pero mismo contenido normalizado (trim+lowercase) → mode='direct'
// - location EWKT string idéntico → no cuenta como cambio (mode='direct' si nada más cambió)
// - location AUSENTE del payload (usuario no tocó el mapa) → no se evalúa, no fuerza crítico
//
// ### Auth — CallerVerifier DI
// - sin Authorization header → 401 UNAUTHENTICATED
// - JWT inválido → 401 UNAUTHENTICATED
// - sin auth: ningún seam downstream (fetcher/updater/upserter) es llamado
//
// ### Ownership / admin (403) — mismo criterio que RLS properties_update
// - caller no es owner ni admin → 403 UNAUTHORIZED_EDITOR
// - caller no es owner ni admin: directPropertyUpdater y revisionUpserter NUNCA llamados
// - caller es admin (no owner) → pasa el gate, 200
// - caller es owner (no admin) → pasa el gate, 200
//
// ### Not found
// - property_id inexistente (fetcher→PROPERTY_NOT_FOUND) → 404
// - property no encontrada: ownership/diff/updater/upserter NUNCA se ejecutan
//
// ### DB failure → 500
// - propertyFetcher falla (DB_ERROR) → 500
// - directPropertyUpdater falla (DB_ERROR) → 500
// - revisionUpserter falla (DB_ERROR) → 500
//
// ### Boundary / validación de payload
// - Body no-JSON → 400 INVALID_INPUT
// - property_id ausente → 400 INVALID_INPUT (ningún seam es llamado)
// - operation_type inválido (fuera de enum) → 400 INVALID_INPUT
// - property_type inválido (fuera de enum) → 400 INVALID_INPUT
// - price <= 0 → 400 INVALID_INPUT
// - address vacío/solo espacios → 400 INVALID_INPUT
// - GET → 405
// - PUT → 405
//
// ### Forma del error — invariante global
// - toda respuesta de error tiene forma { error: { code: string, message: string } }

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  AgencyRoleResolver,
  CallerVerifier,
  CallerVerifyResult,
  CurrentPropertySnapshot,
  DirectPropertyUpdater,
  DirectUpdateResult,
  EditPropertyDeps,
  EditPropertyInput,
  PropertyFetcher,
  PropertyFetchResult,
  RevisionUpsertResult,
  RevisionUpserter,
} from "./types.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const OWNER_ID = "00000000-0000-0000-0006-000000000001";
const ADMIN_ID = "00000000-0000-0000-0006-000000000002";
const OTRO_USUARIO_ID = "00000000-0000-0000-0006-000000000099";
const PROPERTY_ID = "00000000-0000-0000-0006-000000000010";
const REVISION_ID = "00000000-0000-0000-0006-000000000020";

const AGENCY_ID = "00000000-0000-0000-0006-000000000030";

// Snapshot ACTUAL (current_published) — línea base contra la que se hace el diff.
const CURRENT: CurrentPropertySnapshot = {
  id: PROPERTY_ID,
  owner_user_id: OWNER_ID,
  agency_id: null, // independiente por default; los tests de agencia lo pisan
  operation_type: "rent",
  property_type: "departamento",
  price: 12500,
  address: "Av. Insurgentes Sur 1234, CDMX",
  location: "SRID=4326;POINT(-99.1731 19.3737)",
  description: "Depa amplio y luminoso, cerca del metro",
};

// Snapshot de una propiedad publicada BAJO una agencia (para la matriz #142).
const CURRENT_CON_AGENCIA: CurrentPropertySnapshot = {
  ...CURRENT,
  agency_id: AGENCY_ID,
};

// Payload BASE que reproduce exactamente el snapshot actual (sin cambios).
const BASE_INPUT: EditPropertyInput = {
  property_id: PROPERTY_ID,
  operation_type: CURRENT.operation_type as EditPropertyInput["operation_type"],
  property_type: CURRENT.property_type as EditPropertyInput["property_type"],
  price: CURRENT.price,
  bedrooms: 2,
  bathrooms: 1,
  square_meters: 75,
  address: CURRENT.address,
  location: CURRENT.location ?? undefined,
  price_visible: true,
  pet_friendly: false,
  allows_no_guarantor: false,
  student_friendly: false,
  description: CURRENT.description,
};

// ── Factories de fakes — CallerVerifier ───────────────────────────────────────

interface FakeCallerVerifier extends CallerVerifier {
  calls: (string | null)[];
}

function verifier_ok(user_id = OWNER_ID, is_admin = false): FakeCallerVerifier {
  return {
    calls: [],
    verify_caller(header: string | null): Promise<CallerVerifyResult> {
      this.calls.push(header);
      return Promise.resolve({ ok: true, user_id, is_admin });
    },
  } as FakeCallerVerifier;
}

function verifier_unauthenticated(): FakeCallerVerifier {
  return {
    calls: [],
    verify_caller(header: string | null): Promise<CallerVerifyResult> {
      this.calls.push(header);
      return Promise.resolve({ ok: false, error_code: "UNAUTHENTICATED" });
    },
  } as FakeCallerVerifier;
}

// ── Factories de fakes — PropertyFetcher ──────────────────────────────────────

interface FakePropertyFetcher extends PropertyFetcher {
  calls: string[];
}

function fetcher_ok(snapshot: CurrentPropertySnapshot = CURRENT): FakePropertyFetcher {
  return {
    calls: [],
    fetch(property_id: string): Promise<PropertyFetchResult> {
      this.calls.push(property_id);
      return Promise.resolve({ ok: true, property: snapshot });
    },
  } as FakePropertyFetcher;
}

function fetcher_not_found(): FakePropertyFetcher {
  return {
    calls: [],
    fetch(property_id: string): Promise<PropertyFetchResult> {
      this.calls.push(property_id);
      return Promise.resolve({ ok: false, error_code: "PROPERTY_NOT_FOUND" });
    },
  } as FakePropertyFetcher;
}

function fetcher_db_error(): FakePropertyFetcher {
  return {
    calls: [],
    fetch(property_id: string): Promise<PropertyFetchResult> {
      this.calls.push(property_id);
      return Promise.resolve({ ok: false, error_code: "DB_ERROR", message: "timeout" });
    },
  } as FakePropertyFetcher;
}

// ── Factories de fakes — DirectPropertyUpdater ────────────────────────────────

interface FakeDirectPropertyUpdater extends DirectPropertyUpdater {
  calls: { property_id: string; input: EditPropertyInput }[];
}

function direct_updater_ok(): FakeDirectPropertyUpdater {
  return {
    calls: [],
    apply(property_id: string, input: EditPropertyInput): Promise<DirectUpdateResult> {
      this.calls.push({ property_id, input });
      return Promise.resolve({ ok: true });
    },
  } as FakeDirectPropertyUpdater;
}

function direct_updater_db_error(): FakeDirectPropertyUpdater {
  return {
    calls: [],
    apply(property_id: string, input: EditPropertyInput): Promise<DirectUpdateResult> {
      this.calls.push({ property_id, input });
      return Promise.resolve({ ok: false, error_code: "DB_ERROR", message: "update falló" });
    },
  } as FakeDirectPropertyUpdater;
}

// ── Factories de fakes — RevisionUpserter ─────────────────────────────────────

interface FakeRevisionUpserter extends RevisionUpserter {
  calls: { property_id: string; submitted_by: string; changed_fields: EditPropertyInput }[];
}

function revision_upserter_ok(revision_id = REVISION_ID): FakeRevisionUpserter {
  return {
    calls: [],
    upsert(
      property_id: string,
      submitted_by: string,
      changed_fields: EditPropertyInput,
    ): Promise<RevisionUpsertResult> {
      this.calls.push({ property_id, submitted_by, changed_fields });
      return Promise.resolve({ ok: true, revision_id });
    },
  } as FakeRevisionUpserter;
}

function revision_upserter_db_error(): FakeRevisionUpserter {
  return {
    calls: [],
    upsert(
      property_id: string,
      submitted_by: string,
      changed_fields: EditPropertyInput,
    ): Promise<RevisionUpsertResult> {
      this.calls.push({ property_id, submitted_by, changed_fields });
      return Promise.resolve({ ok: false, error_code: "DB_ERROR", message: "insert falló" });
    },
  } as FakeRevisionUpserter;
}

// ── Helpers de Request ────────────────────────────────────────────────────────

function post_auth(body: unknown): Request {
  return new Request("http://localhost/edit-property", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer fake-jwt" },
    body: JSON.stringify(body),
  });
}

function post_sin_auth(body: unknown): Request {
  return new Request("http://localhost/edit-property", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function method_request(method: string): Request {
  return new Request("http://localhost/edit-property", { method });
}

// ── Factories de fakes — AgencyRoleResolver (#142) ────────────────────────────

interface FakeAgencyRoleResolver extends AgencyRoleResolver {
  calls: { user_id: string; agency_id: string }[];
}

function resolver_role(role: string | null): FakeAgencyRoleResolver {
  return {
    calls: [],
    resolve(user_id: string, agency_id: string): Promise<string | null> {
      this.calls.push({ user_id, agency_id });
      return Promise.resolve(role);
    },
  } as FakeAgencyRoleResolver;
}

function deps(overrides: Partial<EditPropertyDeps> = {}): EditPropertyDeps {
  return {
    callerVerifier: overrides.callerVerifier ?? verifier_ok(),
    propertyFetcher: overrides.propertyFetcher ?? fetcher_ok(),
    directPropertyUpdater: overrides.directPropertyUpdater ?? direct_updater_ok(),
    revisionUpserter: overrides.revisionUpserter ?? revision_upserter_ok(),
    agencyRoleResolver: overrides.agencyRoleResolver ?? resolver_role(null),
  };
}

// ── Happy path ────────────────────────────────────────────────────────────────

Deno.test("happy_path_sin_cambios_criticos_retorna_200_mode_direct", async () => {
  const res = await handler(post_auth(BASE_INPUT), deps());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(body.mode, "direct");
});

Deno.test("happy_path_sin_cambios_criticos_direct_updater_recibe_payload_completo", async () => {
  const du = direct_updater_ok();
  await handler(post_auth(BASE_INPUT), deps({ directPropertyUpdater: du }));
  assertEquals(du.calls.length, 1, "directPropertyUpdater.apply debe ser llamado exactamente una vez");
  assertEquals(du.calls[0].property_id, PROPERTY_ID);
  assertEquals(du.calls[0].input.price_visible, BASE_INPUT.price_visible);
  assertEquals(du.calls[0].input.bedrooms, BASE_INPUT.bedrooms);
});

Deno.test("happy_path_sin_cambios_criticos_revision_upserter_nunca_llamado", async () => {
  const ru = revision_upserter_ok();
  await handler(post_auth(BASE_INPUT), deps({ revisionUpserter: ru }));
  assertEquals(ru.calls.length, 0, "sin cambios críticos, revisionUpserter NUNCA debe llamarse");
});

Deno.test("happy_path_con_cambio_critico_retorna_200_mode_revision_con_id", async () => {
  const input: EditPropertyInput = { ...BASE_INPUT, price: 13000 };
  const res = await handler(post_auth(input), deps());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(body.mode, "revision");
  assertEquals(body.revision_id, REVISION_ID);
});

Deno.test("happy_path_con_cambio_critico_revision_upserter_recibe_snapshot_completo", async () => {
  const ru = revision_upserter_ok();
  const input: EditPropertyInput = { ...BASE_INPUT, price: 13000 };
  await handler(post_auth(input), deps({ revisionUpserter: ru }));
  assertEquals(ru.calls.length, 1);
  assertEquals(ru.calls[0].property_id, PROPERTY_ID);
  assertEquals(ru.calls[0].submitted_by, OWNER_ID);
  assertEquals(ru.calls[0].changed_fields.price, 13000);
});

Deno.test("happy_path_con_cambio_critico_direct_updater_nunca_llamado", async () => {
  const du = direct_updater_ok();
  const input: EditPropertyInput = { ...BASE_INPUT, price: 13000 };
  await handler(post_auth(input), deps({ directPropertyUpdater: du }));
  assertEquals(
    du.calls.length,
    0,
    "con cambio crítico, directPropertyUpdater NUNCA debe llamarse — current_published queda intacta (PRD §15.6)",
  );
});

Deno.test("cors_options_preflight_retorna_200_con_allow_origin", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertEquals(res.status, 200);
  assertExists(res.headers.get("Access-Control-Allow-Origin"));
});

// ── PRD §15.5 — campos que DISPARAN re-revisión ───────────────────────────────

Deno.test("critico_operation_type_solo_dispara_revision", async () => {
  const input: EditPropertyInput = { ...BASE_INPUT, operation_type: "sale" };
  const res = await handler(post_auth(input), deps());
  const body = await res.json();
  assertEquals(body.mode, "revision", "cambiar operation_type debe disparar re-revisión (PRD §15.5)");
});

Deno.test("critico_property_type_solo_dispara_revision", async () => {
  const input: EditPropertyInput = { ...BASE_INPUT, property_type: "casa" };
  const res = await handler(post_auth(input), deps());
  const body = await res.json();
  assertEquals(body.mode, "revision", "cambiar property_type debe disparar re-revisión (PRD §15.5)");
});

Deno.test("critico_address_solo_dispara_revision", async () => {
  const input: EditPropertyInput = { ...BASE_INPUT, address: "Calle Durango 55, Col. Roma, CDMX" };
  const res = await handler(post_auth(input), deps());
  const body = await res.json();
  assertEquals(body.mode, "revision", "cambiar la dirección debe disparar re-revisión (PRD §15.5)");
});

Deno.test("critico_location_solo_dispara_revision_direccion_coordenadas_es_una_unidad", async () => {
  // address igual, pero las coordenadas (location) cambiaron — PRD §15.5 trata
  // "dirección o coordenadas" como una sola unidad crítica.
  const input: EditPropertyInput = {
    ...BASE_INPUT,
    location: "SRID=4326;POINT(-99.2000 19.4000)",
  };
  const res = await handler(post_auth(input), deps());
  const body = await res.json();
  assertEquals(body.mode, "revision", "cambiar las coordenadas (sin cambiar el texto de address) debe disparar re-revisión");
});

Deno.test("critico_price_solo_dispara_revision_diferencia_minima", async () => {
  // Comparación numérica EXACTA: cualquier cambio, por mínimo que sea, dispara.
  const input: EditPropertyInput = { ...BASE_INPUT, price: BASE_INPUT.price + 0.01 };
  const res = await handler(post_auth(input), deps());
  const body = await res.json();
  assertEquals(body.mode, "revision", "cualquier cambio de precio, por mínimo que sea, dispara re-revisión");
});

Deno.test("critico_description_solo_dispara_revision", async () => {
  const input: EditPropertyInput = { ...BASE_INPUT, description: "Nueva descripción completamente distinta" };
  const res = await handler(post_auth(input), deps());
  const body = await res.json();
  assertEquals(body.mode, "revision", "cambiar la descripción debe disparar re-revisión (PRD §15.5)");
});

Deno.test("combinacion_critico_price_y_no_critico_bedrooms_dispara_revision_con_snapshot_completo", async () => {
  const ru = revision_upserter_ok();
  const input: EditPropertyInput = { ...BASE_INPUT, price: 15000, bedrooms: 4 };
  const res = await handler(post_auth(input), deps({ revisionUpserter: ru }));
  const body = await res.json();
  assertEquals(body.mode, "revision");
  assertEquals(ru.calls.length, 1);
  // El snapshot en changed_fields incluye AMBOS campos — crítico y no-crítico —
  // no se separan: se aplican juntos cuando el admin apruebe (PRD §15.6).
  assertEquals(ru.calls[0].changed_fields.price, 15000);
  assertEquals(ru.calls[0].changed_fields.bedrooms, 4);
});

// ── PRD §15.5 — campos que NO disparan re-revisión ────────────────────────────

Deno.test("no_critico_price_visible_solo_NO_dispara_revision_sin_cambiar_price", async () => {
  // Caso EXPLÍCITO del PRD §15.5: "ocultar/mostrar precio sin cambiar precio interno".
  const input: EditPropertyInput = { ...BASE_INPUT, price_visible: !BASE_INPUT.price_visible };
  const res = await handler(post_auth(input), deps());
  const body = await res.json();
  assertEquals(body.mode, "direct", "price_visible solo, sin tocar price, NUNCA debe disparar re-revisión");
});

Deno.test("no_critico_bedrooms_bathrooms_square_meters_no_disparan_revision", async () => {
  const input: EditPropertyInput = {
    ...BASE_INPUT,
    bedrooms: 5,
    bathrooms: 3,
    square_meters: 200,
  };
  const res = await handler(post_auth(input), deps());
  const body = await res.json();
  assertEquals(body.mode, "direct");
});

Deno.test("no_critico_pet_friendly_allows_no_guarantor_student_friendly_no_disparan_revision", async () => {
  const input: EditPropertyInput = {
    ...BASE_INPUT,
    pet_friendly: !BASE_INPUT.pet_friendly,
    allows_no_guarantor: !BASE_INPUT.allows_no_guarantor,
    student_friendly: !BASE_INPUT.student_friendly,
  };
  const res = await handler(post_auth(input), deps());
  const body = await res.json();
  assertEquals(body.mode, "direct");
});

Deno.test("sin_cambios_payload_identico_al_actual_aplica_directo", async () => {
  const res = await handler(post_auth(BASE_INPUT), deps());
  const body = await res.json();
  assertEquals(body.mode, "direct");
});

Deno.test("varios_no_criticos_juntos_aplican_directo_con_payload_completo", async () => {
  const du = direct_updater_ok();
  const input: EditPropertyInput = {
    ...BASE_INPUT,
    price_visible: false,
    bedrooms: 1,
    pet_friendly: true,
  };
  const res = await handler(post_auth(input), deps({ directPropertyUpdater: du }));
  const body = await res.json();
  assertEquals(body.mode, "direct");
  assertEquals(du.calls.length, 1);
  assertEquals(du.calls[0].input.price_visible, false);
  assertEquals(du.calls[0].input.bedrooms, 1);
  assertEquals(du.calls[0].input.pet_friendly, true);
});

// ── Normalización de address / location ───────────────────────────────────────

Deno.test("address_normalizado_espacios_mayusculas_no_dispara_revision", async () => {
  // Mismo criterio que duplicatePropertyChecker (73.4): trim().toLowerCase().
  const input: EditPropertyInput = {
    ...BASE_INPUT,
    address: `  ${CURRENT.address.toUpperCase()}  `,
  };
  const res = await handler(post_auth(input), deps());
  const body = await res.json();
  assertEquals(
    body.mode,
    "direct",
    "una diferencia trivial de espacios/mayúsculas en address NO debe disparar re-revisión",
  );
});

Deno.test("location_ewkt_identico_no_cuenta_como_cambio", async () => {
  const input: EditPropertyInput = { ...BASE_INPUT, location: CURRENT.location ?? undefined };
  const res = await handler(post_auth(input), deps());
  const body = await res.json();
  assertEquals(body.mode, "direct");
});

Deno.test("location_ausente_del_payload_no_se_evalua_no_fuerza_critico", async () => {
  const { location: _omit, ...rest } = BASE_INPUT;
  const input = rest as EditPropertyInput;
  const res = await handler(post_auth(input), deps());
  const body = await res.json();
  assertEquals(
    body.mode,
    "direct",
    "location ausente del payload (usuario no tocó el mapa) no debe forzar re-revisión",
  );
});

// ── Auth — CallerVerifier ─────────────────────────────────────────────────────

Deno.test("sin_authorization_header_retorna_401_unauthenticated", async () => {
  const res = await handler(post_sin_auth(BASE_INPUT), deps({ callerVerifier: verifier_unauthenticated() }));
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
});

Deno.test("jwt_invalido_retorna_401_unauthenticated", async () => {
  const res = await handler(post_auth(BASE_INPUT), deps({ callerVerifier: verifier_unauthenticated() }));
  assertEquals(res.status, 401);
});

Deno.test("sin_auth_ningun_seam_downstream_es_llamado", async () => {
  const fetcher = fetcher_ok();
  const du = direct_updater_ok();
  const ru = revision_upserter_ok();
  await handler(
    post_sin_auth(BASE_INPUT),
    deps({ callerVerifier: verifier_unauthenticated(), propertyFetcher: fetcher, directPropertyUpdater: du, revisionUpserter: ru }),
  );
  assertEquals(fetcher.calls.length, 0);
  assertEquals(du.calls.length, 0);
  assertEquals(ru.calls.length, 0);
});

// ── Ownership / admin ─────────────────────────────────────────────────────────

Deno.test("caller_no_es_owner_ni_admin_retorna_403_unauthorized_editor", async () => {
  const res = await handler(
    post_auth(BASE_INPUT),
    deps({ callerVerifier: verifier_ok(OTRO_USUARIO_ID, false) }),
  );
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHORIZED_EDITOR");
});

Deno.test("caller_no_autorizado_updater_y_upserter_nunca_llamados", async () => {
  const du = direct_updater_ok();
  const ru = revision_upserter_ok();
  await handler(
    post_auth(BASE_INPUT),
    deps({
      callerVerifier: verifier_ok(OTRO_USUARIO_ID, false),
      directPropertyUpdater: du,
      revisionUpserter: ru,
    }),
  );
  assertEquals(du.calls.length, 0);
  assertEquals(ru.calls.length, 0);
});

Deno.test("caller_admin_no_owner_pasa_el_gate_retorna_200", async () => {
  const res = await handler(
    post_auth(BASE_INPUT),
    deps({ callerVerifier: verifier_ok(ADMIN_ID, true) }),
  );
  assertEquals(res.status, 200);
});

Deno.test("caller_owner_no_admin_pasa_el_gate_retorna_200", async () => {
  const res = await handler(
    post_auth(BASE_INPUT),
    deps({ callerVerifier: verifier_ok(OWNER_ID, false) }),
  );
  assertEquals(res.status, 200);
});

// ── Not found ─────────────────────────────────────────────────────────────────

Deno.test("property_inexistente_retorna_404_property_not_found", async () => {
  const res = await handler(post_auth(BASE_INPUT), deps({ propertyFetcher: fetcher_not_found() }));
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error.code, "PROPERTY_NOT_FOUND");
});

Deno.test("property_no_encontrada_updater_y_upserter_nunca_se_ejecutan", async () => {
  const du = direct_updater_ok();
  const ru = revision_upserter_ok();
  await handler(
    post_auth(BASE_INPUT),
    deps({ propertyFetcher: fetcher_not_found(), directPropertyUpdater: du, revisionUpserter: ru }),
  );
  assertEquals(du.calls.length, 0);
  assertEquals(ru.calls.length, 0);
});

// ── DB failure → 500 ──────────────────────────────────────────────────────────

Deno.test("fetcher_db_error_retorna_500", async () => {
  const res = await handler(post_auth(BASE_INPUT), deps({ propertyFetcher: fetcher_db_error() }));
  assertEquals(res.status, 500);
});

Deno.test("direct_updater_db_error_retorna_500", async () => {
  const res = await handler(post_auth(BASE_INPUT), deps({ directPropertyUpdater: direct_updater_db_error() }));
  assertEquals(res.status, 500);
});

Deno.test("revision_upserter_db_error_retorna_500", async () => {
  const input: EditPropertyInput = { ...BASE_INPUT, price: 20000 };
  const res = await handler(post_auth(input), deps({ revisionUpserter: revision_upserter_db_error() }));
  assertEquals(res.status, 500);
});

// ── Boundary / validación de payload ──────────────────────────────────────────

Deno.test("body_no_json_retorna_400_invalid_input", async () => {
  const req = new Request("http://localhost/edit-property", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer fake-jwt" },
    body: "esto no es json{{{",
  });
  const res = await handler(req, deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_id_ausente_retorna_400_invalid_input_ningun_seam_llamado", async () => {
  const fetcher = fetcher_ok();
  const { property_id: _omit, ...rest } = BASE_INPUT;
  const res = await handler(post_auth(rest), deps({ propertyFetcher: fetcher }));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
  assertEquals(fetcher.calls.length, 0);
});

Deno.test("operation_type_invalido_retorna_400_invalid_input", async () => {
  const input = { ...BASE_INPUT, operation_type: "renta_mensual" };
  const res = await handler(post_auth(input), deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_type_invalido_retorna_400_invalid_input", async () => {
  const input = { ...BASE_INPUT, property_type: "bodega" };
  const res = await handler(post_auth(input), deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("price_cero_o_negativo_retorna_400_invalid_input", async () => {
  const input = { ...BASE_INPUT, price: 0 };
  const res = await handler(post_auth(input), deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("address_vacio_retorna_400_invalid_input", async () => {
  const input = { ...BASE_INPUT, address: "   " };
  const res = await handler(post_auth(input), deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("metodo_get_retorna_405", async () => {
  const res = await handler(method_request("GET"));
  assertEquals(res.status, 405);
});

Deno.test("metodo_put_retorna_405", async () => {
  const res = await handler(method_request("PUT"));
  assertEquals(res.status, 405);
});

// ── Forma del error — invariante global ──────────────────────────────────────

Deno.test("error_401_tiene_forma_error_code_message", async () => {
  const res = await handler(post_sin_auth(BASE_INPUT), deps({ callerVerifier: verifier_unauthenticated() }));
  const body = await res.json();
  assertExists(body.error);
  assertEquals(typeof body.error.code, "string");
  assertEquals(typeof body.error.message, "string");
});

Deno.test("error_400_payload_invalido_tiene_forma_error_code_message", async () => {
  const res = await handler(post_auth({}), deps());
  const body = await res.json();
  assertExists(body.error);
  assertEquals(typeof body.error.code, "string");
  assertEquals(typeof body.error.message, "string");
});

// ═══════════════════════════════════════════════════════════════════════════
// #142 (fix 73.6) — REGRESIÓN 1: capacidad de agencia perdida.
// La RLS properties_update (20260805000011, capacidad deliberada de #71)
// autorizaba también a private.agency_role_of(agency_id) in ('owner','admin');
// al mover la edición a esta EF, esa rama desapareció: un owner/admin de
// agencia que corregía las publicaciones de sus agentes recibía 403.
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("142_owner_de_agencia_edita_propiedad_de_su_agente_200", async () => {
  const resolver = resolver_role("owner");
  const res = await handler(
    post_auth(BASE_INPUT),
    deps({
      callerVerifier: verifier_ok(OTRO_USUARIO_ID, false),
      propertyFetcher: fetcher_ok(CURRENT_CON_AGENCIA),
      agencyRoleResolver: resolver,
    }),
  );
  assertEquals(res.status, 200, "owner de la agencia de la fila debe poder editar (#71/#142)");
  assertEquals(resolver.calls.length, 1, "debe resolver el rol contra la agencia de la fila");
  assertEquals(resolver.calls[0].user_id, OTRO_USUARIO_ID);
  assertEquals(resolver.calls[0].agency_id, AGENCY_ID);
});

Deno.test("142_admin_de_agencia_edita_propiedad_de_su_agente_200", async () => {
  const res = await handler(
    post_auth(BASE_INPUT),
    deps({
      callerVerifier: verifier_ok(OTRO_USUARIO_ID, false),
      propertyFetcher: fetcher_ok(CURRENT_CON_AGENCIA),
      agencyRoleResolver: resolver_role("admin"),
    }),
  );
  assertEquals(res.status, 200, "admin de la agencia de la fila debe poder editar (#71/#142)");
});

Deno.test("142_member_de_agencia_NO_puede_editar_403", async () => {
  const res = await handler(
    post_auth(BASE_INPUT),
    deps({
      callerVerifier: verifier_ok(OTRO_USUARIO_ID, false),
      propertyFetcher: fetcher_ok(CURRENT_CON_AGENCIA),
      agencyRoleResolver: resolver_role("member"),
    }),
  );
  assertEquals(res.status, 403, "solo owner|admin de agencia — member no edita ajeno");
});

Deno.test("142_viewer_de_agencia_NO_puede_editar_403", async () => {
  const res = await handler(
    post_auth(BASE_INPUT),
    deps({
      callerVerifier: verifier_ok(OTRO_USUARIO_ID, false),
      propertyFetcher: fetcher_ok(CURRENT_CON_AGENCIA),
      agencyRoleResolver: resolver_role("viewer"),
    }),
  );
  assertEquals(res.status, 403);
});

Deno.test("142_sin_membresia_activa_403", async () => {
  const res = await handler(
    post_auth(BASE_INPUT),
    deps({
      callerVerifier: verifier_ok(OTRO_USUARIO_ID, false),
      propertyFetcher: fetcher_ok(CURRENT_CON_AGENCIA),
      agencyRoleResolver: resolver_role(null),
    }),
  );
  assertEquals(res.status, 403);
});

Deno.test("142_propiedad_independiente_no_consulta_resolver_y_403", async () => {
  // agency_id null (agente independiente): la rama de agencia NI SE EVALÚA.
  const resolver = resolver_role("owner");
  const res = await handler(
    post_auth(BASE_INPUT),
    deps({
      callerVerifier: verifier_ok(OTRO_USUARIO_ID, false),
      propertyFetcher: fetcher_ok(CURRENT), // agency_id: null
      agencyRoleResolver: resolver,
    }),
  );
  assertEquals(res.status, 403);
  assertEquals(resolver.calls.length, 0, "sin agency_id no hay lookup de agencia");
});

Deno.test("142_owner_directo_no_consulta_resolver_short_circuit", async () => {
  const resolver = resolver_role(null);
  const res = await handler(
    post_auth(BASE_INPUT),
    deps({
      callerVerifier: verifier_ok(OWNER_ID, false),
      propertyFetcher: fetcher_ok(CURRENT_CON_AGENCIA),
      agencyRoleResolver: resolver,
    }),
  );
  assertEquals(res.status, 200);
  assertEquals(resolver.calls.length, 0, "el dueño no necesita lookup de agencia");
});

Deno.test("142_editor_de_agencia_con_cambio_critico_va_a_revision", async () => {
  // La rama de agencia autoriza, pero el diff §15.5 sigue aplicando igual.
  const ru = revision_upserter_ok();
  const res = await handler(
    post_auth({ ...BASE_INPUT, price: 99999 }),
    deps({
      callerVerifier: verifier_ok(OTRO_USUARIO_ID, false),
      propertyFetcher: fetcher_ok(CURRENT_CON_AGENCIA),
      agencyRoleResolver: resolver_role("owner"),
      revisionUpserter: ru,
    }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.mode, "revision");
  assertEquals(ru.calls.length, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// #142 — REGRESIÓN 2: escritura destructiva con body parcial.
// El parser coaccionaba todo campo ausente a un default falsy (booleans→false,
// description→'', numéricos→null): un body parcial (caller alterno, app vieja
// tras OTA, retry) borraba amenidades y recámaras en silencio, y la
// description '' encima se diffeaba como cambio crítico → revisión espuria.
// Contrato nuevo: el body debe traer TODAS las claves editables (el móvil
// siempre manda el objeto completo) — parcial => 400 INVALID_INPUT, fail loud.
// ═══════════════════════════════════════════════════════════════════════════

function sin(campo: string): Record<string, unknown> {
  const body = { ...BASE_INPUT } as Record<string, unknown>;
  delete body[campo];
  return body;
}

Deno.test("142_body_sin_price_visible_400_no_coacciona_a_false", async () => {
  const du = direct_updater_ok();
  const res = await handler(post_auth(sin("price_visible")), deps({ directPropertyUpdater: du }));
  assertEquals(res.status, 400, "campo booleano ausente NO debe coaccionarse a false");
  assertEquals(du.calls.length, 0, "un body parcial jamás llega al UPDATE");
});

Deno.test("142_body_sin_pet_friendly_400", async () => {
  const res = await handler(post_auth(sin("pet_friendly")), deps());
  assertEquals(res.status, 400);
});

Deno.test("142_body_sin_allows_no_guarantor_400", async () => {
  const res = await handler(post_auth(sin("allows_no_guarantor")), deps());
  assertEquals(res.status, 400);
});

Deno.test("142_body_sin_student_friendly_400", async () => {
  const res = await handler(post_auth(sin("student_friendly")), deps());
  assertEquals(res.status, 400);
});

Deno.test("142_body_sin_description_400_no_coacciona_a_vacio", async () => {
  const ru = revision_upserter_ok();
  const res = await handler(post_auth(sin("description")), deps({ revisionUpserter: ru }));
  assertEquals(res.status, 400, "description ausente NO debe volverse '' (diffeaba como cambio crítico)");
  assertEquals(ru.calls.length, 0, "la description coaccionada a '' ya no manda a revisión espuria");
});

Deno.test("142_body_sin_bedrooms_400_no_coacciona_a_null", async () => {
  const res = await handler(post_auth(sin("bedrooms")), deps());
  assertEquals(res.status, 400, "clave numérica AUSENTE ≠ null explícito — no borrar en silencio");
});

Deno.test("142_body_sin_bathrooms_400", async () => {
  const res = await handler(post_auth(sin("bathrooms")), deps());
  assertEquals(res.status, 400);
});

Deno.test("142_body_sin_square_meters_400", async () => {
  const res = await handler(post_auth(sin("square_meters")), deps());
  assertEquals(res.status, 400);
});

Deno.test("142_bedrooms_null_EXPLICITO_es_valido_200", async () => {
  // null explícito = "borrar el dato a propósito" — permitido; ausente no.
  const res = await handler(
    post_auth({ ...BASE_INPUT, bedrooms: null, bathrooms: null, square_meters: null }),
    deps(),
  );
  assertEquals(res.status, 200);
});

Deno.test("142_price_visible_string_false_400_no_coacciona", async () => {
  const res = await handler(post_auth({ ...BASE_INPUT, price_visible: "false" }), deps());
  assertEquals(res.status, 400, "'false' string NO es boolean — rechazar, no interpretar");
});

Deno.test("142_description_vacia_EXPLICITA_es_valida", async () => {
  // '' explícito = borrar la descripción a propósito (cambio crítico → revisión).
  const ru = revision_upserter_ok();
  const res = await handler(
    post_auth({ ...BASE_INPUT, description: "" }),
    deps({ revisionUpserter: ru }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.mode, "revision", "borrar la description es cambio crítico §15.5");
});

// ═══════════════════════════════════════════════════════════════════════════
// Quick fixes wizard paso 3 (sesión 2026-08-15, sin tarea de Taskmaster):
// built_square_meters, half_bathrooms, currency.
//
// A DIFERENCIA de bedrooms/bathrooms/square_meters (#142, clave SIEMPRE
// requerida), estos 3 campos son NUEVOS sobre un contrato YA publicado —
// un build instalado (pre-2026-08-15, aún sin el OTA de este cambio) jamás
// va a mandarlos. Tratar su ausencia como "body parcial → 400" rompería la
// edición de TODA propiedad existente para cualquier cliente viejo (viola
// CLAUDE.md §0.5.2: el contrato se deprecia OTA-primero, nunca al revés).
// Contrato: ausente = "no tocar" (mismo patrón que `location`, arriba);
// presente (número o null explícito) = se incluye en el diff/update.
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("wizard_built_square_meters_ausente_no_es_400_ni_se_incluye", async () => {
  const du = direct_updater_ok();
  const res = await handler(post_auth(sin("built_square_meters")), deps({ directPropertyUpdater: du }));
  assertEquals(res.status, 200, "cliente viejo sin el campo nuevo sigue pudiendo editar");
  assertEquals(
    "built_square_meters" in du.calls[0].input,
    false,
    "ausente en el body → ausente en el input, nunca se fuerza a null",
  );
});

Deno.test("wizard_built_square_meters_presente_se_incluye_en_direct_update", async () => {
  const du = direct_updater_ok();
  await handler(
    post_auth({ ...BASE_INPUT, built_square_meters: 120.5 }),
    deps({ directPropertyUpdater: du }),
  );
  assertEquals(du.calls[0].input.built_square_meters, 120.5);
});

Deno.test("wizard_built_square_meters_null_explicito_se_incluye", async () => {
  const du = direct_updater_ok();
  await handler(
    post_auth({ ...BASE_INPUT, built_square_meters: null }),
    deps({ directPropertyUpdater: du }),
  );
  assertEquals(du.calls[0].input.built_square_meters, null);
});

Deno.test("wizard_half_bathrooms_ausente_no_es_400_ni_se_incluye", async () => {
  const du = direct_updater_ok();
  const res = await handler(post_auth(sin("half_bathrooms")), deps({ directPropertyUpdater: du }));
  assertEquals(res.status, 200);
  assertEquals("half_bathrooms" in du.calls[0].input, false);
});

Deno.test("wizard_half_bathrooms_presente_se_incluye_en_direct_update", async () => {
  const du = direct_updater_ok();
  await handler(
    post_auth({ ...BASE_INPUT, half_bathrooms: 1 }),
    deps({ directPropertyUpdater: du }),
  );
  assertEquals(du.calls[0].input.half_bathrooms, 1);
});

Deno.test("wizard_currency_ausente_no_es_400_ni_se_incluye", async () => {
  const du = direct_updater_ok();
  const res = await handler(post_auth(sin("currency")), deps({ directPropertyUpdater: du }));
  assertEquals(res.status, 200, "cliente viejo sin currency sigue pudiendo editar — no se fuerza a MXN");
  assertEquals("currency" in du.calls[0].input, false);
});

Deno.test("wizard_currency_presente_se_incluye_en_direct_update", async () => {
  const du = direct_updater_ok();
  await handler(
    post_auth({ ...BASE_INPUT, currency: "USD" }),
    deps({ directPropertyUpdater: du }),
  );
  assertEquals(du.calls[0].input.currency, "USD");
});

Deno.test("wizard_currency_invalida_retorna_400", async () => {
  const du = direct_updater_ok();
  const res = await handler(
    post_auth({ ...BASE_INPUT, currency: "EUR" }),
    deps({ directPropertyUpdater: du }),
  );
  assertEquals(res.status, 400);
  assertEquals(du.calls.length, 0);
});

Deno.test("wizard_campos_nuevos_no_son_criticos_no_disparan_revision", async () => {
  const ru = revision_upserter_ok();
  const res = await handler(
    post_auth({ ...BASE_INPUT, built_square_meters: 200, half_bathrooms: 2, currency: "USD" }),
    deps({ revisionUpserter: ru }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.mode, "direct", "cambiar solo estos 3 campos no es crítico (§15.5)");
  assertEquals(ru.calls.length, 0);
});
