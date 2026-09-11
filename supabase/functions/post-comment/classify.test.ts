// supabase/functions/post-comment/classify.test.ts
// Tests RED — subtarea 289.5 (tarea #289, PRD filtro determinista mínimo de comentarios).
// Framework: Deno.test + @std/assert
// Runner: deno test --allow-env --allow-net supabase/functions/post-comment/classify.test.ts
//
// SEAM bajo test: la función PURA exportada `classify_comment(body, words)` —
// sin dependencias, sin I/O, contrato entrada→salida. classify.ts es un STUB que
// SIEMPRE LANZA `not_implemented` en fase RED: cada caso de abajo falla por la
// excepción no atrapada (no por import ni por tipos).
//
// EDGE CASES (RED) — 289.5:
//
// ### Happy path
// - HP1: texto limpio, sin lista de palabras → 'visible'
// - HP2: texto limpio, con lista de palabras (que no matchea) → 'visible'
//
// ### Teléfono (≥8 dígitos, separadores espacio/guion/punto/paréntesis/+)
// - TEL1: "33 1234 5678" (espacios) → held_for_review
// - TEL2: "+52 1 33 1234 5678" (prefijo internacional) → held_for_review
// - TEL3: "3312345678" (pegado, 10 dígitos) → held_for_review
// - TEL4: "33-12-34-56-78" (guiones) → held_for_review
// - TEL5: "(33) 1234 5678" (paréntesis) → held_for_review
//
// ### Falsos positivos de teléfono (documentados en el PRD/plan, NO deben matchear)
// - FP1: "depa 5B, muy amplio" → visible
// - FP2: "2 recámaras y 3 baños" → visible
// - FP3: "vive en el piso 12" → visible
// - FP4: "precio $2,500,000 negociable" → visible (comas rompen la corrida de dígitos;
//   cada grupo separado por coma tiene <8 dígitos)
// - FP5: "2026 es un buen año para comprar" → visible (4 dígitos, año)
// - FP6: "código postal 44100" → visible (5 dígitos)
//
// ### Boundary del umbral de teléfono (exactamente 8 = el mínimo)
// - TELB1: "2500000" (7 dígitos pegados) → visible (por debajo del umbral)
// - TELB2: "25000000" (8 dígitos pegados) → held_for_review (justo el umbral)
//
// ### Email
// - EMAIL1: "escríbeme a alguien@dominio.com por favor" → held_for_review
// - EMAIL2: "sin arroba no es correo, aunque diga dominio.com" → held_for_review
//   (dominio.com SÍ matchea por la regla de URL/dominio — ver URL4; este caso
//   documenta que "parece email pero no lo es" igual cae por la rama de dominio)
// - EMAIL3: "hola @usuario mencionado, no es correo" → visible (arroba sin dominio detrás)
//
// ### URL / dominio (http://, https://, www., dominio.tld con TLD conocido)
// - URL1: "http://ejemplo.com" → held_for_review
// - URL2: "https://ejemplo.mx/propiedad/123" → held_for_review
// - URL3: "www.miweb.io" → held_for_review
// - URL4: "visita misitio.net para más fotos" → held_for_review
//
// ### Falsos positivos de URL/dominio
// - FPURL1: "p. ej. son 3 recámaras" → visible
// - FPURL2: "ok. perfecto, nos vemos" → visible
// - FPURL3: "mide 5.5 m2 el balcón" → visible
//
// ### Lista de palabras (comment_filter_words, jsonb array de strings)
// - WORD1: words=["estafa"], body="esto es una estafa" → held_for_review
// - WORD2: words=["ESTAFA"] (mayúsculas en la lista), body="es una estafa" →
//   held_for_review (comparación case-insensitive)
// - WORD3: words=["pago"], body="el empapelado quedó bonito" → visible
//   (palabra completa: "pago" NO matchea como substring de "empapelado")
// - WORD4: words=["línea"] (con acento en la lista), body="por linea directa"
//   (sin acento en el texto) → held_for_review (comparación sin acentos)
// - WORD5: words=[] (lista vacía), body="estafa" → visible (sin lista, el
//   filtro base no reconoce "estafa" como teléfono/email/URL)
// - WORD6: words=["estafa","estafa"] (duplicados) → held_for_review, sin lanzar
//
// ### Combinación de reglas
// - COMBO1: body con teléfono Y palabra prohibida → held_for_review (basta una)
//
// ### Boundary / totalidad de la función
// - TOTAL1: body="" (vacío), words=[] → 'visible' (la función es total: no lanza
//   ni asume que el handler ya filtró vacíos — la validación de \S vive en el handler)

