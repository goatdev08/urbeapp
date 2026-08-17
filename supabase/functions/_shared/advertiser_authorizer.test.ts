// supabase/functions/_shared/advertiser_authorizer.test.ts
// Tests del AdvertiserAuthorizer REAL (make_advertiser_authorizer) — subtarea
// 169.4 (cierre pedido por el guardián, 2026-08-16).
//
// GAP reportado por el guardián: la suite DI de mint-ad-upload-url/handler.test.ts
// solo prueba el CONTRATO del handler contra un mock (authorize_advertiser
// configurado por escenario) — la correctitud de la QUERY REAL (membresía activa,
// rol owner/admin, capacidad de anunciar) no tenía cobertura automatizada. Mismo
// patrón que duplicate_property_checker.test.ts / poster_url_minter.test.ts
// (fake client chainable + thenable, capturando la forma de la query).
//
// Mutante que este archivo debe matar (criterio del guardián, id "d"): si
// make_advertiser_authorizer deja de consultar la capacidad de anunciar,
// CUALQUIER owner/admin de CUALQUIER organización podría anunciar. La sección
// "capacidad de anunciar" abajo lo cubre: con membresía owner/admin válida pero
// capacidad=false, el resultado DEBE seguir siendo FORBIDDEN.
//
// El mecanismo real hoy es un RPC (`client.rpc(...)`, ver clients.ts:1486-1531),
// pero ese mecanismo puede cambiar (el guardián reportó que la EF hoy devuelve
// 403 a todo el mundo porque PostgREST no expone `private.org_can_advertise` —
// el fix probablemente pasa por un wrapper público, posiblemente con otro
// nombre). Por eso el fake intercepta CUALQUIER llamada a `.rpc(fn, args)` de
// forma genérica (sin asertar el nombre literal) y el test verifica el
// COMPORTAMIENTO OBSERVABLE (qué se consulta, con qué filtros, qué devuelve ante
// cada caso), no el nombre de la función RPC.
//
// Framework: Deno.test + @std/assert
// Ejecutar:
//   cd supabase/functions && deno test --allow-env --allow-net --allow-read \
//     --config deno.json _shared/advertiser_authorizer.test.ts
//
// ─── EDGE CASES CUBIERTOS ─────────────────────────────────────────────────────
//
// ### Shape de la query de membresía (lección #8 — barrera de datos, no de auth)
// - consulta_la_tabla_agency_members
// - filtra_por_user_id_recibido
// - filtra_por_status_active
//
// ### Las 3 causas de FORBIDDEN, distinguidas de VERDAD (no colapsadas por un fake)
// - sin_membresia_activa_retorna_forbidden_sin_consultar_capacidad
// - miembro_viewer_no_owner_admin_retorna_forbidden_sin_consultar_capacidad
// - miembro_agent_no_owner_admin_retorna_forbidden_sin_consultar_capacidad
// - owner_de_organizacion_sin_capacidad_de_anunciar_retorna_forbidden (mutante "d")
// - admin_de_organizacion_sin_capacidad_de_anunciar_retorna_forbidden (mutante "d", rol admin)
//
// ### Happy path — owner y admin, ambos con capacidad
// - owner_de_organizacion_con_capacidad_retorna_ok_true_con_agency_id
// - admin_de_organizacion_con_capacidad_retorna_ok_true_con_agency_id
//
// ### Fail-closed ante errores/valores ambiguos
// - error_en_la_consulta_de_membresia_retorna_forbidden
// - error_en_la_consulta_de_capacidad_retorna_forbidden
// - capacidad_null_no_es_true_retorna_forbidden (no aflojar a "!== false")

import { assertEquals } from "@std/assert";
import { make_advertiser_authorizer } from "./clients.ts";

// ── Tipos internos del fake ───────────────────────────────────────────────────

interface MembershipRow {
  agency_id: string;
  member_role: string;
}

interface EqCall {
  column: string;
  value: unknown;
}

interface RpcCall {
  fn: string;
  args: Record<string, unknown> | undefined;
}

// ── FakeMembershipQueryBuilder — captura la forma de la query de membresía ────

class FakeMembershipQueryBuilder {
  eq_calls: EqCall[] = [];
  constructor(
    private response: { data: MembershipRow | null; error: { message: string } | null },
  ) {}

  select(_columns: string): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.eq_calls.push({ column, value });
    return this;
  }

  maybeSingle(): Promise<{ data: MembershipRow | null; error: { message: string } | null }> {
    return Promise.resolve(this.response);
  }
}

