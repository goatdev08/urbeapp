/**
 * types.ts — shape del estado del wizard de publicación (3 pasos).
 *
 * Alineado al esquema de DB (supabase/migrations/0001):
 *   - operation_type: enum ('rent', 'sale', 'both')
 *   - property_type:  enum ('casa', 'departamento', 'local', 'oficina', 'terreno')
 *
 * ponytail: solo los campos que el wizard recolecta; sin lógica ni estado de UI.
 */

// ---------------------------------------------------------------------------
// Enums de DB (valores reales — verificados contra migration 0001)
// ---------------------------------------------------------------------------

export type OperationType = 'rent' | 'sale' | 'both';

export type PropertyType =
  | 'casa'
  | 'departamento'
  | 'local'
  | 'oficina'
  | 'terreno';

// ---------------------------------------------------------------------------
// Estado del wizard (acumulado a través de los 3 pasos)
// ---------------------------------------------------------------------------

export interface PublishFormState {
  // Step 1 — tipo de operación y propiedad
  operation_type: OperationType | null;
  property_type: PropertyType | null;

  // Step 2 — detalles y ubicación
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_meters: number | null;
  address: string;
  lat: number | null;
  lng: number | null;
  pet_friendly: boolean;
  allows_no_guarantor: boolean;
  student_friendly: boolean;
  description: string;

  // Step 3 — video
  video_id: string | null;       // UUID generado en cliente antes de subir
  storage_path: string | null;   // ruta en Supabase Storage tras upload
  video_local_uri: string | null; // URI local para preview antes de subir
}

// ---------------------------------------------------------------------------
// Payload que se envía a la Edge Function publish-property
// ---------------------------------------------------------------------------

export interface PublishFormPayload {
  operation_type: OperationType;
  property_type: PropertyType;
  price: number;
  bedrooms: number | null;
  bathrooms: number | null;
  square_meters: number | null;
  address: string;
  lat: number;
  lng: number;
  pet_friendly: boolean;
  allows_no_guarantor: boolean;
  student_friendly: boolean;
  description: string;
  video_id: string;
  storage_path: string;
}

// ---------------------------------------------------------------------------
// Estado inicial (exportado para usar también en reset)
// ---------------------------------------------------------------------------

export const INITIAL_PUBLISH_FORM_STATE: PublishFormState = {
  operation_type: null,
  property_type: null,
  price: null,
  bedrooms: null,
  bathrooms: null,
  square_meters: null,
  address: '',
  lat: null,
  lng: null,
  pet_friendly: false,
  allows_no_guarantor: false,
  student_friendly: false,
  description: '',
  video_id: null,
  storage_path: null,
  video_local_uri: null,
};
