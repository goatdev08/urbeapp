/**
 * validation.test.ts — fase RED de la subtarea 169.6.
 * SEAM bajo test: la firma pública de mobile/src/features/ads/lib/validation.ts
 * (validate_ad_duration_ms, validate_ad_cta, validate_ad_zones) — funciones
 * puras, sin fetch ni estado.
 *
 * Fuentes independientes de los valores esperados (nunca recomputados igual
 * que la implementación):
 *   - AD_DURATION_INVALID / rango 6–30 s: supabase/functions/stream-webhook/
 *     types.ts (AD_DURATION_INVALID, AD_MIN/MAX_DURATION_SECONDS, subtarea
 *     169.5) — el MISMO código debe salir del cliente y del servidor.
 *   - ad_cta_type (external_url | whatsapp | phone) y ad_zones (XOR
 *     municipio/colonia, lista vacía = nacional): migración
 *     20260816000005_ads_schema.sql + 20260816000007_grant_ad_slot_rpc.sql
 *     ("p_zones NULL o '[]'" -> inventario nacional, D3 de 169.1).
 *   - Normalización de teléfono: convención de la casa en
 *     mobile/src/features/property-detail/utils/whatsapp.ts
 *     (`phone.replace(/\D/g, '')`).
 *
 * ── Arbitraje del guardián (ronda 2, mismo día) ─────────────────────────────
 * 1) Los `toBe(AD_..._INVALID)` comparaban el resultado contra la MISMA
 *    constante importada del SUT — consistencia interna, no el valor del
 *    literal (el guardián renombró AD_DURATION_INVALID a 'AD_BAD_DURATION' y
 *    la suite siguió en verde). Se ancla cada literal contra su string crudo.
 * 2) `validate_ad_cta` gana un contrato nuevo: `normalized_value: string |
 *    null` — el valor YA LIMPIO que el wizard debe persistir (trim para URL,
 *    solo-dígitos para whatsapp/phone), null si inválido. El campo AÚN NO
 *    EXISTE en `AdValidationResult` (types.ts de producción) — ese es el
 *    hueco que el GREEN cierra. Mismo patrón que
 *    publish/__tests__/validation.test.ts con `price_visible`: extensión
 *    LOCAL de tipo con `&`, sin tocar el tipo de producción en RED.
 *    Consecuencia del contrato nuevo: el `.replace(/[\t\n\r]/g, '')` interno
 *    debe DESAPARECER — bajo una allowlist, despojar caracteres de control
 *    solo AMPLÍA lo que se acepta (nunca lo que se rechaza) y hace que se
 *    valide una cadena distinta de la que se guardaría.
 */

import {
  AD_CTA_PHONE_INVALID,
  AD_CTA_URL_INVALID,
  AD_DURATION_INVALID,
  AD_MAX_DURATION_SECONDS,
  AD_MIN_DURATION_SECONDS,
  AD_ZONE_INVALID,
  validate_ad_cta,
  validate_ad_duration_ms,
  validate_ad_zones,
  type AdCtaType,
  type AdValidationResult,
  type AdZoneInput,
} from '@/features/ads/lib/validation';

// ---------------------------------------------------------------------------
// NOTA DE TIPOS (RED): `normalized_value` aún no existe en `AdValidationResult`
// de producción — extensión LOCAL de tipo (mismo patrón que
// publish/__tests__/validation.test.ts con `price_visible`), para no tocar el
// tipo de producción en fase RED. `cta()` es el único punto de la suite que
// hace el cast, así los `it` de abajo se leen como si el campo ya existiera.
// ---------------------------------------------------------------------------

type AdCtaResultWithNormalized = AdValidationResult & { normalized_value: string | null };

function cta(
  cta_type: AdCtaType,
  cta_value: string | null | undefined,
): AdCtaResultWithNormalized {
  return validate_ad_cta(cta_type, cta_value) as AdCtaResultWithNormalized;
}

// ===========================================================================
// Constantes — el rango debe ser exactamente 10..120 s (fuente independiente:
// AD_MIN/MAX_DURATION_SECONDS del servidor, stream-webhook/types.ts).
// ===========================================================================

