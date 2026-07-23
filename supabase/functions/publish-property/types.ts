// supabase/functions/publish-property/types.ts
// Tipos y contratos de DI para el handler de publicación de propiedades.
// Solo interfaces; sin imports de supabase-js (que vive en _shared/clients.ts).

// ── Enums del dominio ─────────────────────────────────────────────────────────

export type OperationType = "rent" | "sale" | "both";
export type PropertyType =
  | "casa"
  | "departamento"
  | "local"
  | "oficina"
  | "terreno";

// ── Input validado ────────────────────────────────────────────────────────────

/**
 * Payload del wizard de publicación de propiedades.
 * Resultado de parse_publish_property_input() cuando success: true.
 */
export interface PublishPropertyInput {
  // step1
  operation_type: OperationType;
  property_type: PropertyType;
  // step2
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
  // video (68.12 — upload-first: cloudflare_uid reemplaza video_id + storage_path;
  // el video ya fue subido a Cloudflare Stream ANTES de existir la propiedad y
  // solo se ENLAZA — ver publish_property_atomic en supabase/migrations).
  cloudflare_uid: string;
}

// ── CallerVerifier ────────────────────────────────────────────────────────────
//
// Verifica que el JWT pertenece a un usuario con role IN ('agent', 'admin').
// Distinto de AdminVerifier (que requiere exactamente 'admin').
// UNAUTHENTICATED: sin JWT o JWT inválido → 401
// FORBIDDEN:       role = 'user' (no agente ni admin) → 403

export type CallerVerifyResult =
  | { ok: true; user_id: string }
  | { ok: false; error_code: "UNAUTHENTICATED" | "FORBIDDEN" };

export interface CallerVerifier {
  verify_caller(authHeader: string | null): Promise<CallerVerifyResult>;
}

// ── PropertyPublisher ─────────────────────────────────────────────────────────
//
// Inserta la propiedad + el video de forma atómica (vía RPC publish_property_atomic).
// El handler le pasa property_status='active' y video_status='ready' explícitamente
// para que el contrato sea verificable en tests sin inspeccionar la DB.

export interface PropertyPublishParams {
  // identidad del publicante
  user_id: string;
  // campos de properties
  operation_type: string;
  property_type: string;
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
  // Estado explícito (contrato testeable): el handler siempre pasa estos valores.
  property_status: "active";
  video_status: "ready";
  // referencia al video en vuelo a ENLAZAR (68.12 — reemplaza video_id/storage_path)
  cloudflare_uid: string;
}

export type PropertyPublishResult =
  | { ok: true; property_id: string }
  | { ok: false; error_code: string; message?: string };

export interface PropertyPublisher {
  publish(params: PropertyPublishParams): Promise<PropertyPublishResult>;
}

// ── Deps inyectables del handler ──────────────────────────────────────────────

export interface PublishPropertyDeps {
  callerVerifier: CallerVerifier;
  propertyPublisher: PropertyPublisher;
}
