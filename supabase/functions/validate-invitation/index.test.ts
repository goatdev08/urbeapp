/**
 * Tests RED — subtarea 5.2
 * Módulo compartido: _shared/invitation.ts  → validate_invitation_token()
 * Endpoint:          validate-invitation/index.ts → handler()
 *
 * Framework: Deno.test + std/assert
 * Ejecutar: deno test --allow-net supabase/functions/validate-invitation/index.test.ts
 *
 * ─── ESTRATEGIA DE MOCKS ─────────────────────────────────────────────────────
 * `validate_invitation_token` recibe un `InvitationDb` inyectable.
 * Los fakes de este archivo REEMPLAZAN la dependencia de datos (BD), NO el SUT.
 * Así verificamos la lógica de validación sin necesitar una BD viva.
 *
 * ─── EDGE CASES CUBIERTOS ────────────────────────────────────────────────────
 *
 * ### Happy path
 * - token_valido_retorna_ok_true_con_agency_id_agency_name_token_id
 *
 * ### Edge cases del PRD (migración 0003 / tarea #5)
 * - token_inexistente_retorna_TOKEN_NOT_FOUND
 * - token_expirado_retorna_TOKEN_EXPIRED
 * - token_revocado_retorna_TOKEN_REVOKED
 * - token_agotado_current_uses_igual_max_uses_retorna_TOKEN_MAX_USES_REACHED
 * - token_agotado_current_uses_mayor_max_uses_retorna_TOKEN_MAX_USES_REACHED
 * - max_uses_null_ilimitado_con_current_uses_alto_retorna_ok_true
 * - expires_at_null_sin_expiracion_retorna_ok_true
 * - agencia_con_status_suspended_retorna_AGENCY_INACTIVE
 * - agencia_con_status_pending_approval_retorna_AGENCY_INACTIVE
 *
 * ### Ramas de reglas no obvias
 * - el_codigo_en_claro_se_hashea_antes_de_consultar_fake_recibe_hash_no_plaintext
 *
 * ### Endpoint validate-invitation
 * - endpoint_options_retorna_200_cors_preflight
 * - endpoint_get_retorna_405_method_not_allowed
 * - endpoint_post_payload_sin_invitation_code_retorna_400_invalid_input
 * - endpoint_post_codigo_vacio_retorna_400_invalid_input
 * - endpoint_post_codigo_corto_menor_6_chars_retorna_400_invalid_input
 * - endpoint_post_json_malformado_retorna_400_invalid_input
 * - endpoint_post_codigo_valido_retorna_200_con_agency_name
 * - endpoint_post_token_no_encontrado_retorna_404_token_not_found
 * - endpoint_post_token_expirado_retorna_422_token_expired
 * - endpoint_post_token_revocado_retorna_422_token_revoked
 * - endpoint_post_token_agotado_retorna_422_token_max_uses_reached
 * - endpoint_post_agencia_inactiva_retorna_422_agency_inactive
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  validate_invitation_token,
  type InvitationDb,
  type InvitationTokenRow,
} from "../_shared/invitation.ts";
import { sha256_hex } from "../_shared/crypto.ts";
import { handler } from "./index.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PLAIN_CODE = "ABCDEF";
const FUTURE_DATE = new Date(Date.now() + 86_400_000).toISOString(); // mañana
const PAST_DATE = new Date(Date.now() - 86_400_000).toISOString(); // ayer
const TOKEN_ID = "00000000-0000-0000-0000-000000000001";
const AGENCY_ID = "00000000-0000-0000-0000-000000000002";
const AGENCY_NAME = "Inmobiliaria Demo SA de CV";

/**
 * Devuelve una fila base válida (activa, no expirada, no revocada, con uses disponibles).
 * Se calcula el hash de PLAIN_CODE en tiempo de ejecución del test para verificar
 * que el SUT pasa el hash correcto al fake.
 */
