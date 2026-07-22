/**
 * Tests RED — subtarea 68.14 (Épica B Stream, thumbnail picker)
 * SUT: make_thumbnail_url_signer(hlsConfig) en _shared/clients.ts
 *
 * Framework: Deno.test + @std/assert + jose (verificación de JWT RS256)
 * Ejecutar:
 *   cd supabase/functions && deno test --allow-env --allow-net --allow-read \
 *     --config deno.json _shared/thumbnail_url_signer.test.ts
 *
 * SEAM bajo test: la firma REAL del token de thumbnail (frontera de confianza —
 * NUNCA se mockea el firmado en sí). Se genera una llave RSA real de prueba con
 * jose (`generateKeyPair("RS256")`), se exporta a JWK y se inyecta como
 * `hlsConfig.streamSigningJwk` (mismo encoding que el secret real: JSON → base64
 * estándar, igual que _shared/video_url_minter.test.ts). El JWT emitido se
 * verifica con la pública de prueba — así el test NO es tautológico (no recomputa
 * el mismo cálculo que hace el signer; valida contra jose.jwtVerify).
 *
 * EDGE CASES (RED):
 * ### baseUrl
 * - baseUrl_contiene_token_en_el_path_y_thumbnails_thumbnail_jpg_con_customer_subdomain
 * - baseUrl_usa_videodelivery_net_fallback_sin_subdomain_configurado
 *
 * ### token JWT (firma real, verificado con jose contra la llave pública de prueba)
 * - token_es_jwt_rs256_valido_con_header_kid_y_payload_sub_igual_al_uid
 * - exp_del_jwt_respeta_signed_url_ttl_seconds_inyectado
 * - distintos_cloudflare_uid_producen_tokens_con_sub_distinto_no_tautologico
 *
 * ### expiresIn
 * - expiresIn_del_resultado_es_exactamente_el_ttl_inyectado
 *
 * ### Fail-closed (config de firma inválida)
 * - streaming_signing_jwk_invalido_hace_que_sign_lance_sin_devolver_resultado
 */

import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { exportJWK, generateKeyPair, importJWK, type JWK, jwtVerify } from "jose";
import { make_thumbnail_url_signer } from "./clients.ts";
import type { HlsSignerConfig } from "../mint-video-url/types.ts";

const TEST_KEY_ID = "test-thumbnail-signing-key-01";
const CLOUDFLARE_UID_1 = "cf-uid-thumb-0000000000000001";
const CLOUDFLARE_UID_2 = "cf-uid-thumb-0000000000000002";

/** Genera un par de llaves RSA de prueba (RS256) y exporta la privada como JWK. */
async function generate_test_signing_key(): Promise<{
  public_jwk: JWK;
  private_jwk_base64: string;
}> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const private_jwk = await exportJWK(privateKey);
  private_jwk.kid = TEST_KEY_ID;
  private_jwk.alg = "RS256";
  private_jwk.use = "sig";
  const public_jwk = await exportJWK(publicKey);

  return {
    public_jwk,
    private_jwk_base64: btoa(JSON.stringify(private_jwk)),
  };
}

function make_hls_config(
  private_jwk_base64: string,
  overrides: Partial<HlsSignerConfig> = {},
): HlsSignerConfig {
  return {
    streamSigningKeyId: TEST_KEY_ID,
    streamSigningJwk: private_jwk_base64,
    signedUrlTtlSeconds: 14400,
    ...overrides,
  };
}

// ── baseUrl ────────────────────────────────────────────────────────────────────

Deno.test("baseUrl_contiene_token_en_el_path_y_thumbnails_thumbnail_jpg_con_customer_subdomain", async () => {
  // ⚠️ CONTRATO CORREGIDO (verificado en vivo 2026-07-22): Cloudflare exige el
  // TOKEN en el path — no el uid. '.../<uid>/thumbnails/...?token=' → 401;
  // '.../<TOKEN>/thumbnails/...' → 200.
  const { public_jwk, private_jwk_base64 } = await generate_test_signing_key();
  const hls_config = make_hls_config(private_jwk_base64, {
    streamCustomerSubdomain: "abc123",
  });

  const signer = make_thumbnail_url_signer(hls_config);
  const result = await signer.sign(CLOUDFLARE_UID_1);

  assertEquals(
    result.baseUrl,
    `https://customer-abc123.cloudflarestream.com/${result.token}/thumbnails/thumbnail.jpg`,
    "baseUrl debe usar el subdominio customer-<sub>.cloudflarestream.com, el TOKEN (no el uid) en el path, y terminar en /thumbnails/thumbnail.jpg",
  );
  assertEquals(
    result.baseUrl.includes(CLOUDFLARE_UID_1),
    false,
    "ANTI-REGRESIÓN: baseUrl NO debe contener el uid en el path — Cloudflare exige el token ahí",
  );
  assertEquals(
    result.baseUrl.includes("?token="),
    false,
    "ANTI-REGRESIÓN: baseUrl NO debe llevar '?token=' como query param",
  );

  const public_key = await importJWK(public_jwk, "RS256");
  const { payload } = await jwtVerify(result.token, public_key, { algorithms: ["RS256"] });
  assertEquals(
    payload.sub,
    CLOUDFLARE_UID_1,
    "el token embebido en el path de baseUrl debe firmar sub=cloudflare_uid",
  );
});