import { assertEquals } from "@std/assert";
import { classify_comment } from "./classify.ts";

// ── Happy path ─────────────────────────────────────────────────────────────────

Deno.test("HP1_texto_limpio_sin_lista_de_palabras_es_visible", () => {
  const result = classify_comment("Me encanta esta propiedad, muy bien ubicada", []);
  assertEquals(result, "visible");
});

Deno.test("HP2_texto_limpio_con_lista_que_no_matchea_es_visible", () => {
  const result = classify_comment("Excelente ubicación cerca del parque", ["fraude"]);
  assertEquals(result, "visible");
});

// ── Teléfono ───────────────────────────────────────────────────────────────────

Deno.test("TEL1_telefono_con_espacios_va_a_revision", () => {
  const result = classify_comment("Llámame al 33 1234 5678", []);
  assertEquals(result, "held_for_review");
});

Deno.test("TEL2_telefono_con_prefijo_internacional_va_a_revision", () => {
  const result = classify_comment("Contáctame +52 1 33 1234 5678", []);
  assertEquals(result, "held_for_review");
});

Deno.test("TEL3_telefono_pegado_va_a_revision", () => {
  const result = classify_comment("Mi número es 3312345678", []);
  assertEquals(result, "held_for_review");
});

Deno.test("TEL4_telefono_con_guiones_va_a_revision", () => {
  const result = classify_comment("Marca al 33-12-34-56-78", []);
  assertEquals(result, "held_for_review");
});

Deno.test("TEL5_telefono_con_parentesis_va_a_revision", () => {
  const result = classify_comment("Oficina: (33) 1234 5678", []);
  assertEquals(result, "held_for_review");
});

// ── Falsos positivos de teléfono ─────────────────────────────────────────────────

Deno.test("FP1_depa_5B_no_es_telefono_es_visible", () => {
  const result = classify_comment("depa 5B, muy amplio y con vista", []);
  assertEquals(result, "visible");
});

Deno.test("FP2_recamaras_y_banos_no_es_telefono_es_visible", () => {
  const result = classify_comment("tiene 2 recámaras y 3 baños", []);
  assertEquals(result, "visible");
});

Deno.test("FP3_piso_no_es_telefono_es_visible", () => {
  const result = classify_comment("vive en el piso 12", []);
  assertEquals(result, "visible");
});

Deno.test("FP4_precio_con_comas_no_es_telefono_es_visible", () => {
  const result = classify_comment("precio $2,500,000 negociable", []);
  assertEquals(result, "visible");
});

Deno.test("FP5_anio_no_es_telefono_es_visible", () => {
  const result = classify_comment("2026 es un buen año para comprar", []);
  assertEquals(result, "visible");
});

Deno.test("FP6_codigo_postal_no_es_telefono_es_visible", () => {
  const result = classify_comment("código postal 44100", []);
  assertEquals(result, "visible");
});

// ── Boundary del umbral (8 dígitos) ──────────────────────────────────────────────

Deno.test("TELB1_siete_digitos_pegados_bajo_el_umbral_es_visible", () => {
  const result = classify_comment("el modelo es 2500000", []);
  assertEquals(result, "visible");
});

Deno.test("TELB2_ocho_digitos_pegados_en_el_umbral_va_a_revision", () => {
  const result = classify_comment("el modelo es 25000000", []);
  assertEquals(result, "held_for_review");
});

