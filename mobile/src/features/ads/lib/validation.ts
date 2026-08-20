/**
 * validation.ts — funciones puras de validación del wizard de anuncios (169.6).
 * Sin fetch ni estado: corren al construir el formulario, en el cliente,
 * ANTES de tocar el servidor.
 *
 * Contrato fijado por el test-author (169.6):
 *
 * 1) Duración — validate_ad_duration_ms. Rango 6–30 s INCLUSIVE, MISMO
 *    código AD_DURATION_INVALID que usa el servidor
 *    (supabase/functions/stream-webhook/types.ts, subtarea 169.5) — mismo
 *    problema, mismo mensaje para el usuario sin importar dónde se detecte.
 *    🔴 Aprendizaje directo de 169.5: el servidor valida la duración CRUDA
 *    fraccionaria y redondea DESPUÉS — nunca al revés (un video de 5.7 s
 *    redondeado a 6 se colaría). Aquí duration_ms ya trae precisión de
 *    milisegundos (mismo shape que asset.duration en
 *    publish/validation.ts::validate_video_duration_ms) — la implementación
 *    NUNCA debe redondear los segundos antes de comparar contra el rango.
 *    🔴 Fail-OPEN en null/undefined/0 desde #189 — IGUAL que
 *    validate_video_duration_ms (property video), no distinto. La versión
 *    anterior fail-closed se justificó como "paridad con el servidor"; era
 *    paridad formal, no semántica. El `null` del servidor significa
 *    "Cloudflare decodificó el archivo y no pudo determinar la duración"
 *    (archivo roto); el de aquí significa "este picker de Android no lee
 *    metadata" (rasgo del dispositivo, no dice nada del archivo). Tratarlos
 *    igual bloqueaba PERMANENTEMENTE a quien tuviera un picker viejo: en el
 *    mismo teléfono podía publicar una propiedad pero jamás un anuncio.
 *    El literal AD_DURATION_INVALID NO cambió — la coherencia
 *    cliente-servidor de 169.6 sigue intacta; lo que cambió es CUÁNDO se
 *    emite.
 *
 * 2) CTA — validate_ad_cta. 3 tipos (ad_cta_type: external_url | whatsapp |
 *    phone, migración 20260816000005). El RPC grant_ad_slot_atomic NO
 *    revalida el formato — esta es la ÚNICA capa de formato, así que
 *    AdValidationResult trae `normalized_value`: el valor YA LIMPIO que el
 *    wizard debe persistir (null si inválido). Se valida y se guarda LA
 *    MISMA cadena — nunca una versión saneada que el llamador nunca ve.
 *    - external_url: solo esquema http/https, case-insensitive, con host no
 *      vacío ("https://" solo no es un CTA que abra nada), después de
 *      recortar espacios de los EXTREMOS únicamente (`trim()`).
 *      🔴 NO se despojan \t\n\r embebidos: bajo una allowlist de esquema eso
 *      solo AMPLÍA lo que se acepta (nunca lo que se rechaza) — "java\tscript:"
 *      de todos modos no matchea `^https?:\/\//i`, y despojar el tab de
 *      "htt\tps://x" lo colaría como si fuera "https://x" válido pese a que
 *      la cadena guardada seguiría trayendo el tab. normalized_value = el
 *      valor trimmeado, exactamente lo que se validó.
 *    - whatsapp / phone: normaliza IGUAL que la convención de la casa
 *      (mobile/src/features/property-detail/utils/whatsapp.ts:
 *      `phone.replace(/\D/g, '')` — no es un import directo, ese archivo
 *      tiene side-effects de Linking) y exige 10–15 dígitos tras normalizar
 *      (E.164: México local = 10, con lada país 52 = 12, tope internacional
 *      realista = 15). normalized_value = los dígitos ya normalizados, para
 *      que el wizard no repita la normalización.
 *
 * 3) Zonas — validate_ad_zones. Cada entrada de ad_zones es municipio XOR
 *    colonia (CHECK ad_zones_exactly_one_scope, migración 20260816000005).
 *    🔴 Lista VACÍA (y null/undefined) es VÁLIDA — significa inventario
 *    NACIONAL (D3 de 169.1), no un error de formulario. Confirmado en el
 *    propio RPC (20260816000007_grant_ad_slot_rpc.sql): "p_zones NULL o '[]'
 *    -> jsonb_array_elements no itera -> 0 filas en ad_zones -> inventario
 *    NACIONAL". Validar esa lista como error rompería el modelo de venta.
 */

// ---------------------------------------------------------------------------
// Shape común — código de error explícito (no solo boolean) para que la UI
// mapee código→mensaje en un solo lugar y el guardian compare códigos
// exactos, no substrings de un mensaje en español.
// ---------------------------------------------------------------------------

export interface AdValidationResult {
  valid: boolean;
  error_code: string | null;
  // El valor YA LIMPIO que hay que persistir cuando valid=true (null si
  // inválido). Solo tiene sentido para validate_ad_cta (trim de URL, dígitos
  // normalizados de teléfono) — duration/zones lo dejan siempre en null.
  normalized_value: string | null;
}

// ---------------------------------------------------------------------------
// 1) Duración
// ---------------------------------------------------------------------------

export const AD_MIN_DURATION_SECONDS = 6;
export const AD_MAX_DURATION_SECONDS = 30;
export const AD_DURATION_INVALID = 'AD_DURATION_INVALID';

