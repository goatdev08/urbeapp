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
  // #129 — step3: toggle "Mostrar precio en el feed". Ausente en el payload →
  // true (mismo default que la columna properties.price_visible).
  price_visible: boolean;
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
  // #129: antes este campo moría aquí — el wizard lo mandaba pero ni el parser,
  // ni estos params, ni la RPC lo conocían; la fila nacía con el default true
  // aunque el agente apagara "Mostrar precio en el feed".
  price_visible: boolean;
  description: string;
  // Estado explícito (contrato testeable): el handler siempre pasa estos valores.
  // 73.4 — PRD §14.2: en beta TODA publicación va a pending_review, ya no hay
  // auto-aprobación a 'active'. El tipo queda como UNIÓN (no se angosta al
  // literal 'pending_review') a propósito: handler.ts de producción todavía
  // pasa 'active' hoy (RED — eso es lo que discrimina esta subtarea) y esto es
  // solo el contrato de tipos para que el archivo de tests compile; angostar el
  // tipo aquí rompería la compilación de handler.ts (error de TS, no de
  // aserción) e invalidaría el RED. El GREEN de 73.4 debe migrar el literal que
  // handler.ts pasa de 'active' a 'pending_review'.
  property_status: "active" | "pending_review";
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

// ── VideoStatusChecker (73.4, absorbe 73.5) ───────────────────────────────────
//
// Pipeline de moderación (PRD §15.2): antes de publicar, valida que el video
// enlazado por cloudflare_uid (del agente que publica) exista, esté listo
// (status='ready') y dure entre 60 y 120 segundos INCLUSIVE (PRD §14, paso 5).
// Implementación real (GREEN, fuera de esta fase RED): probablemente consulta
// property_videos por (cloudflare_uid, agent_id).

export type VideoStatusCheckResult =
  | { ok: true; duration_seconds: number }
  | {
    ok: false;
    error_code:
      | "VIDEO_NOT_READY"
      | "VIDEO_DURATION_INVALID"
      | "VIDEO_NOT_FOUND";
  };

export interface VideoStatusChecker {
  check(
    cloudflare_uid: string,
    agent_id: string,
  ): Promise<VideoStatusCheckResult>;
}

// ── DuplicatePropertyChecker (73.4, absorbe 73.5) ─────────────────────────────
//
// Pipeline de moderación (PRD §15.2): "evitar duplicados obvios por misma
// dirección, mismo agente". Regla exacta (spec 73.4): existe ya una propiedad
// NO borrada (deleted_at is null) del MISMO owner_user_id con la MISMA
// dirección normalizada (lower(trim(address)) — normaliza el checker, no la
// DB) y status NOT IN ('rejected','deleted_soft','deleted_hard') (una
// rechazada o eliminada no cuenta — el agente puede resubir).

export interface DuplicateCheckResult {
  isDuplicate: boolean;
}

export interface DuplicatePropertyChecker {
  check(user_id: string, address: string): Promise<DuplicateCheckResult>;
}

// ── Deps inyectables del handler ──────────────────────────────────────────────

export interface PublishPropertyDeps {
  callerVerifier: CallerVerifier;
  propertyPublisher: PropertyPublisher;
  // 73.4/73.5 — pipeline de validación ANTES de invocar el publisher: primero
  // videoStatusChecker, luego duplicatePropertyChecker. Si cualquiera falla, el
  // publisher NUNCA se invoca (no gastar el slot en una publicación rechazada).
  videoStatusChecker: VideoStatusChecker;
  duplicatePropertyChecker: DuplicatePropertyChecker;
}
