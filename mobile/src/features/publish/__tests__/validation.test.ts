/**
 * validation.test.ts — validate_video_size (subtarea 49.2) +
 * validate_step3 / get_property_payload upload-first (subtarea 68.12, fase RED).
 *
 * El límite MAX_VIDEO_SIZE_BYTES debe coincidir con el límite del bucket de
 * Storage donde se sube el video de la propiedad (500 MB).
 *
 * 68.12 — CAMBIO DE CONTRATO: el video se sube a Cloudflare Stream ANTES de
 * existir la propiedad (mint-upload-url, 68.4). El form ya no depende de
 * storage_path (Supabase Storage, flujo legado) para considerar el video
 * "listo" — depende de cloudflare_uid. validate_step3 y get_property_payload
 * (hoy, SIN migrar) siguen exigiendo storage_path → estos tests fallan por
 * aserción contra el comportamiento viejo.
 */

import {
  MAX_VIDEO_SIZE_BYTES,
  validate_video_size,
  validate_step3,
  get_property_payload,
} from '@/features/publish/validation';
import { INITIAL_PUBLISH_FORM_STATE } from '@/features/publish/store/types';
import type { PublishFormState } from '@/features/publish/store/types';

const MB = 1024 * 1024;

// ---------------------------------------------------------------------------
// Helper — state válido de los steps 1 y 2, con overrides libres para el
// campo de video (step 3). snake_case por convención de factories de test.
// ---------------------------------------------------------------------------

function build_valid_step3_state(
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

// ---------------------------------------------------------------------------
// validate_step3 (68.12 — upload-first: cloudflare_uid reemplaza storage_path)
// ---------------------------------------------------------------------------

describe('validate_step3 (68.12 — upload-first: cloudflare_uid reemplaza storage_path)', () => {
  it('es válido con cloudflare_uid presente aunque storage_path sea null (video en Cloudflare Stream, no en Supabase Storage)', () => {
    const state = build_valid_step3_state({
      cloudflare_uid: 'cf-stream-uid-1',
      storage_path: null,
      video_id: 'vid-uuid-1',
    });

    const result = validate_step3(state);

    expect(result.valid).toBe(true);
    expect(result.errors.cloudflare_uid).toBeUndefined();
  });

  it('es válido con cloudflare_uid presente aunque video_id sea null (el gate real es cloudflare_uid, no video_id)', () => {
    const state = build_valid_step3_state({
      cloudflare_uid: 'cf-stream-uid-2',
      storage_path: null,
      video_id: null,
    });

    const result = validate_step3(state);

    expect(result.valid).toBe(true);
  });

  it('es inválido cuando falta cloudflare_uid, con mensaje "El video no terminó de subirse"', () => {
    const state = build_valid_step3_state({
      cloudflare_uid: null,
      storage_path: null,
      video_id: 'vid-uuid-3',
    });

    const result = validate_step3(state);

    expect(result.valid).toBe(false);
    expect(result.errors.cloudflare_uid).toBe('El video no terminó de subirse');
  });

  it('tener storage_path legacy no basta: sin cloudflare_uid sigue siendo inválido (storage_path ya no es el gate)', () => {
    const state = build_valid_step3_state({
      cloudflare_uid: null,
      storage_path: 'legacy-agent/legacy-video.mp4',
      video_id: 'vid-uuid-4',
    });

    const result = validate_step3(state);

    expect(result.valid).toBe(false);
    expect(result.errors.cloudflare_uid).toBe('El video no terminó de subirse');
  });
});

// ---------------------------------------------------------------------------
// get_property_payload (68.12 — el payload de la EF lleva cloudflare_uid,
// ya no storage_path)
// ---------------------------------------------------------------------------

describe('get_property_payload (68.12 — cloudflare_uid reemplaza storage_path en el payload)', () => {
  it('emite cloudflare_uid en el payload y NO emite storage_path', () => {
    const state = build_valid_step3_state({
      cloudflare_uid: 'cf-stream-uid-abc',
      storage_path: null,
      video_id: 'vid-uuid-5',
    });

    const payload = get_property_payload(state) as unknown as Record<string, unknown>;

    expect(payload.cloudflare_uid).toBe('cf-stream-uid-abc');
    expect(payload.storage_path).toBeUndefined();
  });

  it('lanza si falta cloudflare_uid, incluso con video_id y storage_path legacy presentes', () => {
    const state = build_valid_step3_state({
      cloudflare_uid: null,
      storage_path: 'legacy-agent/legacy-video.mp4',
      video_id: 'vid-uuid-6',
    });

    expect(() => get_property_payload(state)).toThrow();
  });
});