Deno.test("baseUrl_usa_videodelivery_net_fallback_sin_subdomain_configurado", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const hls_config = make_hls_config(private_jwk_base64); // sin streamCustomerSubdomain

  const signer = make_thumbnail_url_signer(hls_config);
  const result = await signer.sign(CLOUDFLARE_UID_1);

  assertEquals(
    result.baseUrl,
    `https://videodelivery.net/${result.token}/thumbnails/thumbnail.jpg`,
    "sin streamCustomerSubdomain, baseUrl debe caer al dominio videodelivery.net con el TOKEN (no el uid) en el path",
  );
  assertEquals(
    result.baseUrl.includes(CLOUDFLARE_UID_1),
    false,
    "ANTI-REGRESIÓN: baseUrl NO debe contener el uid en el path",
  );
});

// ── Token JWT (firma real) ────────────────────────────────────────────────────

Deno.test("token_es_jwt_rs256_valido_con_header_kid_y_payload_sub_igual_al_uid", async () => {
  const { public_jwk, private_jwk_base64 } = await generate_test_signing_key();
  const hls_config = make_hls_config(private_jwk_base64);

  const signer = make_thumbnail_url_signer(hls_config);
  const result = await signer.sign(CLOUDFLARE_UID_1);

  const token_segments = result.token.split(".");
  assertEquals(token_segments.length, 3, "el token debe ser un JWT de 3 segmentos");

  const public_key = await importJWK(public_jwk, "RS256");
  const { payload, protectedHeader } = await jwtVerify(result.token, public_key, {
    algorithms: ["RS256"],
  });

  assertEquals(protectedHeader.alg, "RS256", "el header debe declarar alg RS256");
  assertEquals(protectedHeader.kid, TEST_KEY_ID, "el header debe traer el kid de la signing key");
  assertEquals(payload.sub, CLOUDFLARE_UID_1, "el claim sub debe ser el cloudflare_uid firmado");
  assertEquals(payload.kid, TEST_KEY_ID, "el claim kid del payload debe ser la signing key id");
});

Deno.test("exp_del_jwt_respeta_signed_url_ttl_seconds_inyectado", async () => {
  const { public_jwk, private_jwk_base64 } = await generate_test_signing_key();
  const custom_ttl_seconds = 1800; // deliberadamente distinto del default 14400
  const hls_config = make_hls_config(private_jwk_base64, {
    signedUrlTtlSeconds: custom_ttl_seconds,
  });

  const before = Math.floor(Date.now() / 1000);
  const signer = make_thumbnail_url_signer(hls_config);
  const result = await signer.sign(CLOUDFLARE_UID_1);

  const public_key = await importJWK(public_jwk, "RS256");
  const { payload } = await jwtVerify(result.token, public_key, { algorithms: ["RS256"] });

  assertEquals(typeof payload.exp, "number", "el JWT debe traer claim exp numérico");
  const expected_exp = before + custom_ttl_seconds;
  const drift = Math.abs((payload.exp as number) - expected_exp);
  assertEquals(
    drift <= 5,
    true,
    `exp debe ser ~now+signedUrlTtlSeconds (±5s); esperado≈${expected_exp}, recibido=${payload.exp}, drift=${drift}s`,
  );
  assertNotEquals(
    payload.exp,
    before + 14400,
    "exp NO debe usar el default 14400s cuando se inyecta un TTL distinto",
  );
});

Deno.test("distintos_cloudflare_uid_producen_tokens_con_sub_distinto_no_tautologico", async () => {
  const { public_jwk, private_jwk_base64 } = await generate_test_signing_key();
  const hls_config = make_hls_config(private_jwk_base64);
  const signer = make_thumbnail_url_signer(hls_config);

  const result_1 = await signer.sign(CLOUDFLARE_UID_1);
  const result_2 = await signer.sign(CLOUDFLARE_UID_2);

  const public_key = await importJWK(public_jwk, "RS256");
  const { payload: payload_1 } = await jwtVerify(result_1.token, public_key, { algorithms: ["RS256"] });
  const { payload: payload_2 } = await jwtVerify(result_2.token, public_key, { algorithms: ["RS256"] });

  assertEquals(payload_1.sub, CLOUDFLARE_UID_1);
  assertEquals(payload_2.sub, CLOUDFLARE_UID_2);
  assertNotEquals(
    result_1.token,
    result_2.token,
    "dos uids distintos deben producir tokens distintos (verificación no tautológica)",
  );
});

// ── expiresIn ─────────────────────────────────────────────────────────────────

Deno.test("expiresIn_del_resultado_es_exactamente_el_ttl_inyectado", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const custom_ttl_seconds = 7200;
  const hls_config = make_hls_config(private_jwk_base64, {
    signedUrlTtlSeconds: custom_ttl_seconds,
  });

  const signer = make_thumbnail_url_signer(hls_config);
  const result = await signer.sign(CLOUDFLARE_UID_1);

  assertEquals(
    result.expiresIn,
    custom_ttl_seconds,
    "expiresIn debe reflejar exactamente signedUrlTtlSeconds, no un valor hardcodeado",
  );
});

// ── Fail-closed ───────────────────────────────────────────────────────────────

Deno.test("streaming_signing_jwk_invalido_hace_que_sign_lance_sin_devolver_resultado", async () => {
  const invalid_hls_config = make_hls_config("esto-no-es-un-jwk-base64-valido---");
  const signer = make_thumbnail_url_signer(invalid_hls_config);

  await assertRejects(
    () => signer.sign(CLOUDFLARE_UID_1),
    Error,
    undefined,
    "un streamSigningJwk inválido debe hacer que sign() lance (fail-closed) — nunca una URL/token a medias",
  );
});