function make_fila_valida(
  overrides: Partial<InvitationTokenRow> = {},
): InvitationTokenRow {
  return {
    id: TOKEN_ID,
    agency_id: AGENCY_ID,
    token: "HASH_PLACEHOLDER", // se sobreescribe por el test que verifica el hash
    max_uses: 10,
    current_uses: 3,
    expires_at: FUTURE_DATE,
    revoked_at: null,
    agency_name: AGENCY_NAME,
    agency_status: "active",
    ...overrides,
  };
}

/**
 * Fake de InvitationDb que devuelve siempre la misma fila.
 * Registra el hash recibido para poder verificarlo en tests.
 */
function make_fake_db(
  row: InvitationTokenRow | null,
): InvitationDb & { last_hash: string | null } {
  return {
    last_hash: null,
    async find_by_hash(hash: string) {
      this.last_hash = hash;
      return row;
    },
  };
}

// ── Helpers de endpoint ───────────────────────────────────────────────────────

function make_post(body: unknown): Request {
  return new Request("http://localhost/validate-invitation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function make_method(method: string): Request {
  return new Request("http://localhost/validate-invitation", { method });
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — validate_invitation_token (lógica pura con DI)
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("token_valido_retorna_ok_true_con_agency_id_agency_name_token_id", async () => {
  const hash = await sha256_hex(PLAIN_CODE);
  const fila = make_fila_valida({ token: hash });
  const db = make_fake_db(fila);

  const result = await validate_invitation_token(db, PLAIN_CODE);

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.token_id, TOKEN_ID);
    assertEquals(result.agency_id, AGENCY_ID);
    assertEquals(result.agency_name, AGENCY_NAME);
  }
});

Deno.test("token_inexistente_retorna_TOKEN_NOT_FOUND", async () => {
  const db = make_fake_db(null); // simula que no hay fila en BD

  const result = await validate_invitation_token(db, PLAIN_CODE);

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error_code, "TOKEN_NOT_FOUND");
  }
});

Deno.test("token_expirado_retorna_TOKEN_EXPIRED", async () => {
  const hash = await sha256_hex(PLAIN_CODE);
  const fila = make_fila_valida({
    token: hash,
    expires_at: PAST_DATE, // ya expiró
  });
  const db = make_fake_db(fila);

  const result = await validate_invitation_token(db, PLAIN_CODE);

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error_code, "TOKEN_EXPIRED");
  }
});

Deno.test("token_revocado_retorna_TOKEN_REVOKED", async () => {
  const hash = await sha256_hex(PLAIN_CODE);
  const fila = make_fila_valida({
    token: hash,
    revoked_at: PAST_DATE, // revocado en el pasado
  });
  const db = make_fake_db(fila);

  const result = await validate_invitation_token(db, PLAIN_CODE);

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error_code, "TOKEN_REVOKED");
  }
});

Deno.test(
  "token_agotado_current_uses_igual_max_uses_retorna_TOKEN_MAX_USES_REACHED",
  async () => {
    const hash = await sha256_hex(PLAIN_CODE);
    // borde exacto: current_uses == max_uses → agotado
    const fila = make_fila_valida({
      token: hash,
      max_uses: 5,
      current_uses: 5, // igual = agotado
    });
    const db = make_fake_db(fila);

    const result = await validate_invitation_token(db, PLAIN_CODE);

    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.error_code, "TOKEN_MAX_USES_REACHED");
    }
  },
);

Deno.test(
  "token_agotado_current_uses_mayor_max_uses_retorna_TOKEN_MAX_USES_REACHED",
  async () => {
    const hash = await sha256_hex(PLAIN_CODE);
    // Esto no debería ocurrir en BD normal (constraint), pero la lógica debe manejarlo.
    const fila = make_fila_valida({
      token: hash,
      max_uses: 5,
      current_uses: 7, // mayor = también agotado
    });
    const db = make_fake_db(fila);

    const result = await validate_invitation_token(db, PLAIN_CODE);

    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.error_code, "TOKEN_MAX_USES_REACHED");
    }
  },
);

