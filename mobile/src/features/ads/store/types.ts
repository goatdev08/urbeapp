/**
 * types.ts — shape del estado del wizard de anuncios (subtarea 169.9).
 *
 * Espejo deliberado de mobile/src/features/publish/store/types.ts (mismo
 * patrón: solo los campos que el wizard recolecta, sin lógica ni estado de
 * UI transitorio — eso vive en cada screen).
 *
 * cta_value guarda el `normalized_value` de validate_ad_cta (169.6), NUNCA
 * el string crudo del input — es la razón por la que ese campo existe (ver
 * cabecera de mobile/src/features/ads/lib/validation.ts).
 *
 * zones guarda AdZoneSelection (con name/context para pintar chips en
 * step4/step5) — se reduce a AdZoneInput (solo los ids que espera
 * validate_ad_zones) al validar, sin duplicar el shape ya definido en
 * lib/validation.ts.
 */
import type { AdCtaType } from '../lib/validation';
import type { PlaceSuggestion } from '@/features/map/lib/placeSearch';

/** Zona seleccionada en step4 — mismo shape que PlaceSuggestion (169.9 no inventa uno nuevo). */
export type AdZoneSelection = PlaceSuggestion;

export interface AdFormState {
  // Step 1 — creativo (video)
  video_local_uri: string | null;
  video_duration_ms: number | null;
  /**
   * uid de Cloudflare Stream. #230 (pre-aprobación): se guarda desde que el
   * mint resuelve y el binario completa — ya NO espera al 'ready' (antes
   * 169.7). La confirmación del servidor viaja aparte en `creative_ready`.
   */
  cloudflare_uid: string | null;
  /**
   * true solo cuando el creativo llegó a 'ready' confirmado por el servidor.
   * false con uid presente = binario al 100%, transcodificación en curso
   * (pre-aprobado por el pre-flight de duración/peso del cliente) — el paso 5
   * resuelve la verdad con wait_for_creative_ready antes de crear la campaña.
   */
  creative_ready: boolean;

  // Step 2 — título
  title: string;

  // Step 3 — CTA
  cta_type: AdCtaType | null;
  /** normalized_value de validate_ad_cta — NUNCA el string crudo del input. */
  cta_value: string | null;

  // Step 4 — zonas ([] = cobertura nacional, D3 de 169.1 — válido, no es error)
  zones: AdZoneSelection[];
}

export const INITIAL_AD_FORM_STATE: AdFormState = {
  video_local_uri: null,
  video_duration_ms: null,
  cloudflare_uid: null,
  creative_ready: false,
  title: '',
  cta_type: null,
  cta_value: null,
  zones: [],
};
