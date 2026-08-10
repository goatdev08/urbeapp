// supabase/functions/edit-property/location.test.ts
// Tests RED — subtarea 73.6 (Re-revisión por edición, PRD §15.5), hallazgo del
// guardian: `parse_ewkb_point` (location.ts) NO tenía cobertura propia —
// handler.test.ts solo usa fixtures EWKT en AMBOS lados ("SRID=4326;POINT(...)"),
// pero PostgREST (propertyFetcher real en index.ts) SIEMPRE devuelve EWKB hex
// para `location` (geography(Point,4326)). El path que corre en el 100% de las
// ediciones reales (EWKT del cliente vs EWKB hex de la DB) nunca se ejercitaba.
// El guardian probó con mutación real (parse_ewkb_point → null siempre) y la
// suite completa (887 Deno + 831 pgTAP) siguió en verde — cero señal.
//
// SEAM bajo test: la firma pública exportada `location_changed(input, current)`
// de location.ts — el mismo seam que ya usa handler.test.ts, pero aquí con
// fixtures de AMBOS formatos reales (EWKT y EWKB hex), no solo EWKT-vs-EWKT.
//
// Fixtures verificadas contra la DB local (docker exec supabase_db_urbea-app
// psql, 2026-08-09):
//   select ('SRID=4326;POINT(-99.1731 19.3737)'::geography)::text;
//     → 0101000020E610000002BC051214CB58C0E4839ECDAA5F3340  (NDR, con SRID)
//   select ('SRID=4326;POINT(-99.2000 19.4000)'::geography)::text;
//     → 0101000020E6100000CDCCCCCCCCCC58C06666666666663340  (punto DISTINTO)
//   select encode(ST_AsEWKB(('SRID=4326;POINT(-99.1731 19.3737)'::geometry),
//     'XDR'), 'hex');
//     → 0020000001000010e6c058cb141205bc0240335faacd9e83e4  (XDR, mismo punto)
//   select encode(ST_AsEWKB(('SRID=4326;POINT(-99.2000 19.4000)'::geometry),
//     'XDR'), 'hex');
//     → 0020000001000010e6c058cccccccccccd4033666666666666  (XDR, punto distinto)
//
// DECISIÓN DE DISEÑO — XDR (big-endian, prefijo "00"): postgres/PostGIS emite
// NDR por defecto (nunca XDR en el path real de PostgREST), así que en teoría
// estaría fuera de alcance. PERO el código de location.ts YA implementa el
// branch XDR explícitamente (order===0 → little=false, lee con
// DataView(..., false)) — no es un accidente, es soporte deliberado. Se
// decodificó el hex XDR arriba con un script standalone replicando byte a
// byte la lógica del parser y da {lat:19.3737, lng:-99.1731} — CORRECTO, no
// hay bug. Se incluye el test porque el branch existe y está bajo test aquí
// por primera vez (antes: cero cobertura de walquier byte-order).
//
// Framework: Deno.test + @std/assert
// Ejecutar:
//   cd supabase/functions && deno test --allow-env --allow-net --allow-read \
//     --config deno.json edit-property/location.test.ts
//
// ─── EDGE CASES CUBIERTOS ──────────────────────────────────────────────────
// - EWKT (input) vs EWKB hex NDR del MISMO punto (formato real PostgREST) → false
// - EWKT (input) vs EWKB hex NDR de un punto DISTINTO → true
// - EWKT (input) vs EWKB hex XDR (big-endian) del MISMO punto → false (branch
//   XDR soportado deliberadamente, aunque PostGIS no lo emite en el path real)
// - EWKT (input) vs EWKB hex XDR de un punto DISTINTO → true
// - hex con longitud IMPAR → parse falla → fallback a comparación de strings crudos
// - hex con caracteres NO-hex → parse falla → fallback a comparación de strings crudos
// - hex de longitud par pero truncado (header completo, sin bytes de X/Y) →
//   parse falla → fallback a comparación de strings crudos
// - current_location === null (propiedad sin ubicación previa) + input define
//   coordenadas por primera vez → true (cambio real: "sin mapa" → "con mapa";
//   comportamiento intencional, NO un bug — ver nota abajo)
// - current_location === null + input EWKB hex por primera vez → true (mismo
//   caso con el otro formato del lado input)
// - input_location === undefined (contrato ya cubierto en handler.test.ts, se
//   repite aquí a nivel unitario del seam) → false sin evaluar current_location