describe('constantes de duración', () => {
  it('el rango es 10-120 s, espejo del servidor y de propiedades (#228)', () => {
    expect(AD_MIN_DURATION_SECONDS).toBe(10);
    expect(AD_MAX_DURATION_SECONDS).toBe(120);
  });

  it('#228 PARIDAD POR CONSTRUCCIÓN: el rango de anuncios ES el de propiedades, no un espejo a mano', () => {
    // Decisión de producto 2026-08-31: mismos límites que el wizard de
    // publicación normal. Si publish/validation.ts cambia su rango, el de
    // anuncios lo sigue — este test truena si alguien los vuelve a separar.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const publish = require('@/features/publish/validation') as {
      MIN_VIDEO_DURATION_SECONDS: number;
      MAX_VIDEO_DURATION_SECONDS: number;
    };
    expect(AD_MIN_DURATION_SECONDS).toBe(publish.MIN_VIDEO_DURATION_SECONDS);
    expect(AD_MAX_DURATION_SECONDS).toBe(publish.MAX_VIDEO_DURATION_SECONDS);
  });

  it('AD_DURATION_INVALID es el literal EXACTO del servidor (stream-webhook/types.ts:106), no solo consistente consigo mismo', () => {
    // 🔴 Ancla el STRING crudo, no la constante importada — comparar contra
    // AD_DURATION_INVALID (importada del propio SUT) solo prueba consistencia
    // interna: renombrar la constante en el SUT dejaría este test en verde
    // pese a que el código real ya no coincide con el del servidor.
    expect(AD_DURATION_INVALID).toBe('AD_DURATION_INVALID');
  });
});

describe('constantes de códigos de error del CTA/zonas (propios del cliente, sin contraparte en servidor)', () => {
  it('los tres literales son estables — un rename silencioso del SUT debe reventar aquí', () => {
    expect(AD_CTA_URL_INVALID).toBe('AD_CTA_URL_INVALID');
    expect(AD_CTA_PHONE_INVALID).toBe('AD_CTA_PHONE_INVALID');
    expect(AD_ZONE_INVALID).toBe('AD_ZONE_INVALID');
  });
});

// ===========================================================================
// validate_ad_duration_ms — fronteras 9.9 / 10 / 120 / 120.1 explícitas.
// ===========================================================================

describe('validate_ad_duration_ms', () => {
  it('acepta 10.0 s exactos (frontera inclusiva inferior)', () => {
    const result = validate_ad_duration_ms(10_000);

    expect(result.valid).toBe(true);
    expect(result.error_code).toBeNull();
  });

  it('acepta 120.0 s exactos (frontera inclusiva superior)', () => {
    const result = validate_ad_duration_ms(120_000);

    expect(result.valid).toBe(true);
    expect(result.error_code).toBeNull();
  });

  it('acepta 60 s (caso típico dentro del rango)', () => {
    expect(validate_ad_duration_ms(60_000).valid).toBe(true);
  });

  it('rechaza 9.9 s con AD_DURATION_INVALID (justo debajo del mínimo)', () => {
    const result = validate_ad_duration_ms(9_900);

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_DURATION_INVALID);
  });

  it('rechaza 120.1 s con AD_DURATION_INVALID (justo arriba del máximo)', () => {
    const result = validate_ad_duration_ms(120_100);

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_DURATION_INVALID);
  });

  it('rechaza 9.7 s — el hueco exacto que un redondeo-antes-de-comparar dejaría pasar (169.5)', () => {
    // 9.7 redondeado da 10 (que SÍ sería válido). Este caso solo falla si la
    // implementación compara sobre el valor crudo fraccionario, nunca sobre
    // Math.round(seconds) — exactamente el mutante que coló 169.5.
    const result = validate_ad_duration_ms(9_700);

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_DURATION_INVALID);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // RED #189 — DURACIÓN DESCONOCIDA PASA (fail-open), espejo de propiedades.
  //
  // Antes esto era fail-closed, justificado como "paridad con el servidor".
  // La paridad era formal, no semántica: los dos `null` significan cosas
  // distintas. El del servidor (stream-webhook/handler.ts) es "Cloudflare
  // demuxeó el archivo y no pudo determinar la duración" — archivo roto de
  // verdad. El del cliente es "este picker de Android no lee metadata" — un
  // rasgo del dispositivo que no dice NADA del archivo.
  //
  // Consecuencia del fail-closed: en el MISMO teléfono, la persona podía
  // publicar una propiedad (validation.ts:141-143 es fail-open y documenta
  // "pickers Android viejos") pero jamás un anuncio, sin ruta de escape y con
  // un mensaje que decía "duración inválida" cuando el problema era que no
  // había duración.
  //
  // 🔴 El literal AD_DURATION_INVALID NO cambia: la coherencia cliente-servidor
  // anclada en 169.6 es lo que impide que el mismo problema produzca dos
  // mensajes distintos. Lo que cambia es CUÁNDO se emite.
  // ─────────────────────────────────────────────────────────────────────────

  it('#189 acepta duración null — fail-OPEN: el picker no la reporta, el servidor revalida con la duración real de Stream', () => {
    const result = validate_ad_duration_ms(null);

    expect(result.valid).toBe(true);
    expect(result.error_code).toBeNull();
  });

  it('#189 acepta duración undefined — fail-OPEN, mismo motivo', () => {
    const result = validate_ad_duration_ms(undefined);

    expect(result.valid).toBe(true);
    expect(result.error_code).toBeNull();
  });

  it('#189 acepta 0 ms — fail-OPEN: 0 es el marcador de "desconocida" de los pickers viejos, igual que en propiedades', () => {
    const result = validate_ad_duration_ms(0);

    expect(result.valid).toBe(true);
    expect(result.error_code).toBeNull();
  });

  it('#189 CASO PAREADO: fail-open aplica SOLO a la duración ausente — una duración conocida fuera de rango sigue rechazándose', () => {
    expect(validate_ad_duration_ms(9_900).valid).toBe(false);
    expect(validate_ad_duration_ms(120_100).valid).toBe(false);
    expect(validate_ad_duration_ms(1).valid).toBe(false);
  });

  it('rechaza una duración negativa', () => {
    const result = validate_ad_duration_ms(-1_000);

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_DURATION_INVALID);
  });
});

