/**
 * validation.ts — funciones puras de validación del wizard de anuncios (169.6).
 * Sin fetch ni estado: corren al construir el formulario, en el cliente,
 * ANTES de tocar el servidor.
 *
 * STUB fase RED — sin lógica de negocio. Lanza `not_implemented` para que
 * los tests fallen por aserción/excepción, no por import.
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
 *    Fail-CLOSED en null/undefined/0 — a propósito, DISTINTO del fail-open
 *    de validate_video_duration_ms (property video): el servidor de anuncios
 *    (169.5) es fail-closed ante duración ausente ("sin duration_seconds no
 *    hay forma de verificar el mínimo de 6 s"), así que el cliente debe
 *    hablar el mismo idioma — dar luz verde aquí y que el servidor rechace
 *    después es exactamente el problema que este contrato existe para evitar.
 *
 * 2) CTA — validate_ad_cta. 3 tipos (ad_cta_type: external_url | whatsapp |
 *    phone, migración 20260816000005). El RPC grant_ad_slot_atomic NO
 *    revalida el formato — esta es la ÚNICA capa de formato.
 *    - external_url: solo esquema http/https, case-insensitive, después de
 *      recortar espacios/tabs/newlines de los EXTREMOS y de despojar
 *      caracteres de control (\t \n \r) EMBEBIDOS en cualquier posición —
 *      los mismos que un navegador ignora al parsear un URL, y por eso es
 *      la ruta clásica para colar "java<TAB>script:" más allá de un check
 *      ingenuo que solo hace `startsWith('javascript:')`.
 *    - whatsapp / phone: normaliza IGUAL que la convención de la casa
 *      (mobile/src/features/property-detail/utils/whatsapp.ts:
 *      `phone.replace(/\D/g, '')` — no es un import directo, ese archivo
 *      tiene side-effects de Linking) y exige 10–15 dígitos tras normalizar
 *      (E.164: México local = 10, con lada país 52 = 12, tope internacional
 *      realista = 15).
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
}

// ---------------------------------------------------------------------------
// 1) Duración
// ---------------------------------------------------------------------------

export const AD_MIN_DURATION_SECONDS = 6;
export const AD_MAX_DURATION_SECONDS = 30;
export const AD_DURATION_INVALID = 'AD_DURATION_INVALID';

export function validate_ad_duration_ms(
  _duration_ms: number | null | undefined,
): AdValidationResult {
  throw new Error('not_implemented');
}

// ---------------------------------------------------------------------------
// 2) CTA
// ---------------------------------------------------------------------------

export type AdCtaType = 'external_url' | 'whatsapp' | 'phone';

export const AD_CTA_URL_INVALID = 'AD_CTA_URL_INVALID';
export const AD_CTA_PHONE_INVALID = 'AD_CTA_PHONE_INVALID';

export function validate_ad_cta(
  _cta_type: AdCtaType,
  _cta_value: string | null | undefined,
): AdValidationResult {
  throw new Error('not_implemented');
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
  _zones: AdZoneInput[] | null | undefined,
): AdValidationResult {
  throw new Error('not_implemented');
}
