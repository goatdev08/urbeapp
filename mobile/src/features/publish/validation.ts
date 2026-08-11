/**
 * validation.ts — funciones puras de validación por paso del wizard de publicación.
 *
 * Cada validate* devuelve { valid, errors } donde errors es un mapa campo → mensaje.
 * getPropertyPayload arma el objeto para la Edge Function publish-property.
 *
 * ponytail: sin dependencias externas — solo tipos y lógica mínima.
 */

import type { PublishFormPayload, PublishFormState } from './store/types';

// ---------------------------------------------------------------------------
// Shape de resultado de validación
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Step 1 — operation_type requerido (73.3: split del step1 viejo)
// ---------------------------------------------------------------------------

export function validate_step1(state: PublishFormState): ValidationResult {
  const errors: Record<string, string> = {};

  if (!state.operation_type) {
    errors.operation_type = 'Selecciona el tipo de operación';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// ---------------------------------------------------------------------------
// Step 2 — property_type requerido (73.3: split del step1 viejo)
// ---------------------------------------------------------------------------

export function validate_step2(state: PublishFormState): ValidationResult {
  const errors: Record<string, string> = {};

  if (!state.property_type) {
    errors.property_type = 'Selecciona el tipo de propiedad';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// ---------------------------------------------------------------------------
// Step 3 (73.3, antes step2) — price > 0, address no vacío, lat/lng
// presentes. price_visible es un toggle sin validación de "requerido" —
// siempre válido, nunca genera error propio.
// ---------------------------------------------------------------------------

export function validate_step3(state: PublishFormState): ValidationResult {
  const errors: Record<string, string> = {};

  if (state.price === null || state.price <= 0) {
    errors.price = 'El precio debe ser mayor a 0';
  }
  if (!state.address.trim()) {
    errors.address = 'La dirección es requerida';
  }
  if (state.lat === null) {
    errors.lat = 'La ubicación en el mapa es requerida';
  }
  if (state.lng === null) {
    errors.lng = 'La ubicación en el mapa es requerida';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// ---------------------------------------------------------------------------
// Step 4 (73.3, nuevo) — detalles opcionales: description, pet_friendly,
// allows_no_guarantor, student_friendly. SIEMPRE válido — este paso no tiene
// campos obligatorios propios.
// ---------------------------------------------------------------------------

export function validate_step4(_state: PublishFormState): ValidationResult {
  return { valid: true, errors: {} };
}

// ---------------------------------------------------------------------------
// Step 5 (73.3, renombrado 1:1 del viejo validate_step3) — cloudflare_uid
// presente (upload a Cloudflare Stream completado). 68.12 (upload-first): el
// gate real es cloudflare_uid — el video ya vive en Stream antes de existir
// la propiedad (mint-upload-url, 68.4). storage_path (Supabase Storage) es
// el flujo legado y ya no se exige aquí.
// ---------------------------------------------------------------------------

export function validate_step5(state: PublishFormState): ValidationResult {
  const errors: Record<string, string> = {};

  if (!state.cloudflare_uid) {
    errors.cloudflare_uid = 'El video no terminó de subirse';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// ---------------------------------------------------------------------------
// getPropertyPayload — transforma el state al shape de la EF publish-property.
// Precondición: los 5 pasos ya validaron (lanza si hay campos nulos obligatorios).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// validate_video_size — el video no debe exceder el límite del bucket de Storage.
// Debe coincidir con el límite del bucket de Storage (migración 20260710000001).
// ---------------------------------------------------------------------------

export const MAX_VIDEO_SIZE_BYTES = 524288000;

export interface VideoSizeValidationResult {
  valid: boolean;
  error: string | null;
  size_mb: number;
}

export function validate_video_size(size_bytes: number): VideoSizeValidationResult {
  const size_mb = Math.round(size_bytes / (1024 * 1024));
  const max_mb = Math.round(MAX_VIDEO_SIZE_BYTES / (1024 * 1024));

  if (size_bytes > MAX_VIDEO_SIZE_BYTES) {
    return {
      valid: false,
      error: `El video pesa ${size_mb} MB y supera el máximo de ${max_mb} MB. Elige uno más corto o de menor resolución.`,
      size_mb,
    };
  }

  return { valid: true, error: null, size_mb };
}

// ---------------------------------------------------------------------------
// validate_video_duration_ms (#126) — duración 10–120 s INCLUSIVE (#149:
// el mínimo bajó de 60 a 10, decisión de producto 2026-08-10; espejo del
// checker en supabase/functions/_shared/clients.ts — cambiar SIEMPRE ambos),
// validada AL ELEGIR el video (asset.duration del picker, en ms) — no al
// final del wizard, donde el server la rechazaría con el video ya subido.
// duration desconocida (null/undefined/0 — pickers Android viejos) → pasa
// (fail-open): el server sigue validando cuando el webhook reporta la
// duración real.
// ---------------------------------------------------------------------------

export const MIN_VIDEO_DURATION_SECONDS = 10;
export const MAX_VIDEO_DURATION_SECONDS = 120;

export interface VideoDurationValidationResult {
  valid: boolean;
  error: string | null;
}

export function validate_video_duration_ms(
  duration_ms: number | null | undefined,
): VideoDurationValidationResult {
  // Duración desconocida (null/undefined/0) → fail-open: el server revalida
  // con la duración real que reporte el webhook de Stream.
  if (!duration_ms) {
    return { valid: true, error: null };
  }

  const seconds = duration_ms / 1000;
  if (seconds < MIN_VIDEO_DURATION_SECONDS || seconds > MAX_VIDEO_DURATION_SECONDS) {
    return {
      valid: false,
      error:
        `El video dura ${Math.round(seconds)} s y debe durar entre 10 y 120 segundos (máx 2 min). ` +
        'Recórtalo o elige otro.',
    };
  }

  return { valid: true, error: null };
}

export function get_property_payload(state: PublishFormState): PublishFormPayload {
  if (
    !state.operation_type ||
    !state.property_type ||
    state.price === null ||
    state.lat === null ||
    state.lng === null ||
    !state.cloudflare_uid
  ) {
    throw new Error(
      'get_property_payload: estado incompleto — valida los 3 pasos antes de llamar',
    );
  }

  return {
    operation_type: state.operation_type,
    property_type: state.property_type,
    price: state.price,
    bedrooms: state.bedrooms,
    bathrooms: state.bathrooms,
    square_meters: state.square_meters,
    address: state.address,
    lat: state.lat,
    lng: state.lng,
    price_visible: state.price_visible,
    pet_friendly: state.pet_friendly,
    allows_no_guarantor: state.allows_no_guarantor,
    student_friendly: state.student_friendly,
    description: state.description,
    cloudflare_uid: state.cloudflare_uid,
  };
}
