/**
 * Tests RED — subtarea 5.1
 * Edge Function: redeem-invitation/index.ts
 * Framework: Deno.test + std/assert
 *
 * EDGE CASES ENUMERADOS (todos deben FALLAR en rojo hasta que el agente supabase
 * implemente la lógica real en la fase GREEN):
 *
 * ### Happy path
 * - POST con payload completo y válido → 200 con Content-Type application/json
 *
 * ### Edge cases de validación de entrada (§7.1 lineamientos, contrato 5.1)
 * - Payload vacío / sin body → 400 { error: { code: "INVALID_INPUT", message } }
 * - invitationCode ausente → 400 INVALID_INPUT
 * - invitationCode string vacío → 400 INVALID_INPUT
 * - invitationCode con < 6 caracteres → 400 INVALID_INPUT
 * - email ausente → 400 INVALID_INPUT
 * - email malformado → 400 INVALID_INPUT
 * - password ausente → 400 INVALID_INPUT
 * - password con < 8 caracteres → 400 INVALID_INPUT
 * - fullName ausente → 400 INVALID_INPUT
 * - fullName cadena vacía → 400 INVALID_INPUT
 * - Campos extra ignorados (no rompe la función)
 *
 * ### CORS — ramas de reglas no obvias
 * - OPTIONS → 200 con Access-Control-Allow-Origin
 * - OPTIONS → header Access-Control-Allow-Methods presente
 * - OPTIONS → header Access-Control-Allow-Headers presente
 *
 * ### Método HTTP
 * - GET → 405 Method Not Allowed
 * - PUT → 405 Method Not Allowed
 * - DELETE → 405 Method Not Allowed
 *
 * ### Forma del error
 * - Cualquier error de validación tiene forma { error: { code, message } }
 * - error.code === "INVALID_INPUT" para errores de payload
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

// ── Helpers de test ────────────────────────────────────────────────────────────

function make_post_request(body: unknown): Request {
  return new Request("http://localhost/redeem-invitation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function make_method_request(method: string): Request {
  return new Request("http://localhost/redeem-invitation", { method });
}

const payload_valido = {
  invitationCode: "ABCDEF",
  email: "agente@inmobiliaria.mx",
  password: "secreto123",
  fullName: "Juan Pérez",
};

// ── Happy path ─────────────────────────────────────────────────────────────────

Deno.test("happy_path_post_valido_responde_200_json", async () => {
  const req = make_post_request(payload_valido);
  const res = await handler(req);
  assertEquals(res.status, 200);
  const content_type = res.headers.get("Content-Type") ?? "";
  assertEquals(content_type.includes("application/json"), true);
});

// ── Validación de entrada ─────────────────────────────────────────────────────

Deno.test("validacion_payload_vacio_retorna_400_invalid_input", async () => {
  const req = make_post_request({});
  const res = await handler(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertExists(body.error);
  assertEquals(body.error.code, "INVALID_INPUT");
  assertExists(body.error.message);
});

Deno.test("validacion_invitation_code_ausente_retorna_400", async () => {
  const { invitationCode: _omit, ...sin_codigo } = payload_valido;
  const req = make_post_request(sin_codigo);
  const res = await handler(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_invitation_code_string_vacio_retorna_400", async () => {
  const req = make_post_request({ ...payload_valido, invitationCode: "" });
  const res = await handler(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_invitation_code_menor_6_caracteres_retorna_400", async () => {
  const req = make_post_request({ ...payload_valido, invitationCode: "ABCD" });
  const res = await handler(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_email_ausente_retorna_400", async () => {
  const { email: _omit, ...sin_email } = payload_valido;
  const req = make_post_request(sin_email);
  const res = await handler(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_email_malformado_retorna_400", async () => {
  const req = make_post_request({ ...payload_valido, email: "no-es-email" });
  const res = await handler(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_password_ausente_retorna_400", async () => {
  const { password: _omit, ...sin_pass } = payload_valido;
  const req = make_post_request(sin_pass);
  const res = await handler(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_password_menos_de_8_caracteres_retorna_400", async () => {
  const req = make_post_request({ ...payload_valido, password: "abc123" });
  const res = await handler(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_full_name_ausente_retorna_400", async () => {
  const { fullName: _omit, ...sin_nombre } = payload_valido;
  const req = make_post_request(sin_nombre);
  const res = await handler(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_full_name_cadena_vacia_retorna_400", async () => {
  const req = make_post_request({ ...payload_valido, fullName: "" });
  const res = await handler(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_campos_extra_no_rompen_la_funcion", async () => {
  // Campos extra deben ser ignorados silenciosamente (no 400, no 500)
  // El handler lanzará not_implemented en la lógica de negocio → no 400 por campos extra
  const req = make_post_request({
    ...payload_valido,
    campo_extra: "valor_inesperado",
    otro_campo: 42,
  });
  const res = await handler(req);
  // No debe ser 400 (los campos extra no son error de validación de entrada)
  assertEquals(res.status !== 400, true);
});

// ── CORS preflight ─────────────────────────────────────────────────────────────

Deno.test("cors_options_preflight_retorna_200", async () => {
  const req = make_method_request("OPTIONS");
  const res = await handler(req);
  // Rango 200-204 aceptable para preflight
  assertEquals(res.status >= 200 && res.status <= 204, true);
});

Deno.test("cors_options_preflight_tiene_header_allow_origin", async () => {
  const req = make_method_request("OPTIONS");
  const res = await handler(req);
  const header = res.headers.get("Access-Control-Allow-Origin");
  assertExists(header, "Falta header Access-Control-Allow-Origin");
});

Deno.test("cors_options_preflight_tiene_header_allow_methods", async () => {
  const req = make_method_request("OPTIONS");
  const res = await handler(req);
  const header = res.headers.get("Access-Control-Allow-Methods");
  assertExists(header, "Falta header Access-Control-Allow-Methods");
});

Deno.test("cors_options_preflight_tiene_header_allow_headers", async () => {
  const req = make_method_request("OPTIONS");
  const res = await handler(req);
  const header = res.headers.get("Access-Control-Allow-Headers");
  assertExists(header, "Falta header Access-Control-Allow-Headers");
});

// ── Métodos HTTP no permitidos ─────────────────────────────────────────────────

Deno.test("metodo_get_retorna_405", async () => {
  const req = make_method_request("GET");
  const res = await handler(req);
  assertEquals(res.status, 405);
});

Deno.test("metodo_put_retorna_405", async () => {
  const req = make_method_request("PUT");
  const res = await handler(req);
  assertEquals(res.status, 405);
});

Deno.test("metodo_delete_retorna_405", async () => {
  const req = make_method_request("DELETE");
  const res = await handler(req);
  assertEquals(res.status, 405);
});

// ── Forma del error ────────────────────────────────────────────────────────────

Deno.test("error_siempre_tiene_forma_error_code_message", async () => {
  // Cualquier respuesta de error (no 2xx) debe tener { error: { code, message } }
  const req = make_post_request({ invitationCode: "AB" }); // payload inválido (< 6 chars)
  const res = await handler(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  // Debe ser objeto con propiedad `error`
  assertExists(
    body.error,
    "La respuesta de error no contiene propiedad 'error'",
  );
  // `error` debe tener `code`
  assertExists(body.error.code, "error.code está ausente");
  // `error` debe tener `message`
  assertExists(body.error.message, "error.message está ausente");
});

Deno.test("error_code_es_exactamente_INVALID_INPUT_para_payload_invalido", async () => {
  const req = make_post_request({}); // payload vacío
  const res = await handler(req);
  const body = await res.json();
  // El code debe ser la cadena exacta, no "invalid_input" ni "validation_error"
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("error_no_es_string_plano_sino_objeto_estructurado", async () => {
  const req = make_post_request({ invitationCode: "AB" });
  const res = await handler(req);
  const body = await res.json();
  // El cuerpo NO debe ser un string simple ni { message } sin code
  assertEquals(typeof body, "object");
  assertEquals(typeof body.error, "object");
  assertEquals(typeof body.error.code, "string");
  assertEquals(typeof body.error.message, "string");
});
