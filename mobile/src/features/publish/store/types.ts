/**
 * types.ts — shape del estado del wizard de publicación (5 pasos, 73.3).
 *
 * Alineado al esquema de DB (supabase/migrations/0001):
 *   - operation_type: enum ('rent', 'sale', 'both')
 *   - property_type:  enum ('casa', 'departamento', 'local', 'oficina', 'terreno')
 *   - price_visible:  boolean, default true (properties.price_visible)
 *
 * ponytail: solo los campos que el wizard recolecta; sin lógica ni estado de UI.
 */

// ---------------------------------------------------------------------------
// Enums de DB (valores reales — verificados contra migration 0001)
// ---------------------------------------------------------------------------

export type OperationType = 'rent' | 'sale' | 'both';

/**
 * Moneda de `price` — solo etiqueta (sin conversión de tipo de cambio).
 * 'both' de OperationType se mantiene en el tipo/DB por compat con filas
 * existentes, pero el wizard (step1) ya no lo ofrece como opción — quick fix
 * 2026-08-15, sin tarea de Taskmaster.
 */
export type Currency = 'MXN' | 'USD';

export type PropertyType =
  | 'casa'
  | 'departamento'
  | 'local'
  | 'oficina'
  | 'terreno';

// ---------------------------------------------------------------------------
// Estado del wizard (acumulado a través de los 5 pasos)
// ---------------------------------------------------------------------------

export interface PublishFormState {
  // Step 1 — tipo de operación
  operation_type: OperationType | null;
  // Step 2 — tipo de propiedad
  property_type: PropertyType | null;

  // Step 3 (73.3) — detalles obligatorios: precio, dirección y ubicación
  price: number | null;
  /** Moneda de `price` — quick fix 2026-08-15, default 'MXN' (mismo default que la columna). */
  currency: Currency;
  bedrooms: number | null;
  bathrooms: number | null;
  /** Medios baños — quick fix 2026-08-15, opcional, a lado de bathrooms. */
  half_bathrooms: number | null;
  /** Superficie de TERRENO (m²) — desde 2026-08-15 separada de built_square_meters. */
  square_meters: number | null;
  /** Superficie CONSTRUIDA (m²) — quick fix 2026-08-15, opcional, a lado de square_meters. */
  built_square_meters: number | null;
  address: string;
  lat: number | null;
  lng: number | null;
  /** Toggle "ocultar precio" — sin validación de requerido, default true (columna DB properties.price_visible). */
  price_visible: boolean;

  // Step 4 (73.3) — detalles opcionales
  pet_friendly: boolean;
  allows_no_guarantor: boolean;
  student_friendly: boolean;
  description: string;

  // Step 5 (73.3, era step 3) — video
  video_id: string | null;       // UUID generado en cliente antes de subir
  storage_path: string | null;   // ruta en Supabase Storage tras upload (flujo legado)
  cloudflare_uid: string | null; // uid de Cloudflare Stream devuelto por mint-upload-url (68.4)
  video_local_uri: string | null; // URI local para preview antes de subir
  // 68.7: estado y duración del video linkeado — solo se pueblan en edit mode
  // (useLoadProperty) para decidir si la sección "Portada" (ThumbnailPicker) se
  // puede mostrar (video 'ready') y para armar la URL del frame (?time=).
  video_status: string | null;             // status de property_videos ('processing'|'ready'|'failed'|'archived')
  video_duration_seconds: number | null;   // property_videos.duration_seconds (poblada por el webhook 68.5)
  video_thumbnail_pct: number | null;      // property_videos.thumbnail_pct — null hasta la 1a elección (default 50 en render)

  // Modo edición — propagado desde publish/_layout, inmune a pérdida de URL param
  edit_mode: boolean;            // true si se edita una property existente (UPDATE, no EF)
  property_id: string | null;    // id de la property a actualizar en modo edición
}

// ---------------------------------------------------------------------------
// Payload que se envía a la Edge Function publish-property
// ---------------------------------------------------------------------------

export interface PublishFormPayload {
  operation_type: OperationType;
  property_type: PropertyType;
  price: number;
  currency: Currency;
  bedrooms: number | null;
  bathrooms: number | null;
  half_bathrooms: number | null;
  square_meters: number | null;
  built_square_meters: number | null;
  address: string;
  lat: number;
  lng: number;
  price_visible: boolean;
  pet_friendly: boolean;
  allows_no_guarantor: boolean;
  student_friendly: boolean;
  description: string;
  cloudflare_uid: string;
}

// ---------------------------------------------------------------------------
// Estado inicial (exportado para usar también en reset)
// ---------------------------------------------------------------------------

export const INITIAL_PUBLISH_FORM_STATE: PublishFormState = {
  operation_type: null,
  property_type: null,
  price: null,
  currency: 'MXN',
  bedrooms: null,
  bathrooms: null,
  half_bathrooms: null,
  square_meters: null,
  built_square_meters: null,
  address: '',
  lat: null,
  lng: null,
  price_visible: true,
  pet_friendly: false,
  allows_no_guarantor: false,
  student_friendly: false,
  description: '',
  video_id: null,
  storage_path: null,
  cloudflare_uid: null,
  video_local_uri: null,
  video_status: null,
  video_duration_seconds: null,
  video_thumbnail_pct: null,
  edit_mode: false,
  property_id: null,
};
