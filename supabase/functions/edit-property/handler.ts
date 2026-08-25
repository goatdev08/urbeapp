// supabase/functions/edit-property/handler.ts
// Handler PURO con dependencias inyectables (DI). No importa supabase-js — eso vive
// en index.ts (entry de producción). Esto mantiene los tests rápidos y offline.
//
// Orquestación (PRD §15.5/§15.6 — reemplaza el UPDATE directo por RLS que
// usePublish.ts hacía en editMode, decisión de #53):
//   1. CORS preflight (OPTIONS → 200)
//   2. Solo POST (otros métodos → 405)
//   3. Parsear JSON body → 400 INVALID_INPUT si falla
//   4. Validar payload en-memoria → 400 INVALID_INPUT si falla
//   5. callerVerifier.verify_caller(authHeader) → 401 si falla
//   6. propertyFetcher.fetch(property_id) → 404/500 si falla
//   7. Ownership: owner_user_id del snapshot === caller, O caller es admin → 403 si no
//   8. Diff campo-a-campo (§15.5) contra el snapshot actual:
//      - AL MENOS un campo crítico cambió → revisionUpserter.upsert(...) con el
//        payload COMPLETO como changed_fields; current_published NUNCA se toca.
//      - Nada crítico cambió → directPropertyUpdater.apply(...) con el payload
//        completo.
//   9. Mapear resultado del seam invocado a HTTP (500 en DB_ERROR, 200 en éxito)

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import { location_changed } from "./location.ts";
import type {
  CurrentPropertySnapshot,
  EditPropertyDeps,
  EditPropertyInput,
  OperationType,
  PropertyType,
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
const CURRENCIES = new Set<string>(["MXN", "USD"]);

// ── Validación del payload ─────────────────────────────────────────────────────

type ParseResult =
  | { success: true; data: EditPropertyInput }
  | { success: false; error: { code: string; message: string } };

function invalid(message: string): ParseResult {
  return { success: false, error: { code: "INVALID_INPUT", message } };
}

function parse_edit_property_input(raw: unknown): ParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return invalid("El payload debe ser un objeto JSON");
  }

  const obj = raw as Record<string, unknown>;

  // property_id: string no vacío
  if (
    typeof obj.property_id !== "string" ||
    obj.property_id.trim() === ""
  ) {
    return invalid("property_id es requerido y no puede ser vacío");
  }

  // operation_type: enum
  if (
    typeof obj.operation_type !== "string" ||
    !OPERATION_TYPES.has(obj.operation_type)
  ) {
    return invalid("operation_type debe ser 'rent', 'sale' o 'both'");
  }

  // property_type: enum
  if (
    typeof obj.property_type !== "string" ||
    !PROPERTY_TYPES.has(obj.property_type)
  ) {
    return invalid(
      "property_type debe ser 'casa', 'departamento', 'local', 'oficina' o 'terreno'",
    );
  }

  // price: número > 0
  if (typeof obj.price !== "number" || obj.price <= 0) {
    return invalid("price debe ser un número mayor a 0");
  }

  // address: string no vacío (ni solo espacios)
  if (typeof obj.address !== "string" || obj.address.trim().length === 0) {
    return invalid("address no puede ser vacío");
  }

  // #142 — el body debe ser COMPLETO (el móvil siempre manda todas las claves
  // editables). Antes, todo campo ausente se coaccionaba a un default falsy
  // (booleans→false, description→'', numéricos→null): un body parcial — caller
  // alterno, app vieja tras un OTA, retry — borraba amenidades y recámaras en
  // silencio, y la description '' encima se diffeaba como cambio crítico y
  // mandaba a revisión una publicación correcta. Parcial => 400, fail loud.

  // Booleans: requeridos y de tipo boolean estricto (nada de 'false' string).
  for (
    const campo of [
      "price_visible",
      "pet_friendly",
      "allows_no_guarantor",
      "student_friendly",
    ] as const
  ) {
    if (typeof obj[campo] !== "boolean") {
      return invalid(
        `${campo} es requerido y debe ser booleano — un body parcial no debe borrar campos`,
      );
    }
  }

  // Numéricos anulables: la CLAVE debe venir; null explícito = borrar a
  // propósito (permitido), clave ausente = body parcial (rechazado).
  for (const campo of ["bedrooms", "bathrooms", "square_meters"] as const) {
    if (!(campo in obj) || obj[campo] === undefined) {
      return invalid(
        `${campo} es requerido (usa null explícito para borrar el dato) — un body parcial no debe borrar campos`,
      );
    }
    if (obj[campo] !== null && typeof obj[campo] !== "number") {
      return invalid(`${campo} debe ser número o null`);
    }
  }

  // description: requerida como string; '' explícito = borrarla a propósito
  // (cambio crítico §15.5 → revisión), ausente = body parcial.
  if (typeof obj.description !== "string") {
    return invalid(
      "description es requerida (usa '' explícito para borrarla) — un body parcial no debe borrar campos",
    );
  }

  const data: EditPropertyInput = {
    property_id: obj.property_id,
    operation_type: obj.operation_type as OperationType,
    property_type: obj.property_type as PropertyType,
    price: obj.price,
    bedrooms: obj.bedrooms as number | null,
    bathrooms: obj.bathrooms as number | null,
    square_meters: obj.square_meters as number | null,
    address: obj.address,
    // casts seguros: tipo y presencia validados arriba (los loops no narrowean)
    price_visible: obj.price_visible as boolean,
    pet_friendly: obj.pet_friendly as boolean,
    allows_no_guarantor: obj.allows_no_guarantor as boolean,
    student_friendly: obj.student_friendly as boolean,
    description: obj.description,
  };

  // location: OPCIONAL — ausente = "el usuario no tocó el mapa" (no se evalúa).
  if (typeof obj.location === "string") {
    data.location = obj.location;
  }

  // Quick fixes wizard paso 3 (2026-08-15): built_square_meters/half_bathrooms/
  // currency son OPCIONALES (backward-compat con clientes viejos — ver types.ts).
  // Presente (número o null explícito) → se incluye; ausente → se omite (no se
  // fuerza a null, a diferencia de bedrooms/bathrooms/square_meters de #142).
  if ("built_square_meters" in obj) {
    if (obj.built_square_meters !== null && typeof obj.built_square_meters !== "number") {
      return invalid("built_square_meters debe ser número o null");
    }
    data.built_square_meters = obj.built_square_meters as number | null;
  }
  if ("half_bathrooms" in obj) {
    if (obj.half_bathrooms !== null && typeof obj.half_bathrooms !== "number") {
      return invalid("half_bathrooms debe ser número o null");
    }
    data.half_bathrooms = obj.half_bathrooms as number | null;
  }
  if (obj.currency !== undefined && obj.currency !== null) {
    if (typeof obj.currency !== "string" || !CURRENCIES.has(obj.currency)) {
      return invalid("currency debe ser 'MXN' o 'USD'");
    }
    data.currency = obj.currency as "MXN" | "USD";
  }

  return { success: true, data };
}