function make_fake_client(opts: {
  membership: { data: MembershipRow | null; error?: { message: string } | null };
  capacity?: { data: boolean | null; error?: { message: string } | null };
}) {
  const from_calls: string[] = [];
  const rpc_calls: RpcCall[] = [];
  let last_membership_builder: FakeMembershipQueryBuilder | undefined;

  const capacity_response = opts.capacity ?? { data: true, error: null };

  const client = {
    from(table: string): FakeMembershipQueryBuilder {
      from_calls.push(table);
      last_membership_builder = new FakeMembershipQueryBuilder({
        data: opts.membership.data,
        error: opts.membership.error ?? null,
      });
      return last_membership_builder;
    },
    rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: boolean | null; error: { message: string } | null }> {
      rpc_calls.push({ fn, args });
      return Promise.resolve({
        data: capacity_response.data,
        error: capacity_response.error ?? null,
      });
    },
  };

  return {
    client,
    from_calls,
    rpc_calls,
    get membership_builder(): FakeMembershipQueryBuilder {
      return last_membership_builder!;
    },
  };
}

// ── Constantes ──────────────────────────────────────────────────────────────

const CALLER_UID = "00000000-0000-0000-0000-000000000001";
const AGENCY_ID = "10000000-0000-0000-0000-000000000001";

// ── Shape de la query de membresía ────────────────────────────────────────────

Deno.test("consulta_la_tabla_agency_members", async () => {
  const fake = make_fake_client({ membership: { data: null } });
  const authorizer = make_advertiser_authorizer(fake.client as never);
  await authorizer.authorize_advertiser(CALLER_UID);
  assertEquals(fake.from_calls, ["agency_members"], "la membresía debe consultarse sobre agency_members");
});

Deno.test("filtra_por_user_id_recibido", async () => {
  const fake = make_fake_client({
    membership: { data: { agency_id: AGENCY_ID, member_role: "owner" } },
  });
  const authorizer = make_advertiser_authorizer(fake.client as never);
  await authorizer.authorize_advertiser(CALLER_UID);
  const user_id_call = fake.membership_builder.eq_calls.find((c) => c.column === "user_id");
  assertEquals(
    user_id_call?.value,
    CALLER_UID,
    "la query de membresía debe filtrar por el user_id recibido, no un valor fijo",
  );
});

Deno.test("filtra_por_status_active", async () => {
  const fake = make_fake_client({
    membership: { data: { agency_id: AGENCY_ID, member_role: "owner" } },
  });
  const authorizer = make_advertiser_authorizer(fake.client as never);
  await authorizer.authorize_advertiser(CALLER_UID);
  const status_call = fake.membership_builder.eq_calls.find((c) => c.column === "status");
  assertEquals(
    status_call?.value,
    "active",
    "solo una membresía ACTIVA debe autorizar — sin este filtro, una membresía revocada colaría",
  );
});

// ── Las 3 causas de FORBIDDEN, distinguidas de verdad ─────────────────────────

Deno.test("sin_membresia_activa_retorna_forbidden_sin_consultar_capacidad", async () => {
  const fake = make_fake_client({ membership: { data: null } });
  const authorizer = make_advertiser_authorizer(fake.client as never);
  const result = await authorizer.authorize_advertiser(CALLER_UID);
  assertEquals(result, { ok: false, error_code: "FORBIDDEN" });
  assertEquals(
    fake.rpc_calls.length,
    0,
    "sin membresía activa no hay agency_id que consultar — la capacidad no debe consultarse",
  );
});

Deno.test("miembro_viewer_no_owner_admin_retorna_forbidden_sin_consultar_capacidad", async () => {
  const fake = make_fake_client({
    membership: { data: { agency_id: AGENCY_ID, member_role: "viewer" } },
  });
  const authorizer = make_advertiser_authorizer(fake.client as never);
  const result = await authorizer.authorize_advertiser(CALLER_UID);
  assertEquals(result, { ok: false, error_code: "FORBIDDEN" });
  assertEquals(fake.rpc_calls.length, 0, "un rol no owner/admin corta antes de consultar la capacidad");
});

Deno.test("miembro_agent_no_owner_admin_retorna_forbidden_sin_consultar_capacidad", async () => {
  const fake = make_fake_client({
    membership: { data: { agency_id: AGENCY_ID, member_role: "agent" } },
  });
  const authorizer = make_advertiser_authorizer(fake.client as never);
  const result = await authorizer.authorize_advertiser(CALLER_UID);
  assertEquals(result, { ok: false, error_code: "FORBIDDEN" });
  assertEquals(fake.rpc_calls.length, 0);
});