// ── Email ────────────────────────────────────────────────────────────────────────

Deno.test("EMAIL1_direccion_de_correo_va_a_revision", () => {
  const result = classify_comment("escríbeme a alguien@dominio.com por favor", []);
  assertEquals(result, "held_for_review");
});

Deno.test("EMAIL2_dominio_sin_arroba_tambien_va_a_revision_por_regla_de_url", () => {
  const result = classify_comment("sin arroba no es correo, aunque diga dominio.com", []);
  assertEquals(result, "held_for_review");
});

Deno.test("EMAIL3_arroba_sin_dominio_detras_es_visible", () => {
  const result = classify_comment("hola @usuario mencionado, no es correo", []);
  assertEquals(result, "visible");
});

// ── URL / dominio ──────────────────────────────────────────────────────────────

Deno.test("URL1_http_va_a_revision", () => {
  const result = classify_comment("visita http://ejemplo.com", []);
  assertEquals(result, "held_for_review");
});

Deno.test("URL2_https_con_ruta_va_a_revision", () => {
  const result = classify_comment("más info en https://ejemplo.mx/propiedad/123", []);
  assertEquals(result, "held_for_review");
});

Deno.test("URL3_www_va_a_revision", () => {
  const result = classify_comment("checa www.miweb.io", []);
  assertEquals(result, "held_for_review");
});

Deno.test("URL4_dominio_con_tld_conocido_va_a_revision", () => {
  const result = classify_comment("visita misitio.net para más fotos", []);
  assertEquals(result, "held_for_review");
});

// ── Falsos positivos de URL/dominio ──────────────────────────────────────────────

Deno.test("FPURL1_abreviatura_p_ej_no_es_dominio_es_visible", () => {
  const result = classify_comment("p. ej. son 3 recámaras", []);
  assertEquals(result, "visible");
});

Deno.test("FPURL2_abreviatura_ok_no_es_dominio_es_visible", () => {
  const result = classify_comment("ok. perfecto, nos vemos", []);
  assertEquals(result, "visible");
});

Deno.test("FPURL3_medida_decimal_no_es_dominio_es_visible", () => {
  const result = classify_comment("mide 5.5 m2 el balcón", []);
  assertEquals(result, "visible");
});

// ── Lista de palabras ────────────────────────────────────────────────────────────

Deno.test("WORD1_palabra_de_la_lista_va_a_revision", () => {
  const result = classify_comment("esto es una estafa", ["estafa"]);
  assertEquals(result, "held_for_review");
});

Deno.test("WORD2_comparacion_case_insensitive", () => {
  const result = classify_comment("es una estafa total", ["ESTAFA"]);
  assertEquals(result, "held_for_review");
});

Deno.test("WORD3_palabra_completa_no_matchea_substring", () => {
  const result = classify_comment("el empapelado quedó bonito", ["pago"]);
  assertEquals(result, "visible");
});

Deno.test("WORD4_comparacion_sin_acentos", () => {
  const result = classify_comment("por linea directa me contactas", ["línea"]);
  assertEquals(result, "held_for_review");
});

Deno.test("WORD5_lista_vacia_no_reconoce_la_palabra", () => {
  const result = classify_comment("estafa", []);
  assertEquals(result, "visible");
});

Deno.test("WORD6_palabras_duplicadas_en_la_lista_no_lanza", () => {
  const result = classify_comment("es una estafa", ["estafa", "estafa"]);
  assertEquals(result, "held_for_review");
});

// ── Combinación de reglas ─────────────────────────────────────────────────────────

Deno.test("COMBO1_telefono_y_palabra_prohibida_basta_una_para_ir_a_revision", () => {
  const result = classify_comment("es una estafa, márcame al 33 1234 5678", ["estafa"]);
  assertEquals(result, "held_for_review");
});

// ── Boundary / totalidad de la función ───────────────────────────────────────────

Deno.test("TOTAL1_body_vacio_no_lanza_y_es_visible", () => {
  const result = classify_comment("", []);
  assertEquals(result, "visible");
});