import { assertEquals } from "@std/assert";
import { location_changed } from "./location.ts";

const EWKT_PUNTO_A = "SRID=4326;POINT(-99.1731 19.3737)";
const EWKB_NDR_PUNTO_A =
  "0101000020E610000002BC051214CB58C0E4839ECDAA5F3340";
const EWKB_NDR_PUNTO_B =
  "0101000020E6100000CDCCCCCCCCCC58C06666666666663340";
const EWKB_XDR_PUNTO_A =
  "0020000001000010e6c058cb141205bc0240335faacd9e83e4";
const EWKB_XDR_PUNTO_B =
  "0020000001000010e6c058cccccccccccd4033666666666666";

Deno.test("location_changed: EWKT vs EWKB hex NDR del mismo punto (formato real PostgREST) → false", () => {
  assertEquals(location_changed(EWKT_PUNTO_A, EWKB_NDR_PUNTO_A), false);
});

Deno.test("location_changed: EWKT vs EWKB hex NDR de punto distinto → true", () => {
  assertEquals(location_changed(EWKT_PUNTO_A, EWKB_NDR_PUNTO_B), true);
});

Deno.test("location_changed: EWKT vs EWKB hex XDR (big-endian) del mismo punto → false", () => {
  assertEquals(location_changed(EWKT_PUNTO_A, EWKB_XDR_PUNTO_A), false);
});

Deno.test("location_changed: EWKT vs EWKB hex XDR de punto distinto → true", () => {
  assertEquals(location_changed(EWKT_PUNTO_A, EWKB_XDR_PUNTO_B), true);
});

Deno.test("location_changed: EWKB hex NDR vs EWKB hex XDR del mismo punto (dos snapshots en distinto byte-order) → false", () => {
  assertEquals(location_changed(EWKB_NDR_PUNTO_A, EWKB_XDR_PUNTO_A), false);
});

Deno.test("location_changed: hex con longitud impar cae a fallback de comparación de strings crudos", () => {
  const hex_impar = EWKB_NDR_PUNTO_A + "0"; // agrega un nibble suelto
  // Ninguno de los dos parsea como EWKT ni como EWKB válido (longitud impar)
  // → location_changed compara los strings crudos tal cual: son distintos
  // entre sí, así que el fallback debe reportar cambio.
  assertEquals(location_changed(hex_impar, EWKB_NDR_PUNTO_A), true);
  // Fallback también aplica si AMBOS lados son el mismo string corrupto:
  // comparación de strings crudos con valores idénticos → sin cambio.
  assertEquals(location_changed(hex_impar, hex_impar), false);
});

Deno.test("location_changed: hex con caracteres no-hex cae a fallback de comparación de strings crudos", () => {
  const basura_no_hex = "no-es-hex-ni-ewkt-zzz";
  assertEquals(location_changed(basura_no_hex, EWKB_NDR_PUNTO_A), true);
});

Deno.test("location_changed: hex de longitud par pero truncado (sin bytes de X/Y) cae a fallback de comparación de strings crudos", () => {
  // Header NDR completo con SRID (order + type + srid = 9 bytes = 18 hex
  // chars) pero SIN los 16 bytes de X/Y — longitud par, hex válido, pero
  // parse_ewkb_point debe rechazarlo por incompleto (bytes.length < offset+16).
  const hex_truncado = "0101000020E6100000";
  assertEquals(location_changed(hex_truncado, EWKB_NDR_PUNTO_A), true);
});

Deno.test("location_changed: current_location null (sin ubicación previa) + input define coordenadas por primera vez → true", () => {
  // Comportamiento intencional, no un bug: pasar de "sin mapa" a "con mapa"
  // ES un cambio real de la unidad dirección/coordenadas (PRD §15.5) y debe
  // disparar re-revisión igual que cualquier otro cambio de location.
  assertEquals(location_changed(EWKT_PUNTO_A, null), true);
});

Deno.test("location_changed: current_location null + input en formato EWKB hex por primera vez → true", () => {
  assertEquals(location_changed(EWKB_NDR_PUNTO_A, null), true);
});

Deno.test("location_changed: input_location undefined (usuario no tocó el mapa) → false sin evaluar current_location, incluso si current es corrupto", () => {
  assertEquals(location_changed(undefined, "esto-ni-siquiera-importa"), false);
});