Deno.test(
  "max_uses_null_ilimitado_con_current_uses_alto_retorna_ok_true",
  async () => {
    const hash = await sha256_hex(PLAIN_CODE);
    const fila = make_fila_valida({
      token: hash,
      max_uses: null, // null = ilimitado
      current_uses: 9999,
    });
    const db = make_fake_db(fila);

    const result = await validate_invitation_token(db, PLAIN_CODE);

    assertEquals(result.ok, true);
  },
);

Deno.test("expires_at_null_sin_expiracion_retorna_ok_true", async () => {
  const hash = await sha256_hex(PLAIN_CODE);
  const fila = make_fila_valida({
    token: hash,
    expires_at: null, // null = nunca expira
  });
  const db = make_fake_db(fila);

  const result = await validate_invitation_token(db, PLAIN_CODE);

  assertEquals(result.ok, true);
});

Deno.test(
  "agencia_con_status_suspended_retorna_AGENCY_INACTIVE",
  async () => {
    const hash = await sha256_hex(PLAIN_CODE);
    const fila = make_fila_valida({
      token: hash,
      agency_status: "suspended",
    });
    const db = make_fake_db(fila);

    const result = await validate_invitation_token(db, PLAIN_CODE);

    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.error_code, "AGENCY_INACTIVE");
    }
  },
);

Deno.test(
  "agencia_con_status_pending_approval_retorna_AGENCY_INACTIVE",
  async () => {
    const hash = await sha256_hex(PLAIN_CODE);
    // Solo 'active' es válido; 'pending_approval' no es activo.
    const fila = make_fila_valida({
      token: hash,
      agency_status: "pending_approval",
    });
    const db = make_fake_db(fila);

    const result = await validate_invitation_token(db, PLAIN_CODE);

    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.error_code, "AGENCY_INACTIVE");
    }
  },
);

Deno.test(
  "el_codigo_en_claro_se_hashea_antes_de_consultar_fake_recibe_hash_no_plaintext",
  async () => {
    // El SUT DEBE hashear el código antes de consultar la BD.
    // El fake registra qué hash recibió; comparamos contra sha256_hex(PLAIN_CODE).
    const expected_hash = await sha256_hex(PLAIN_CODE);
    const fila = make_fila_valida({ token: expected_hash });
    const db = make_fake_db(fila);

    await validate_invitation_token(db, PLAIN_CODE).catch(() => {
      // puede lanzar si stub, pero queremos verificar el hash recibido
    });

    // El fake debe haber recibido el HASH, no el texto plano.
    assertExists(db.last_hash, "El fake nunca recibió un hash — ¿se llamó find_by_hash?");
    assertEquals(
      db.last_hash,
      expected_hash,
      `Se esperaba el hash sha256 del código, pero se recibió: "${db.last_hash}"`,
    );
    // Confirma que NO se pasó el código en claro
    assertEquals(
      db.last_hash !== PLAIN_CODE,
      true,
      "El SUT pasó el texto plano al DB fake — debe pasar el hash",
    );
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — endpoint validate-invitation/index.ts
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("endpoint_options_retorna_200_cors_preflight", async () => {
  const req = make_method("OPTIONS");
  const res = await handler(req);
  assertEquals(res.status >= 200 && res.status <= 204, true);
  assertExists(
    res.headers.get("Access-Control-Allow-Origin"),
    "Falta header CORS Allow-Origin",
  );
});

Deno.test("endpoint_get_retorna_405_method_not_allowed", async () => {
  const req = make_method("GET");
  const res = await handler(req);
  assertEquals(res.status, 405);
  const body = await res.json();
  assertEquals(body.error.code, "METHOD_NOT_ALLOWED");
});

Deno.test(
  "endpoint_post_payload_sin_invitation_code_retorna_400_invalid_input",
  async () => {
    const req = make_post({});
    const res = await handler(req);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error.code, "INVALID_INPUT");
    assertExists(body.error.message);
  },
);

Deno.test(
  "endpoint_post_codigo_vacio_retorna_400_invalid_input",
  async () => {
    const req = make_post({ invitationCode: "" });
    const res = await handler(req);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error.code, "INVALID_INPUT");
  },
);

