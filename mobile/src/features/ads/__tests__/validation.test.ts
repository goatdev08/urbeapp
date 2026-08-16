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
  type AdZoneInput,
} from '@/features/ads/lib/validation';

// ===========================================================================
// Constantes — el rango debe ser exactamente 6..30 s (fuente independiente:
// AD_MIN/MAX_DURATION_SECONDS del servidor, stream-webhook/types.ts).
// ===========================================================================

describe('constantes de duración', () => {
  it('el rango es 6-30 s, espejo del servidor (169.5)', () => {
    expect(AD_MIN_DURATION_SECONDS).toBe(6);
    expect(AD_MAX_DURATION_SECONDS).toBe(30);
  });
});

// ===========================================================================
// validate_ad_duration_ms — fronteras 5.9 / 6 / 30 / 30.1 explícitas.
// ===========================================================================

describe('validate_ad_duration_ms', () => {
  it('acepta 6.0 s exactos (frontera inclusiva inferior)', () => {
    const result = validate_ad_duration_ms(6_000);

    expect(result.valid).toBe(true);
    expect(result.error_code).toBeNull();
  });

  it('acepta 30.0 s exactos (frontera inclusiva superior)', () => {
    const result = validate_ad_duration_ms(30_000);

    expect(result.valid).toBe(true);
    expect(result.error_code).toBeNull();
  });

  it('acepta 15 s (caso típico dentro del rango)', () => {
    expect(validate_ad_duration_ms(15_000).valid).toBe(true);
  });

  it('rechaza 5.9 s con AD_DURATION_INVALID (justo debajo del mínimo)', () => {
    const result = validate_ad_duration_ms(5_900);

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_DURATION_INVALID);
  });

  it('rechaza 30.1 s con AD_DURATION_INVALID (justo arriba del máximo)', () => {
    const result = validate_ad_duration_ms(30_100);

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_DURATION_INVALID);
  });

  it('rechaza 5.7 s — el hueco exacto que un redondeo-antes-de-comparar dejaría pasar (169.5)', () => {
    // 5.7 redondeado da 6 (que SÍ sería válido). Este caso solo falla si la
    // implementación compara sobre el valor crudo fraccionario, nunca sobre
    // Math.round(seconds) — exactamente el mutante que coló 169.5.
    const result = validate_ad_duration_ms(5_700);

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_DURATION_INVALID);
  });

  it('rechaza duración null — fail-closed (el servidor 169.5 también lo es ante duración ausente)', () => {
    const result = validate_ad_duration_ms(null);

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_DURATION_INVALID);
  });

  it('rechaza duración undefined — fail-closed', () => {
    const result = validate_ad_duration_ms(undefined);

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_DURATION_INVALID);
  });

  it('rechaza 0 ms — fail-closed (no es "duración desconocida que pasa", es duración inválida)', () => {
    const result = validate_ad_duration_ms(0);

    expect(result.valid).toBe(false);
    expect(result.error_code).toBe(AD_DURATION_INVALID);
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