export function validate_ad_duration_ms(
  duration_ms: number | null | undefined,
): AdValidationResult {
  // 🔴 #189 — FAIL-OPEN ante duración DESCONOCIDA (null/undefined/0), espejo
  // exacto de publish/validation.ts:157-161. Antes era fail-closed,
  // justificado como "paridad con el servidor"; la paridad era formal, no
  // semántica: los dos `null` significan cosas distintas. El del servidor
  // (stream-webhook) es "Cloudflare decodificó el archivo y no pudo
  // determinar la duración" — archivo roto de verdad. El de aquí es "este
  // picker de Android no lee metadata" — un rasgo del dispositivo que no dice
  // nada del archivo. Tratarlos igual dejaba a esa persona sin ruta: en el
  // MISMO teléfono podía publicar una propiedad pero jamás un anuncio.
  // El servidor sigue validando con la duración REAL que reporta Stream, y
  // desde #189 persiste la razón, así que un rechazo tardío produce el
  // mensaje correcto y no el de transcodificación.
  if (!duration_ms) {
    return { valid: true, error_code: null, normalized_value: null };
  }

  // 🔴 Compara sobre el valor CRUDO fraccionario (nunca Math.round antes de
  // comparar) — 5.7 s no debe redondear a 6 y colarse. Ver 169.5.
  const duration_seconds = duration_ms / 1000;
  const valid =
    duration_seconds >= AD_MIN_DURATION_SECONDS &&
    duration_seconds <= AD_MAX_DURATION_SECONDS;

  return valid
    ? { valid: true, error_code: null, normalized_value: null }
    : { valid: false, error_code: AD_DURATION_INVALID, normalized_value: null };
}

// ---------------------------------------------------------------------------
// 2) CTA
// ---------------------------------------------------------------------------

export type AdCtaType = 'external_url' | 'whatsapp' | 'phone';

export const AD_CTA_URL_INVALID = 'AD_CTA_URL_INVALID';
export const AD_CTA_PHONE_INVALID = 'AD_CTA_PHONE_INVALID';

const AD_CTA_URL_SCHEME = /^https?:\/\//i;

function validate_ad_cta_url(cta_value: string | null | undefined): AdValidationResult {
  if (!cta_value) return { valid: false, error_code: AD_CTA_URL_INVALID, normalized_value: null };

  // ponytail: allowlist de esquema (http/https) en vez de blocklist de
  // esquemas peligrosos (javascript:, data:, ...) — más simple y más seguro,
  // porque no depende de enumerar cada esquema malicioso posible.
  // Se valida y se guarda LA MISMA cadena: solo se recortan los extremos
  // (trim). 🔴 NO se despojan \t\n\r embebidos — bajo una allowlist eso solo
  // AMPLÍA lo aceptado (nunca lo rechazado), y coló "htt\tps://x" como si
  // fuera "https://x" pese a que lo guardado seguía trayendo el tab.
  const trimmed = cta_value.trim();
  const scheme_match = AD_CTA_URL_SCHEME.exec(trimmed);
  // Host vacío ("https://" a secas) es un CTA que no abre nada.
  const has_host = scheme_match !== null && trimmed.length > scheme_match[0].length;

  return has_host
    ? { valid: true, error_code: null, normalized_value: trimmed }
    : { valid: false, error_code: AD_CTA_URL_INVALID, normalized_value: null };
}

function validate_ad_cta_phone(cta_value: string | null | undefined): AdValidationResult {
  if (!cta_value) {
    return { valid: false, error_code: AD_CTA_PHONE_INVALID, normalized_value: null };
  }

  // Misma convención de normalización que
  // mobile/src/features/property-detail/utils/whatsapp.ts (no es import
  // directo: ese archivo tiene side-effects de Linking).
  const digits = cta_value.replace(/\D/g, '');
  const valid = digits.length >= 10 && digits.length <= 15;

  return valid
    ? { valid: true, error_code: null, normalized_value: digits }
    : { valid: false, error_code: AD_CTA_PHONE_INVALID, normalized_value: null };
}

export function validate_ad_cta(
  cta_type: AdCtaType,
  cta_value: string | null | undefined,
): AdValidationResult {
  return cta_type === 'external_url'
    ? validate_ad_cta_url(cta_value)
    : validate_ad_cta_phone(cta_value);
}

// ---------------------------------------------------------------------------
// 3) Zonas — municipality_id es text (cvegeo), neighborhood_id es bigint
//    (mx_neighborhoods.id), espejo exacto de ad_zones (20260816000005).
// ---------------------------------------------------------------------------

export interface AdZoneInput {
  municipality_id: string | null;
  neighborhood_id: number | null;
}

export const AD_ZONE_INVALID = 'AD_ZONE_INVALID';

export function validate_ad_zones(
  zones: AdZoneInput[] | null | undefined,
): AdValidationResult {
  // null/undefined/[] son VÁLIDAS — significan inventario nacional (D3 de
  // 169.1). Ver comentario de contrato arriba.
  if (!zones || zones.length === 0) {
    return { valid: true, error_code: null, normalized_value: null };
  }

  // XOR estricto por fila (espejo del CHECK ad_zones_exactly_one_scope): una
  // sola fila inválida invalida la lista completa.
  const all_valid = zones.every(
    (zone) => (zone.municipality_id !== null) !== (zone.neighborhood_id !== null),
  );

  return all_valid
    ? { valid: true, error_code: null, normalized_value: null }
    : { valid: false, error_code: AD_ZONE_INVALID, normalized_value: null };
}