Deno.test(
  "endpoint_post_codigo_corto_menor_6_chars_retorna_400_invalid_input",
  async () => {
    const req = make_post({ invitationCode: "ABCD" }); // 4 chars
    const res = await handler(req);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error.code, "INVALID_INPUT");
  },
);

Deno.test(
  "endpoint_post_json_malformado_retorna_400_invalid_input",
  async () => {
    const req = new Request("http://localhost/validate-invitation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ esto no es json }",
    });
    const res = await handler(req);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error.code, "INVALID_INPUT");
  },
);

Deno.test(
  "endpoint_post_codigo_valido_retorna_200_con_agency_name",
  async () => {
    // Fake db que devuelve token válido
    const hash = await sha256_hex(PLAIN_CODE);
    const fila = make_fila_valida({ token: hash });
    const db = make_fake_db(fila);

    const req = make_post({ invitationCode: PLAIN_CODE });
    const res = await handler(req, db);

    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.agency_name, AGENCY_NAME);
  },
);

Deno.test(
  "endpoint_post_token_no_encontrado_retorna_404_token_not_found",
  async () => {
    const db = make_fake_db(null);
    const req = make_post({ invitationCode: PLAIN_CODE });
    const res = await handler(req, db);

    assertEquals(res.status, 404);
    const body = await res.json();
    assertEquals(body.error.code, "TOKEN_NOT_FOUND");
    assertExists(body.error.message);
  },
);

Deno.test(
  "endpoint_post_token_expirado_retorna_422_token_expired",
  async () => {
    const hash = await sha256_hex(PLAIN_CODE);
    const db = make_fake_db(make_fila_valida({ token: hash, expires_at: PAST_DATE }));
    const req = make_post({ invitationCode: PLAIN_CODE });
    const res = await handler(req, db);

    assertEquals(res.status, 422);
    const body = await res.json();
    assertEquals(body.error.code, "TOKEN_EXPIRED");
    assertExists(body.error.message);
  },
);

Deno.test(
  "endpoint_post_token_revocado_retorna_422_token_revoked",
  async () => {
    const hash = await sha256_hex(PLAIN_CODE);
    const db = make_fake_db(
      make_fila_valida({ token: hash, revoked_at: PAST_DATE }),
    );
    const req = make_post({ invitationCode: PLAIN_CODE });
    const res = await handler(req, db);

    assertEquals(res.status, 422);
    const body = await res.json();
    assertEquals(body.error.code, "TOKEN_REVOKED");
    assertExists(body.error.message);
  },
);

Deno.test(
  "endpoint_post_token_agotado_retorna_422_token_max_uses_reached",
  async () => {
    const hash = await sha256_hex(PLAIN_CODE);
    const db = make_fake_db(
      make_fila_valida({ token: hash, max_uses: 5, current_uses: 5 }),
    );
    const req = make_post({ invitationCode: PLAIN_CODE });
    const res = await handler(req, db);

    assertEquals(res.status, 422);
    const body = await res.json();
    assertEquals(body.error.code, "TOKEN_MAX_USES_REACHED");
    assertExists(body.error.message);
  },
);

Deno.test(
  "endpoint_post_agencia_inactiva_retorna_422_agency_inactive",
  async () => {
    const hash = await sha256_hex(PLAIN_CODE);
    const db = make_fake_db(
      make_fila_valida({ token: hash, agency_status: "suspended" }),
    );
    const req = make_post({ invitationCode: PLAIN_CODE });
    const res = await handler(req, db);

    assertEquals(res.status, 422);
    const body = await res.json();
    assertEquals(body.error.code, "AGENCY_INACTIVE");
    assertExists(body.error.message);
  },
);
