// supabase/functions/update-property-status/types.ts
// Tipos y contratos de DI para la Edge Function update-property-status.
// Solo interfaces; sin imports de supabase-js (que vive en _shared/clients.ts).
//
// Separación de responsabilidades:
//   - Handler: parse input, validación en-memoria (new_status enum, closed_reason invariante).
//   - PropertyStatusUpdater: existencia de propiedad, ownership, validación de transición, UPDATE.

// ── Enums del dominio ─────────────────────────────────────────────────────────
//
// PropertyStatusEnum = espejo 1:1 del enum property_status en DB (17 valores,
// 20260604000001 + 20260809000002). Al tiparse VALID_TRANSITIONS como
// Record<PropertyStatusEnum, …>, agregar un valor al enum SIN decidir su fila
// rompe la compilación (#128) — antes fallaba en runtime vía `?.` silencioso.
//
// PropertyStatusTarget = subconjunto que el CLIENTE puede pedir como new_status.
// pending_review, needs_changes, suspended, rejected → los fija moderación (EF distinta).
// uploading_media, media_failed, pending_payment → los fija el pipeline de media/pago.
// approved → lo fija la EF de aprobación; aquí solo aparece como estado ORIGEN.
// Cierre y baja (§16, 73.8): rented/sold son new_status DIRECTO (no closed+closed_reason) —
// el status ya es autodescriptivo. El camino viejo closed+closed_reason (withdrawn/expired)
// sigue vivo para no-regresión, ver ClosedReasonEnum.

export type PropertyStatusEnum =
  | "draft"
  | "pending_review"
  | "needs_changes"
  | "active"
  | "paused"
  | "closed"
  | "suspended"
  | "uploading_media"
  | "media_failed"
  | "pending_payment"
  | "approved"
  | "expired"
  | "rented"
  | "sold"
  | "rejected"
  | "deleted_soft"
  | "deleted_hard";

export type PropertyStatusTarget =
  | "draft"
  | "active"
  | "paused"
  | "closed"
  | "rented"
  | "sold";
export type ClosedReasonEnum = "rented" | "sold" | "withdrawn" | "expired";

// ── Input validado ────────────────────────────────────────────────────────────

export interface UpdatePropertyStatusInput {
  property_id: string; // UUID (string no vacío; la DB valida que sea UUID)
  new_status: PropertyStatusTarget;
  closed_reason: ClosedReasonEnum | null; // requerido si new_status='closed' (invariante 🔒)
}

// ── CallerVerifier ────────────────────────────────────────────────────────────
//
// Verifica que el JWT pertenece a un usuario autenticado y devuelve user_id.
// No verifica rol — la propiedad puede ser actualizada por su dueño (owner_user_id),
// sin importar si es agent o admin (la EF no gate-ea rol, solo ownership).
// UNAUTHENTICATED: sin JWT o JWT inválido → 401.

export type CallerVerifyResult =
  | { ok: true; user_id: string }
  | { ok: false; error_code: "UNAUTHENTICATED" };

export interface CallerVerifier {
  verify_caller(authHeader: string | null): Promise<CallerVerifyResult>;
}

// ── PropertyStatusUpdater ─────────────────────────────────────────────────────
//
// Responsabilidades (todo en una sola llamada para minimizar round-trips):
//   1. Buscar la propiedad (existence check).
//   2. Validar ownership: properties.owner_user_id = user_id.
//   3. Validar transición de estado (reglas de dominio vs. current_status en DB).
//   4. Aplicar UPDATE (status, closed_reason si new_status='closed').
//   5. Retornar la propiedad actualizada.
//
// Transiciones válidas (la tabla completa de 17 orígenes vive en VALID_TRANSITIONS,
// property_status_updater.ts — cada valor del enum tiene fila explícita, #128):
//   draft     → active (vigente; #131 decidirá si muere — bypass de moderación)
//   active    → paused | closed (closed exige closed_reason) | rented | sold
//   paused    → active | closed (closed exige closed_reason) | rented | sold
//   approved  → rented | sold
//   resto     → (ninguna): moderación/pipeline/pago los mueven sus EFs; terminales
//               sin reapertura en MVP (PRD §16.1)
//
// Error codes:
//   PROPERTY_NOT_FOUND   → handler devuelve 404
//   UNAUTHORIZED_OWNER   → handler devuelve 403 (el caller no es el dueño)
//   INVALID_TRANSITION   → handler devuelve 400 (transición no permitida)
//   DB_ERROR             → handler devuelve 500

export interface UpdatePropertyStatusParams {
  user_id: string;
  property_id: string;
  new_status: PropertyStatusTarget;
  closed_reason: ClosedReasonEnum | null;
}

export interface UpdatedProperty {
  id: string;
  status: PropertyStatusEnum;
  closed_reason: ClosedReasonEnum | null;
}

export type UpdatePropertyStatusResult =
  | { ok: true; property: UpdatedProperty }
  | {
    ok: false;
    error_code:
      | "PROPERTY_NOT_FOUND"
      | "UNAUTHORIZED_OWNER"
      | "INVALID_TRANSITION"
      | "DB_ERROR";
    message?: string;
  };

export interface PropertyStatusUpdater {
  update(
    params: UpdatePropertyStatusParams,
  ): Promise<UpdatePropertyStatusResult>;
}

// ── Deps inyectables del handler ──────────────────────────────────────────────

export interface UpdatePropertyStatusDeps {
  callerVerifier: CallerVerifier;
  propertyStatusUpdater: PropertyStatusUpdater;
}
