/**
 * validation.test.ts — validate_video_size (subtarea 49.2, sin cambios) +
 * validate_step1..5 + get_property_payload (subtarea 73.3, fase RED).
 *
 * 73.3 — SPLIT DE CONTRATO: el wizard pasa de 3 a 5 pasos (PRD §14):
 *   step1: operation_type (solo)
 *   step2: property_type (solo)
 *   step3: detalles obligatorios — price, address, lat/lng (antes vivía en el
 *          viejo validate_step2) + price_visible (toggle, sin validación de
 *          "requerido": siempre válido)
 *   step4: detalles opcionales — description, pet_friendly, allows_no_guarantor,
 *          student_friendly. SIEMPRE válido (no hay campos obligatorios).
 *   step5: video — renombrado 1:1 del viejo validate_step3 (cloudflare_uid).
 *
 * get_property_payload gana price_visible:boolean en el payload de salida.
 *
 * NOTA DE TIPOS (RED): `price_visible` AÚN NO EXISTE en `PublishFormState` ni
 * en `PublishFormPayload` (types.ts) — ese es precisamente el hueco que el
 * GREEN cierra. Mismo patrón que `usePublish.edit.test.tsx` (extensión local
 * de tipo con `&`) para no tocar types.ts de producción en RED.
 */

import {
  MAX_VIDEO_SIZE_BYTES,
  validate_video_duration_ms,
  validate_video_size,
  validate_step1,
  validate_step2,
  validate_step3,
  validate_step4,
  validate_step5,
  get_property_payload,
} from '@/features/publish/validation';
import { INITIAL_PUBLISH_FORM_STATE } from '@/features/publish/store/types';
import type { PublishFormPayload, PublishFormState } from '@/features/publish/store/types';

const MB = 1024 * 1024;

// ---------------------------------------------------------------------------
// Extensión local de tipo — price_visible no existe en PublishFormState /
// PublishFormPayload de producción todavía (ver nota de tipos arriba).
// ---------------------------------------------------------------------------

type PublishFormStateWithPriceVisible = PublishFormState & { price_visible: boolean };
type PublishFormPayloadWithPriceVisible = PublishFormPayload & { price_visible: boolean };

// ---------------------------------------------------------------------------
// Helpers — factories snake_case por convención del repo.
// ---------------------------------------------------------------------------

/** State base para step3: precio/dirección/mapa válidos, price_visible=true. */
function build_step3_valid_state(
  overrides: Partial<PublishFormStateWithPriceVisible> = {},
): PublishFormStateWithPriceVisible {
  return {
    ...INITIAL_PUBLISH_FORM_STATE,
    price: 12500,
    address: 'Av. Insurgentes Sur 1602, CDMX',
    lat: 19.3836,
    lng: -99.1748,
    price_visible: true,
    ...overrides,
  } as PublishFormStateWithPriceVisible;
}

/** State válido para step5 (video) — mismo helper que usaba el viejo validate_step3. */
function build_step5_valid_state(
  overrides: Partial<PublishFormState>,
): PublishFormState {
  return {
    ...INITIAL_PUBLISH_FORM_STATE,
    operation_type: 'rent',
    property_type: 'departamento',
    price: 12500,
    address: 'Av. Insurgentes Sur 1602, CDMX',
    lat: 19.3836,
    lng: -99.1748,
    ...overrides,
  };
}

/** State completo (5 pasos) válido, para get_property_payload. */
function build_full_valid_state(
  overrides: Partial<PublishFormStateWithPriceVisible> = {},
): PublishFormStateWithPriceVisible {
  return {
    ...INITIAL_PUBLISH_FORM_STATE,
    operation_type: 'rent',
    property_type: 'departamento',
    price: 12500,
    address: 'Av. Insurgentes Sur 1602, CDMX',
    lat: 19.3836,
    lng: -99.1748,
    price_visible: true,
    cloudflare_uid: 'cf-stream-uid-full-1',
    ...overrides,
  } as PublishFormStateWithPriceVisible;
}

// ===========================================================================
// validate_video_size — SIN CAMBIOS en 73.3 (no-regresión)
// ===========================================================================

