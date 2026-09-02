/**
 * Tests del adaptador REAL make_agency_role_resolver(client) — _shared/clients.ts
 * SUT: la QUERY, no el contrato (ese lo prueban los fakes de
 * edit-property/handler.test.ts y update-property-status/property_status_updater.test.ts).
 *
 * GAP reportado por el guardian de 202.2: el resolver es el ÚNICO punto de
 * estrangulamiento de "membresía vigente" en las Edge Functions y no tenía
 * ningún test propio — el mutante `if (error) return "agent"` sobrevivía con la
 * suite entera en verde. Un fail-open ahí deja actuar a un agente suspendido
 * cada vez que la query falle.
 *
 * Técnica: fake postgrest client chainable que aplica los filtros EN el fake
 * (in-memory), mismo patrón que _shared/duplicate_property_checker.test.ts, para
 * poder afirmar sobre combinaciones reales de agencia/usuario/status sin
 * acoplarse al SQL exacto.
 *
 * Framework: Deno.test + @std/assert
 * Ejecutar:
 *   cd supabase/functions && deno test --allow-all _shared/agency_role.test.ts
 *
 * ─── EDGE CASES CUBIERTOS ─────────────────────────────────────────────────
 * - membresía ACTIVA → devuelve su member_role (y consulta agency_members)
 * - la query se escopa a status='active': una membresía suspendida de ESE
 *   usuario en ESA agencia no devuelve rol (el corazón de #202)
 * - membresía removida → null
 * - membresía de otro usuario / de otra agencia → null (no cruza scopes)
 * - sin fila → null
 * - error de la query → null 🔴 FAIL-CLOSED (no devuelve rol, no lanza)
 */

import { assertEquals } from "@std/assert";
import { make_agency_role_resolver } from "./clients.ts";

// ── Fila cruda simulada de public.agency_members ──────────────────────────────

interface MemberRow {
  agency_id: string;
  user_id: string;
  status: string;
  member_role: string;
}

// ── Fake client chainable: aplica los .eq() sobre las filas en memoria ────────

function make_fake_client(
  rows: MemberRow[],
  error: { message: string } | null = null,
) {
  const capturas: Array<[string, unknown]> = [];
  let tabla_pedida: string | null = null;

  return {
    capturas,
    tabla: () => tabla_pedida,
    from(table: string) {
      tabla_pedida = table;
      let filtradas = [...rows];
      return {
        select(_cols: string) {
          return this;
        },
        eq(column: string, value: unknown) {
          capturas.push([column, value]);
          filtradas = filtradas.filter(
            (r) => (r as unknown as Record<string, unknown>)[column] === value,
          );
          return this;
        },
        maybeSingle() {
          if (error) return Promise.resolve({ data: null, error });
          return Promise.resolve({ data: filtradas[0] ?? null, error: null });
        },
      };
    },
  };
}

// ── Constantes ────────────────────────────────────────────────────────────────

const AGENCY = "00000000-0000-0000-0202-000000000001";
const OTRA_AGENCY = "00000000-0000-0000-0202-000000000002";
const USER = "00000000-0000-0000-0202-000000000010";
const OTRO_USER = "00000000-0000-0000-0202-000000000011";

function fila(overrides: Partial<MemberRow> = {}): MemberRow {
  return {
    agency_id: AGENCY,
    user_id: USER,
    status: "active",
    member_role: "agent",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test("resolver_real_membresia_activa_devuelve_su_member_role", async () => {
  const client = make_fake_client([fila({ member_role: "admin" })]);
  const resolver = make_agency_role_resolver(client as never);

  assertEquals(await resolver.resolve(USER, AGENCY), "admin");
  assertEquals(client.tabla(), "agency_members");
});

Deno.test("resolver_real_filtra_por_status_active_una_suspendida_no_cuenta", async () => {
  // La MISMA persona en la MISMA agencia, pero suspendida: el corazón de #202.
  const client = make_fake_client([fila({ status: "suspended", member_role: "owner" })]);
  const resolver = make_agency_role_resolver(client as never);

  assertEquals(
    await resolver.resolve(USER, AGENCY),
    null,
    "una membresía suspendida NO es una membresía vigente",
  );
  assertEquals(
    client.capturas.some(([col, val]) => col === "status" && val === "active"),
    true,
    "la query debe escoparse a status='active' (espejo de private.agency_role_of)",
  );
});

Deno.test("resolver_real_membresia_removida_tampoco_cuenta", async () => {
  const client = make_fake_client([fila({ status: "removed", member_role: "agent" })]);
  const resolver = make_agency_role_resolver(client as never);
  assertEquals(await resolver.resolve(USER, AGENCY), null);
});

Deno.test("resolver_real_no_cruza_usuarios_ni_agencias", async () => {
  const client = make_fake_client([
    fila({ user_id: OTRO_USER, member_role: "owner" }),
    fila({ agency_id: OTRA_AGENCY, member_role: "owner" }),
  ]);
  const resolver = make_agency_role_resolver(client as never);

  assertEquals(
    await resolver.resolve(USER, AGENCY),
    null,
    "ni la membresía de otro usuario ni la de otra agencia autorizan aquí",
  );
  assertEquals(
    client.capturas.some(([col, val]) => col === "agency_id" && val === AGENCY),
    true,
  );
  assertEquals(
    client.capturas.some(([col, val]) => col === "user_id" && val === USER),
    true,
  );
});

Deno.test("resolver_real_sin_fila_devuelve_null", async () => {
  const client = make_fake_client([]);
  const resolver = make_agency_role_resolver(client as never);
  assertEquals(await resolver.resolve(USER, AGENCY), null);
});

Deno.test("resolver_real_error_de_query_devuelve_null_fail_closed", async () => {
  // 🔴 Mutante que este test mata: `if (error) return "agent"` (o cualquier
  // fail-open). Si la query truena, "no pude comprobar la membresía" se trata
  // como "no hay membresía" — nunca se autoriza por defecto.
  const client = make_fake_client([fila({ member_role: "owner" })], {
    message: "timeout",
  });
  const resolver = make_agency_role_resolver(client as never);

  assertEquals(
    await resolver.resolve(USER, AGENCY),
    null,
    "fail-closed: un error de la query jamás debe devolver un rol",
  );
});
