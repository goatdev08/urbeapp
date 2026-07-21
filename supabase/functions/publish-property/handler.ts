// supabase/functions/publish-property/handler.ts
// Handler PURO con dependencias inyectables (DI). No importa supabase-js — eso vive
// en index.ts (entry de producción). Esto mantiene los tests rápidos y offline.
//
// Orquestación:
//   1. CORS preflight (OPTIONS → 200)
//   2. Solo POST (otros métodos → 405)
//   3. Parsear JSON body → 400 INVALID_INPUT si falla
//   4. Validar payload → 400 INVALID_INPUT si falla
//   5. callerVerifier.verify_caller(authHeader) → 401/403 si falla
//   6. propertyPublisher.publish(params con property_status='active', video_status='ready')
//   7. Si publish falla → 500 propagado limpio
//   8. Si publish ok → 201 { property_id }

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import type {
  OperationType,
  PropertyType,
  PublishPropertyDeps,
  PublishPropertyInput,
} from "./types.ts";

// ── Enums del dominio (para validación en memoria, sin DB) ─────────────────────

const OPERATION_TYPES = new Set<string>(["rent", "sale", "both"]);
const PROPERTY_TYPES = new Set<string>([
  "casa",
  "departamento",
  "local",
  "oficina",
  "terreno",
]);

// ── Validación del payload ─────────────────────────────────────────────────────

type ParseResult =
  | { success: true; data: PublishPropertyInput }
  | { success: false; error: { code: string; message: string } };

function invalid(message: string): ParseResult {
  return { success: false, error: { code: "INVALID_INPUT", message } };
}

function parse_publish_property_input(raw: unknown): ParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return invalid("El payload debe ser un objeto JSON");
  }

  const obj = raw as Record<string, unknown>;

  // operation_type: enum ('rent'|'sale'|'both')
  if (obj.operation_type === undefined || obj.operation_type === null) {
    return invalid("operation_type es requerido");
  }
  if (
    typeof obj.operation_type !== "string" ||
    !OPERATION_TYPES.has(obj.operation_type)
  ) {
    return invalid("operation_type debe ser 'rent', 'sale' o 'both'");
  }

  // property_type: enum ('casa'|'departamento'|'local'|'oficina'|'terreno')
  if (obj.property_type === undefined || obj.property_type === null) {
    return invalid("property_type es requerido");
  }
  if (
    typeof obj.property_type !== "string" ||
    !PROPERTY_TYPES.has(obj.property_type)
  ) {
    return invalid(
      "property_type debe ser 'casa', 'departamento', 'local', 'oficina' o 'terreno'",
    );
  }

  // price: número > 0 (PRD §12)
  if (obj.price === undefined || obj.price === null) {
    return invalid("price es requerido");
  }
  if (typeof obj.price !== "number" || obj.price <= 0) {
    return invalid("price debe ser un número mayor a 0");
  }

  // address: string no vacío (ni solo espacios)
  if (obj.address === undefined || obj.address === null) {
    return invalid("address es requerido");
  }
  if (
    typeof obj.address !== "string" ||
    obj.address.trim().length === 0
  ) {
    return invalid("address no puede ser vacío");
  }

  // lat: número requerido para ST_Point
  if (obj.lat === undefined || obj.lat === null) {
    return invalid("lat es requerido");
  }
  if (typeof obj.lat !== "number") {
    return invalid("lat debe ser un número");
  }

  // lng: número requerido para ST_Point
  if (obj.lng === undefined || obj.lng === null) {
    return invalid("lng es requerido");
  }
  if (typeof obj.lng !== "number") {
    return invalid("lng debe ser un número");
  }

  // video_id: string no vacío (UUID generado por el cliente, PRD §13)
  if (obj.video_id === undefined || obj.video_id === null) {
    return invalid("video_id es requerido");
  }
  if (typeof obj.video_id !== "string" || obj.video_id.trim().length === 0) {
    return invalid("video_id no puede ser vacío");
  }

  // storage_path: string no vacío (objeto ya subido al bucket property-videos)
  if (obj.storage_path === undefined || obj.storage_path === null) {
    return invalid("storage_path es requerido");
  }
  if (
    typeof obj.storage_path !== "string" ||
    obj.storage_path.trim().length === 0
  ) {
    return invalid("storage_path no puede ser vacío");
  }

  return {
    success: true,
    data: {
      operation_type: obj.operation_type as OperationType,
      property_type: obj.property_type as PropertyType,
      price: obj.price,
      bedrooms: typeof obj.bedrooms === "number" ? obj.bedrooms : null,
      bathrooms: typeof obj.bathrooms === "number" ? obj.bathrooms : null,
      square_meters: typeof obj.square_meters === "number"
        ? obj.square_meters
        : null,
      address: obj.address,
      lat: obj.lat,
      lng: obj.lng,
      pet_friendly: obj.pet_friendly === true,
      allows_no_guarantor: obj.allows_no_guarantor === true,
      student_friendly: obj.student_friendly === true,
      description: typeof obj.description === "string" ? obj.description : "",
      // ponytail (68.12, RED): pass-through mínimo sin validar requeridad —
      // la validación real de cloudflare_uid es responsabilidad del GREEN.
      cloudflare_uid: typeof obj.cloudflare_uid === "string"
        ? obj.cloudflare_uid
        : "",
    },
  };
}