describe('validate_video_size', () => {
  it('acepta un video bien por debajo de 500 MB', () => {
    const result = validate_video_size(100 * MB);

    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it('acepta un video de exactamente MAX_VIDEO_SIZE_BYTES (límite inclusivo)', () => {
    const result = validate_video_size(MAX_VIDEO_SIZE_BYTES);

    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it('rechaza un video de 600 MB con mensaje en español que menciona el tamaño real y el límite', () => {
    const result = validate_video_size(600 * MB);

    expect(result.valid).toBe(false);
    expect(result.error).not.toBeNull();
    expect(result.error).toContain('600 MB');
    expect(result.error).toContain('500 MB');
  });

  it('calcula size_mb redondeado a partir de los bytes', () => {
    const result = validate_video_size(250 * MB);

    expect(result.size_mb).toBe(250);
  });

  it('MAX_VIDEO_SIZE_BYTES coincide con el límite del bucket de Storage (500 MB)', () => {
    expect(MAX_VIDEO_SIZE_BYTES).toBe(524288000);
  });
});

// ===========================================================================
// validate_video_duration_ms (#126) — 60–120 s inclusive, validado AL ELEGIR
// el video (picker), no al final del wizard con el video ya subido.
// ===========================================================================

describe('validate_video_duration_ms', () => {
  it('rechaza un video de 45 s con mensaje en español que menciona el rango', () => {
    const result = validate_video_duration_ms(45_000);

    expect(result.valid).toBe(false);
    expect(result.error).not.toBeNull();
    expect(result.error).toMatch(/60/);
    expect(result.error).toMatch(/120|2 min/);
  });

  it('rechaza un video de 150 s', () => {
    const result = validate_video_duration_ms(150_000);

    expect(result.valid).toBe(false);
    expect(result.error).not.toBeNull();
  });

  it('acepta 60 s y 120 s exactos (límites inclusive, PRD §14 paso 5)', () => {
    expect(validate_video_duration_ms(60_000).valid).toBe(true);
    expect(validate_video_duration_ms(120_000).valid).toBe(true);
  });

  it('rechaza 59.4 s y 120.6 s (justo fuera del rango)', () => {
    expect(validate_video_duration_ms(59_400).valid).toBe(false);
    expect(validate_video_duration_ms(120_600).valid).toBe(false);
  });

  it('acepta 90 s (caso típico)', () => {
    const result = validate_video_duration_ms(90_000);

    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it('duración desconocida (null/undefined/0) pasa — fail-open, el server revalida', () => {
    expect(validate_video_duration_ms(null).valid).toBe(true);
    expect(validate_video_duration_ms(undefined).valid).toBe(true);
    expect(validate_video_duration_ms(0).valid).toBe(true);
  });
});

// ===========================================================================
// validate_step1 (73.3 — SOLO operation_type; property_type se mueve a step2)
// ===========================================================================

describe('validate_step1 — SOLO operation_type requerido (73.3, split del step1 viejo)', () => {
  it('(V1-1) operation_type presente y property_type null → válido (step1 no exige property_type)', () => {
    const state = build_step5_valid_state({ operation_type: 'rent', property_type: null });

    const result = validate_step1(state);

    expect(result.valid).toBe(true);
    expect(result.errors.property_type).toBeUndefined();
  });

  it('(V1-2) sin operation_type (y sin property_type) → inválido, mensaje en operation_type, SIN reportar property_type', () => {
    const state = build_step5_valid_state({ operation_type: null, property_type: null });

    const result = validate_step1(state);

    expect(result.valid).toBe(false);
    expect(result.errors.operation_type).toBe('Selecciona el tipo de operación');
    // step1 ya NO es responsable de property_type (eso es validate_step2)
    expect(result.errors.property_type).toBeUndefined();
  });

});

// ===========================================================================
// validate_step2 (73.3 — SOLO property_type; operation_type ya no es su tema)
// ===========================================================================

describe('validate_step2 — SOLO property_type requerido (73.3, split del step1 viejo)', () => {
  it('(V2-1) property_type presente y operation_type null → válido (step2 no exige operation_type)', () => {
    // Base INITIAL (no build_step5_valid_state): price/address/lat/lng quedan
    // en su default vacío/null a propósito — si el test usara un state con
    // esos campos ya válidos, el validate_step2 VIEJO (que hoy valida
    // price/address/lat/lng, no property_type) pasaría por coincidencia.
    const state = { ...INITIAL_PUBLISH_FORM_STATE, property_type: 'casa' as const, operation_type: null };

    const result = validate_step2(state);

    expect(result.valid).toBe(true);
    expect(result.errors.operation_type).toBeUndefined();
  });

  it('(V2-2) sin property_type → inválido, mensaje "Selecciona el tipo de propiedad"', () => {
    const state = build_step5_valid_state({ property_type: null, operation_type: 'sale' });

    const result = validate_step2(state);

    expect(result.valid).toBe(false);
    expect(result.errors.property_type).toBe('Selecciona el tipo de propiedad');
  });

  it('(V2-3) con property_type presente, no reporta error de operation_type aunque esté ausente', () => {
    const state = { ...INITIAL_PUBLISH_FORM_STATE, property_type: 'oficina' as const, operation_type: null };

    const result = validate_step2(state);

    expect(result.errors.operation_type).toBeUndefined();
    expect(result.valid).toBe(true);
  });
});

// ===========================================================================
// validate_step3 (73.3 — ahora price/address/lat/lng, antes vivía en step2;
// price_visible es un toggle sin validación de "requerido")
// ===========================================================================

describe('validate_step3 — detalles obligatorios: price/address/lat/lng + price_visible (73.3, antes step2)', () => {
  it('(V3-1) precio, dirección y coordenadas válidos → válido', () => {
    const state = build_step3_valid_state();

    const result = validate_step3(state);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('(V3-2) price=0 → inválido, mensaje "El precio debe ser mayor a 0"', () => {
    const state = build_step3_valid_state({ price: 0 });

    const result = validate_step3(state);

    expect(result.valid).toBe(false);
    expect(result.errors.price).toBe('El precio debe ser mayor a 0');
  });

  it('(V3-3) price=null → inválido, mismo mensaje de precio', () => {
    const state = build_step3_valid_state({ price: null });

    const result = validate_step3(state);

    expect(result.valid).toBe(false);
    expect(result.errors.price).toBe('El precio debe ser mayor a 0');
  });

  it('(V3-4) address vacío (solo espacios) → inválido, mensaje "La dirección es requerida"', () => {
    const state = build_step3_valid_state({ address: '   ' });

    const result = validate_step3(state);

    expect(result.valid).toBe(false);
    expect(result.errors.address).toBe('La dirección es requerida');
  });

  it('(V3-5) lat=null → inválido, mensaje de ubicación en el mapa', () => {
    const state = build_step3_valid_state({ lat: null });

    const result = validate_step3(state);

    expect(result.valid).toBe(false);
    expect(result.errors.lat).toBe('La ubicación en el mapa es requerida');
  });

  it('(V3-6) lng=null → inválido, mensaje de ubicación en el mapa', () => {
    const state = build_step3_valid_state({ lng: null });

    const result = validate_step3(state);

    expect(result.valid).toBe(false);
    expect(result.errors.lng).toBe('La ubicación en el mapa es requerida');
  });

  it('(V3-7) price_visible=false sigue siendo válido — es un toggle, nunca genera error propio', () => {
    const state = build_step3_valid_state({ price_visible: false });

    const result = validate_step3(state);

    expect(result.valid).toBe(true);
    expect(result.errors.price_visible).toBeUndefined();
  });

  it('(V3-8) price_visible=true (default) también válido, sin error asociado a price_visible', () => {
    const state = build_step3_valid_state({ price_visible: true });

    const result = validate_step3(state);

    expect(result.valid).toBe(true);
    expect(result.errors.price_visible).toBeUndefined();
  });
});

// ===========================================================================
// validate_step4 (73.3 — NUEVO: detalles opcionales, SIEMPRE válido)
// ===========================================================================

describe('validate_step4 — detalles opcionales, SIEMPRE válido (73.3, nuevo)', () => {
  it('(V4-1) con todos los campos opcionales en su default vacío → válido, sin errores', () => {
    const state = {
      ...INITIAL_PUBLISH_FORM_STATE,
      description: '',
      pet_friendly: false,
      allows_no_guarantor: false,
      student_friendly: false,
    };

    const result = validate_step4(state);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('(V4-2) con todos los campos opcionales llenos → válido, sin errores', () => {
    const state = {
      ...INITIAL_PUBLISH_FORM_STATE,
      description: 'Depa remodelado, buena luz, cerca del metro',
      pet_friendly: true,
      allows_no_guarantor: true,
      student_friendly: true,
    };

    const result = validate_step4(state);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('(V4-3) spec explícita: SIEMPRE retorna {valid:true, errors:{}} incluso con el resto del wizard vacío', () => {
    // INITIAL_PUBLISH_FORM_STATE crudo: ni operation_type, ni property_type,
    // ni price ni video están llenos. validate_step4 no debe importarle nada
    // de eso — es un paso sin campos obligatorios propios.
    const result = validate_step4(INITIAL_PUBLISH_FORM_STATE);

    expect(result).toEqual({ valid: true, errors: {} });
  });
});

// ===========================================================================
// validate_step5 (73.3 — renombrado 1:1 del viejo validate_step3: video)
// ===========================================================================

describe('validate_step5 — video (73.3, renombrado 1:1 del validate_step3 viejo, mismo comportamiento)', () => {
  it('(V5-1) es válido con cloudflare_uid presente aunque storage_path sea null (video en Cloudflare Stream, no en Supabase Storage)', () => {
    const state = build_step5_valid_state({
      cloudflare_uid: 'cf-stream-uid-1',
      storage_path: null,
      video_id: 'vid-uuid-1',
    });

    const result = validate_step5(state);

    expect(result.valid).toBe(true);
    expect(result.errors.cloudflare_uid).toBeUndefined();
  });

  it('(V5-2) es válido con cloudflare_uid presente aunque video_id sea null (el gate real es cloudflare_uid, no video_id)', () => {
    const state = build_step5_valid_state({
      cloudflare_uid: 'cf-stream-uid-2',
      storage_path: null,
      video_id: null,
    });

    const result = validate_step5(state);

    expect(result.valid).toBe(true);
  });

  it('(V5-3) es inválido cuando falta cloudflare_uid, con mensaje "El video no terminó de subirse"', () => {
    const state = build_step5_valid_state({
      cloudflare_uid: null,
      storage_path: null,
      video_id: 'vid-uuid-3',
    });

    const result = validate_step5(state);

    expect(result.valid).toBe(false);
    expect(result.errors.cloudflare_uid).toBe('El video no terminó de subirse');
  });

  it('(V5-4) tener storage_path legacy no basta: sin cloudflare_uid sigue siendo inválido (storage_path ya no es el gate)', () => {
    const state = build_step5_valid_state({
      cloudflare_uid: null,
      storage_path: 'legacy-agent/legacy-video.mp4',
      video_id: 'vid-uuid-4',
    });

    const result = validate_step5(state);

    expect(result.valid).toBe(false);
    expect(result.errors.cloudflare_uid).toBe('El video no terminó de subirse');
  });
});

// ===========================================================================
// get_property_payload (73.3 — gana price_visible en el payload; regresión
// de lo que ya exigía antes de 73.3 — 68.12, cloudflare_uid vs storage_path)
// ===========================================================================

describe('get_property_payload — price_visible en el payload de salida (73.3)', () => {
  it('(P-1) incluye price_visible:true en el payload cuando el usuario no oculta el precio (default)', () => {
    const state = build_full_valid_state({ price_visible: true });

    const payload = get_property_payload(state) as unknown as PublishFormPayloadWithPriceVisible;

    expect(payload.price_visible).toBe(true);
  });

  it('(P-2) incluye price_visible:false en el payload cuando el usuario oculta el precio', () => {
    const state = build_full_valid_state({ price_visible: false });

    const payload = get_property_payload(state) as unknown as PublishFormPayloadWithPriceVisible;

    expect(payload.price_visible).toBe(false);
  });

  it('(P-3) [no-regresión 68.12] emite cloudflare_uid en el payload y NO emite storage_path', () => {
    const state = build_full_valid_state({
      cloudflare_uid: 'cf-stream-uid-abc',
      storage_path: null,
      video_id: 'vid-uuid-5',
    });

    const payload = get_property_payload(state) as unknown as Record<string, unknown>;

    expect(payload.cloudflare_uid).toBe('cf-stream-uid-abc');
    expect(payload.storage_path).toBeUndefined();
  });

  it('(P-4) [no-regresión 68.12] lanza si falta cloudflare_uid, incluso con video_id y storage_path legacy presentes', () => {
    const state = build_full_valid_state({
      cloudflare_uid: null,
      storage_path: 'legacy-agent/legacy-video.mp4',
      video_id: 'vid-uuid-6',
    });

    expect(() => get_property_payload(state)).toThrow();
  });
});