// ===========================================================================
// validate_ad_cta — external_url (solo http/https, rechaza javascript:/data:
// y variantes evasivas), whatsapp/phone (normalización de la casa, 10-15
// dígitos).
// ===========================================================================

describe('validate_ad_cta — external_url', () => {
  it('acepta una URL https simple', () => {
    const result = validate_ad_cta('external_url', 'https://ejemplo.com/promo');

    expect(result.valid).toBe(true);
    expect(result.error_code).toBeNull();
  });

  it('acepta una URL http simple (no solo https)', () => {
    expect(validate_ad_cta('external_url', 'http://ejemplo.com').valid).toBe(true);
  });

  it('acepta el esquema en mayúsculas mezcladas ("HtTpS://") — el check es case-insensitive', () => {
    const result = validate_ad_cta('external_url', 'HtTpS://ejemplo.com/promo');

    expect(result.valid).toBe(true);
  });

  it('acepta una URL con espacio inicial (se recorta antes de validar)', () => {
    const result = validate_ad_cta('external_url', '  https://ejemplo.com/promo');

    expect(result.valid).toBe(true);
  });

  it('rechaza "javascript:alert(1)" con AD_CTA_URL_INVALID — no es un formato feo, es inyección', () => {
    const result = validate_ad_cta('external_url', 'javascript:alert(1)');

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_CTA_URL_INVALID);
  });

  it('rechaza "JavaScript:alert(1)" (mayúsculas evasivas)', () => {
    const result = validate_ad_cta('external_url', 'JavaScript:alert(1)');

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_CTA_URL_INVALID);
  });

  it('rechaza " javascript:alert(1)" (espacio al inicio como evasión — startsWith ingenuo lo dejaría pasar)', () => {
    const result = validate_ad_cta('external_url', ' javascript:alert(1)');

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_CTA_URL_INVALID);
  });

  it('rechaza "java\\tscript:alert(1)" (tab embebido — los navegadores lo ignoran al parsear, misma vía de bypass)', () => {
    const result = validate_ad_cta('external_url', 'java\tscript:alert(1)');

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_CTA_URL_INVALID);
  });

  it('rechaza "java\\nscript:alert(1)" (newline embebido, misma vía de bypass)', () => {
    const result = validate_ad_cta('external_url', 'java\nscript:alert(1)');

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_CTA_URL_INVALID);
  });

  it('rechaza "data:text/html;base64,PHNjcmlwdD4=" con AD_CTA_URL_INVALID', () => {
    const result = validate_ad_cta('external_url', 'data:text/html;base64,PHNjcmlwdD4=');

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_CTA_URL_INVALID);
  });

  it('rechaza una URL sin esquema explícito ("ejemplo.com")', () => {
    const result = validate_ad_cta('external_url', 'ejemplo.com');

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_CTA_URL_INVALID);
  });

  it('rechaza un esquema distinto de http/https ("ftp://ejemplo.com")', () => {
    const result = validate_ad_cta('external_url', 'ftp://ejemplo.com');

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_CTA_URL_INVALID);
  });

  it('rechaza null/undefined/vacío con AD_CTA_URL_INVALID', () => {
    expect(validate_ad_cta('external_url', null).error_code).toBe(AD_CTA_URL_INVALID);
    expect(validate_ad_cta('external_url', undefined).error_code).toBe(AD_CTA_URL_INVALID);
    expect(validate_ad_cta('external_url', '').error_code).toBe(AD_CTA_URL_INVALID);
  });

  it('rechaza "https://" — esquema válido pero host VACÍO, un CTA que no abre nada', () => {
    const result = validate_ad_cta('external_url', 'https://');

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_CTA_URL_INVALID);
  });

  it('rechaza "http://" — mismo caso de host vacío con el otro esquema permitido', () => {
    const result = validate_ad_cta('external_url', 'http://');

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_CTA_URL_INVALID);
  });

  it('rechaza "htt\\tps://ejemplo.com" — tab EMBEBIDO dentro del propio esquema (contrato nuevo: ya NO se despoja antes de validar)', () => {
    // "htt" + "ps" == "https" — el tab está insertado DENTRO de la palabra
    // "https", no antes. Antes del cambio de contrato, un
    // .replace(/[\t\n\r]/g,'') interno limpiaba esto a "https://ejemplo.com"
    // y lo aceptaba — exactamente el hueco que el guardián marcó como
    // mutante equivalente (d1/d2): bajo una allowlist, despojar caracteres
    // de control solo AMPLÍA lo aceptado.
    const result = validate_ad_cta('external_url', 'htt\tps://ejemplo.com');

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_CTA_URL_INVALID);
  });

  it('rechaza "htt\\nps://ejemplo.com" — newline EMBEBIDO dentro del propio esquema, mismo contrato nuevo', () => {
    const result = validate_ad_cta('external_url', 'htt\nps://ejemplo.com');

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_CTA_URL_INVALID);
  });

  it('normalized_value trae la URL recortada (trim), sin espacios en ningún extremo', () => {
    const result = cta('external_url', '  https://ejemplo.com  ');

    expect(result.valid).toBe(true);
    expect(result.normalized_value).toBe('https://ejemplo.com');
  });

  it('normalized_value es null cuando la URL es inválida — nunca se guarda lo que no se validó', () => {
    const result = cta('external_url', 'javascript:alert(1)');

    expect(result.valid).toBe(false);
    expect(result.normalized_value).toBeNull();
  });
});