// ── Handler exportado (usado directamente por los tests) ───────────────────────

export async function handler(
  req: Request,
  deps?: PublishPropertyDeps,
): Promise<Response> {
  // 1. CORS preflight
  if (req.method === "OPTIONS") {
    return handle_cors_preflight(req);
  }

  // 2. Solo POST permitido
  if (req.method !== "POST") {
    return error_response("METHOD_NOT_ALLOWED", "Método no permitido", 405);
  }

  // 3. Parse JSON body
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error_response(
      "INVALID_INPUT",
      "El cuerpo de la petición no es JSON válido",
      400,
    );
  }

  // 4. Validar payload
  const parsed = parse_publish_property_input(raw);
  if (!parsed.success) {
    return error_response(parsed.error.code, parsed.error.message, 400);
  }

  const input = parsed.data;

  // 5. Verificar caller: JWT + role IN ('agent', 'admin')
  const authHeader = req.headers.get("Authorization");
  const verifyResult = await deps!.callerVerifier.verify_caller(authHeader);
  if (!verifyResult.ok) {
    const status = verifyResult.error_code === "UNAUTHENTICATED" ? 401 : 403;
    const message =
      verifyResult.error_code === "UNAUTHENTICATED"
        ? "Se requiere autenticación"
        : "Acceso denegado: se requiere rol de agente o administrador";
    return error_response(verifyResult.error_code, message, status);
  }

  // 6. Publicar propiedad + video atómicamente (RPC en GREEN)
  // El handler fija property_status='active' y video_status='ready' explícitamente
  // para que el contrato sea verificable en tests sin inspeccionar la DB.
  const publishResult = await deps!.propertyPublisher.publish({
    user_id: verifyResult.user_id,
    operation_type: input.operation_type,
    property_type: input.property_type,
    price: input.price,
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    square_meters: input.square_meters,
    address: input.address,
    lat: input.lat,
    lng: input.lng,
    pet_friendly: input.pet_friendly,
    allows_no_guarantor: input.allows_no_guarantor,
    student_friendly: input.student_friendly,
    description: input.description,
    property_status: "active",
    video_status: "ready",
    cloudflare_uid: input.cloudflare_uid,
  });

  if (!publishResult.ok) {
    return error_response(
      publishResult.error_code,
      publishResult.message ?? "Error al publicar la propiedad",
      500,
    );
  }

  // 7. Éxito: propiedad publicada
  return json_response({ property_id: publishResult.property_id }, 201);
}