// ── Diff §15.5 ───────────────────────────────────────────────────────────────

function normalize_address(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * PRD §15.5: dirección/coordenadas, operación, tipo, precio y descripción
 * disparan re-revisión si cambian; el resto (visibilidad de precio, recámaras/
 * baños/m², amenidades) aplica directo sin importar cuánto cambien.
 */
function has_critical_change(
  input: EditPropertyInput,
  current: CurrentPropertySnapshot,
): boolean {
  if (input.operation_type !== current.operation_type) return true;
  if (input.property_type !== current.property_type) return true;
  if (
    normalize_address(input.address) !== normalize_address(current.address)
  ) {
    return true;
  }
  if (location_changed(input.location, current.location)) return true;
  if (input.price !== current.price) return true; // comparación exacta
  if (input.description !== current.description) return true;
  return false;
}

// ── Handler exportado ─────────────────────────────────────────────────────────

export async function handler(
  req: Request,
  deps?: EditPropertyDeps,
): Promise<Response> {
  // 1. CORS preflight
  if (req.method === "OPTIONS") {
    return handle_cors_preflight(req);
  }

  // 2. Solo POST
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

  // 4. Validar payload en-memoria
  const parsed = parse_edit_property_input(raw);
  if (!parsed.success) {
    return error_response(parsed.error.code, parsed.error.message, 400);
  }
  const input = parsed.data;

  // 5. Verificar caller (JWT)
  const authHeader = req.headers.get("Authorization");
  const verifyResult = await deps!.callerVerifier.verify_caller(authHeader);
  if (!verifyResult.ok) {
    return error_response("UNAUTHENTICATED", "Se requiere autenticación", 401);
  }

  // 6. Traer el snapshot actual (current_published) — existencia + campos del diff
  const fetchResult = await deps!.propertyFetcher.fetch(input.property_id);
  if (!fetchResult.ok) {
    if (fetchResult.error_code === "PROPERTY_NOT_FOUND") {
      return error_response(
        "PROPERTY_NOT_FOUND",
        fetchResult.message ?? "Propiedad no encontrada",
        404,
      );
    }
    return error_response(
      "DB_ERROR",
      fetchResult.message ?? "Error de base de datos",
      500,
    );
  }
  const current = fetchResult.property;

  // 7. Autorización: mismo criterio que la RLS properties_update que esta EF
  //    reemplaza (20260805000011): owner ∨ admin de plataforma ∨ owner/admin
  //    ACTIVO de la agencia REAL de la fila (#142 — la rama de agencia se
  //    perdió al mover la edición del UPDATE directo a esta EF, capacidad
  //    deliberada de #71).
  const is_owner = current.owner_user_id === verifyResult.user_id;
  let authorized = is_owner || verifyResult.is_admin;
  if (!authorized && current.agency_id) {
    const agency_role = await deps!.agencyRoleResolver.resolve(
      verifyResult.user_id,
      current.agency_id,
    );
    authorized = agency_role === "owner" || agency_role === "admin";
  }
  if (!authorized) {
    return error_response(
      "UNAUTHORIZED_EDITOR",
      "No autorizado: no eres el dueño de esta propiedad, ni administrador, ni owner/admin de su inmobiliaria",
      403,
    );
  }

  // 8. Diff §15.5 → ramifica a revisión (crítico) o aplicación directa
  //
  // NOTA (218.4): `input` viaja COMPLETO como `changed_fields` (abajo y en
  // directPropertyUpdater.apply) — no se construye filtrando por una lista
  // de campos editables aquí, porque `EditPropertyInput` (types.ts) YA ES
  // exactamente ese whitelist tipado: sus keys coinciden 1:1 con
  // `EDITABLE_PROPERTY_FIELDS` (_shared/property_field_whitelist.ts), que a
  // su vez es el espejo TS del whitelist real (SQL, RPC
  // moderate_property_atomic). property_field_whitelist.test.ts (EC-2)
  // verifica esa coincidencia invocando este handler — si `EditPropertyInput`
  // gana o pierde un campo sin que ambos lados se actualicen, ese test truena.
  if (has_critical_change(input, current)) {
    const upsertResult = await deps!.revisionUpserter.upsert(
      input.property_id,
      verifyResult.user_id,
      input,
    );
    if (!upsertResult.ok) {
      return error_response(
        "DB_ERROR",
        upsertResult.message ?? "Error al guardar la revisión",
        500,
      );
    }
    return json_response(
      { ok: true, mode: "revision", revision_id: upsertResult.revision_id },
      200,
    );
  }

  const updateResult = await deps!.directPropertyUpdater.apply(
    input.property_id,
    input,
  );
  if (!updateResult.ok) {
    return error_response(
      "DB_ERROR",
      updateResult.message ?? "Error al actualizar la propiedad",
      500,
    );
  }
  return json_response({ ok: true, mode: "direct" }, 200);
}