describe('validate_ad_cta — whatsapp (normalización de la casa: phone.replace(/\\D/g, ""))', () => {
  it('acepta un número mexicano de 10 dígitos sin formato', () => {
    const result = validate_ad_cta('whatsapp', '3312345678');

    expect(result.valid).toBe(true);
    expect(result.error_code).toBeNull();
  });

  it('acepta un número con formato humano que normaliza a 10 dígitos ("33 1234 5678")', () => {
    expect(validate_ad_cta('whatsapp', '33 1234 5678').valid).toBe(true);
  });

  it('acepta un número con lada país "+52" que normaliza a 12 dígitos', () => {
    expect(validate_ad_cta('whatsapp', '+52 33 1234 5678').valid).toBe(true);
  });

  it('frontera: 9 dígitos se rechaza, 10 dígitos se acepta', () => {
    expect(validate_ad_cta('whatsapp', '123456789').valid).toBe(false);
    expect(validate_ad_cta('whatsapp', '1234567890').valid).toBe(true);
  });

  it('frontera: 15 dígitos se acepta, 16 dígitos se rechaza (tope E.164)', () => {
    expect(validate_ad_cta('whatsapp', '123456789012345').valid).toBe(true);
    expect(validate_ad_cta('whatsapp', '1234567890123456').valid).toBe(false);
  });

  it('rechaza un valor sin dígitos ("abc-def-ghij") con AD_CTA_PHONE_INVALID', () => {
    const result = validate_ad_cta('whatsapp', 'abc-def-ghij');

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_CTA_PHONE_INVALID);
  });

  it('rechaza null/undefined/vacío con AD_CTA_PHONE_INVALID', () => {
    expect(validate_ad_cta('whatsapp', null).error_code).toBe(AD_CTA_PHONE_INVALID);
    expect(validate_ad_cta('whatsapp', undefined).error_code).toBe(AD_CTA_PHONE_INVALID);
    expect(validate_ad_cta('whatsapp', '').error_code).toBe(AD_CTA_PHONE_INVALID);
  });

  it('normalized_value trae SOLO los dígitos de un número con formato humano — el wizard no debe re-normalizar', () => {
    const result = cta('whatsapp', '+52 33 1234 5678');

    expect(result.valid).toBe(true);
    expect(result.normalized_value).toBe('523312345678');
  });

  it('normalized_value es null cuando el teléfono es inválido', () => {
    const result = cta('whatsapp', 'abc-def-ghij');

    expect(result.valid).toBe(false);
    expect(result.normalized_value).toBeNull();
  });
});