Deno.test("owner_de_organizacion_sin_capacidad_de_anunciar_retorna_forbidden", async () => {
  // Mutante "d" (guardián): si el checker de capacidad se elimina, este
  // resultado pasaría a ok:true (bypass) aunque la capacidad fake sea false.
  const fake = make_fake_client({
    membership: { data: { agency_id: AGENCY_ID, member_role: "owner" } },
    capacity: { data: false },
  });
  const authorizer = make_advertiser_authorizer(fake.client as never);
  const result = await authorizer.authorize_advertiser(CALLER_UID);
  assertEquals(
    result,
    { ok: false, error_code: "FORBIDDEN" },
    "owner/admin de una organización real, pero SIN la capacidad encendida, sigue siendo FORBIDDEN",
  );
  assertEquals(
    fake.rpc_calls.length,
    1,
    "la capacidad SÍ debe consultarse una vez que la membresía es owner/admin",
  );
});

Deno.test("admin_de_organizacion_sin_capacidad_de_anunciar_retorna_forbidden", async () => {
  // Mismo mutante "d", rol admin (no solo owner) — el guard de capacidad debe
  // aplicar a AMBOS roles habilitados, no solo a owner.
  const fake = make_fake_client({
    membership: { data: { agency_id: AGENCY_ID, member_role: "admin" } },
    capacity: { data: false },
  });
  const authorizer = make_advertiser_authorizer(fake.client as never);
  const result = await authorizer.authorize_advertiser(CALLER_UID);
  assertEquals(result, { ok: false, error_code: "FORBIDDEN" });
  assertEquals(fake.rpc_calls.length, 1);
});

// ── Happy path ────────────────────────────────────────────────────────────────

Deno.test("owner_de_organizacion_con_capacidad_retorna_ok_true_con_agency_id", async () => {
  const fake = make_fake_client({
    membership: { data: { agency_id: AGENCY_ID, member_role: "owner" } },
    capacity: { data: true },
  });
  const authorizer = make_advertiser_authorizer(fake.client as never);
  const result = await authorizer.authorize_advertiser(CALLER_UID);
  assertEquals(result, { ok: true, agency_id: AGENCY_ID });
});

Deno.test("admin_de_organizacion_con_capacidad_retorna_ok_true_con_agency_id", async () => {
  const fake = make_fake_client({
    membership: { data: { agency_id: AGENCY_ID, member_role: "admin" } },
    capacity: { data: true },
  });
  const authorizer = make_advertiser_authorizer(fake.client as never);
  const result = await authorizer.authorize_advertiser(CALLER_UID);
  assertEquals(result, { ok: true, agency_id: AGENCY_ID });
});

// ── Fail-closed ante errores/valores ambiguos ─────────────────────────────────

Deno.test("error_en_la_consulta_de_membresia_retorna_forbidden", async () => {
  const fake = make_fake_client({
    membership: { data: null, error: { message: "connection timeout" } },
  });
  const authorizer = make_advertiser_authorizer(fake.client as never);
  const result = await authorizer.authorize_advertiser(CALLER_UID);
  assertEquals(result, { ok: false, error_code: "FORBIDDEN" });
});

Deno.test("error_en_la_consulta_de_capacidad_retorna_forbidden", async () => {
  const fake = make_fake_client({
    membership: { data: { agency_id: AGENCY_ID, member_role: "owner" } },
    capacity: { data: null, error: { message: "rpc timeout" } },
  });
  const authorizer = make_advertiser_authorizer(fake.client as never);
  const result = await authorizer.authorize_advertiser(CALLER_UID);
  assertEquals(
    result,
    { ok: false, error_code: "FORBIDDEN" },
    "un error al consultar la capacidad debe fallar cerrado, nunca autorizar",
  );
});

Deno.test("capacidad_null_no_es_true_retorna_forbidden", async () => {
  // Si el guard se aflojara de "=== true" a "!== false", un valor null (p.ej.
  // una RPC que no encontró la organización y devuelve null sin error) colaría.
  const fake = make_fake_client({
    membership: { data: { agency_id: AGENCY_ID, member_role: "owner" } },
    capacity: { data: null, error: null },
  });
  const authorizer = make_advertiser_authorizer(fake.client as never);
  const result = await authorizer.authorize_advertiser(CALLER_UID);
  assertEquals(result, { ok: false, error_code: "FORBIDDEN" });
});
