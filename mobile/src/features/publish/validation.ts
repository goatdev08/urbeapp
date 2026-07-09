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
// Step 1 — operation_type y property_type requeridos
// ---------------------------------------------------------------------------

export function validate_step1(state: PublishFormState): ValidationResult {
  const errors: Record<string, string> = {};

  if (!state.operation_type) {
    errors.operation_type = 'Selecciona el tipo de operación';
  }
  if (!state.property_type) {
    errors.property_type = 'Selecciona el tipo de propiedad';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// ---------------------------------------------------------------------------
// Step 2 — price > 0, address no vacío, lat/lng presentes
// ---------------------------------------------------------------------------

export function validate_step2(state: PublishFormState): ValidationResult {
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
// Step 3 — video_id y storage_path presentes (upload completado)
// ---------------------------------------------------------------------------

export function validate_step3(state: PublishFormState): ValidationResult {
  const errors: Record<string, string> = {};

  if (!state.video_id) {
    errors.video_id = 'El video es requerido';
  }
  if (!state.storage_path) {
    errors.storage_path = 'El video no terminó de subirse';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// ---------------------------------------------------------------------------
// getPropertyPayload — transforma el state al shape de la EF publish-property.
// Precondición: los 3 pasos ya validaron (lanza si hay campos nulos obligatorios).
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

export function get_property_payload(state: PublishFormState): PublishFormPayload {
  if (
    !state.operation_type ||
    !state.property_type ||
    state.price === null ||
    state.lat === null ||
    state.lng === null ||
    !state.video_id ||
    !state.storage_path
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
    pet_friendly: state.pet_friendly,
    allows_no_guarantor: state.allows_no_guarantor,
    student_friendly: state.student_friendly,
    description: state.description,
    video_id: state.video_id,
    storage_path: state.storage_path,
  };
}