describe('validate_ad_cta — phone (mismo criterio de normalización que whatsapp, tipo distinto)', () => {
  it('acepta un número mexicano de 10 dígitos', () => {
    expect(validate_ad_cta('phone', '3312345678').valid).toBe(true);
  });

  it('rechaza un número demasiado corto con AD_CTA_PHONE_INVALID', () => {
    const result = validate_ad_cta('phone', '123');

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_CTA_PHONE_INVALID);
  });

  it('rechaza null con AD_CTA_PHONE_INVALID', () => {
    expect(validate_ad_cta('phone', null).error_code).toBe(AD_CTA_PHONE_INVALID);
  });

  it('normalized_value trae SOLO los dígitos también para el tipo "phone" (no solo "whatsapp")', () => {
    const result = cta('phone', '33-1234-5678');

    expect(result.valid).toBe(true);
    expect(result.normalized_value).toBe('3312345678');
  });
});

// ===========================================================================
// validate_ad_zones — XOR municipio/colonia por fila; lista vacía = nacional
// (D3 de 169.1) — el assert más importante del archivo.
// ===========================================================================

describe('validate_ad_zones', () => {
  it('🔴 lista VACÍA es VÁLIDA — significa inventario nacional, no un error de formulario', () => {
    const result = validate_ad_zones([]);

    expect(result.valid).toBe(true);
    expect(result.error_code).toBeNull();
  });

  it('undefined es válido — equivalente a "sin zonas" (nacional), espejo de p_zones NULL en el RPC', () => {
    const result = validate_ad_zones(undefined);

    expect(result.valid).toBe(true);
    expect(result.error_code).toBeNull();
  });

  it('null es válido — mismo caso que undefined', () => {
    const result = validate_ad_zones(null);

    expect(result.valid).toBe(true);
    expect(result.error_code).toBeNull();
  });

  it('acepta una fila con solo municipality_id (colonia null)', () => {
    const zones: AdZoneInput[] = [{ municipality_id: '14039', neighborhood_id: null }];

    expect(validate_ad_zones(zones).valid).toBe(true);
  });

  it('acepta una fila con solo neighborhood_id (municipio null)', () => {
    const zones: AdZoneInput[] = [{ municipality_id: null, neighborhood_id: 42 }];

    expect(validate_ad_zones(zones).valid).toBe(true);
  });

  it('acepta múltiples filas válidas mezclando municipios y colonias', () => {
    const zones: AdZoneInput[] = [
      { municipality_id: '14039', neighborhood_id: null },
      { municipality_id: '14120', neighborhood_id: null },
      { municipality_id: null, neighborhood_id: 42 },
    ];

    expect(validate_ad_zones(zones).valid).toBe(true);
  });

  it('rechaza una fila con AMBOS municipality_id y neighborhood_id (viola el XOR) con AD_ZONE_INVALID', () => {
    const zones: AdZoneInput[] = [{ municipality_id: '14039', neighborhood_id: 42 }];
    const result = validate_ad_zones(zones);

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_ZONE_INVALID);
  });

  it('rechaza una fila con NINGUNO de los dos (ambos null) con AD_ZONE_INVALID', () => {
    const zones: AdZoneInput[] = [{ municipality_id: null, neighborhood_id: null }];
    const result = validate_ad_zones(zones);

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_ZONE_INVALID);
  });

  it('una sola fila inválida invalida la lista completa, aunque las demás sean válidas', () => {
    const zones: AdZoneInput[] = [
      { municipality_id: '14039', neighborhood_id: null },
      { municipality_id: null, neighborhood_id: null },
    ];
    const result = validate_ad_zones(zones);

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_ZONE_INVALID);
  });
});
