// supabase/functions/edit-property/types.ts
// Tipos y contratos de DI para la Edge Function edit-property (73.6, PRD §15.5/§15.6).
// Solo interfaces; sin imports de supabase-js (que vive en _shared/clients.ts).
//
// Reemplaza el UPDATE directo por RLS que usePublish.ts hacía en editMode
// (decisión de #53) por una EF que decide server-side, campo por campo, si la
// edición se aplica directo a `properties` (current_published) o si dispara una
// re-revisión (crea/actualiza `property_revisions`, dejando current_published
// intacta hasta que un admin apruebe — PRD §15.6).

// ── Enums del dominio (mismo subconjunto que publish-property) ────────────────

export type OperationType = "rent" | "sale" | "both";
export type PropertyType =
  | "casa"
  | "departamento"
  | "local"
  | "oficina"
  | "terreno";

// ── Input validado ────────────────────────────────────────────────────────────
//
// Mismo shape que `edit_payload` en usePublish.ts (mobile), MÁS `property_id`
// (la EF lo recibe en el body, no en la URL — ver handler.ts).
// `location`: EWKT (`SRID=4326;POINT(lng lat)`) — presente SOLO si el usuario
// cambió el pin del mapa (mismo comportamiento condicional que hoy). Ausente
// (undefined) = "no se tocan las coordenadas", no fuerza la comparación crítica.

export interface EditPropertyInput {
  property_id: string;
  operation_type: OperationType;
  property_type: PropertyType;
  price: number;
  bedrooms: number | null;
  bathrooms: number | null;
  square_meters: number | null;
  address: string;
  location?: string;
  price_visible: boolean;
  pet_friendly: boolean;
  allows_no_guarantor: boolean;
  student_friendly: boolean;
  description: string;
}

// ── CallerVerifier ────────────────────────────────────────────────────────────
//
// Verifica que el JWT pertenece a un usuario autenticado. `is_admin` viene del
// verificador (rol del JWT/DB) porque el criterio de autorización de esta EF
// es "owner de la propiedad O admin" (mismo criterio que la RLS properties_update
// que esta EF reemplaza) — el handler necesita ambos datos (user_id + is_admin)
// para decidir junto con el owner_user_id que trae PropertyFetcher.
// UNAUTHENTICATED: sin JWT o JWT inválido → 401.

export type CallerVerifyResult =
  | { ok: true; user_id: string; is_admin: boolean }
  | { ok: false; error_code: "UNAUTHENTICATED" };

export interface CallerVerifier {
  verify_caller(authHeader: string | null): Promise<CallerVerifyResult>;
}

// ── PropertyFetcher ───────────────────────────────────────────────────────────
//
// Trae el snapshot ACTUAL (current_published) de los campos relevantes para:
//   1. Ownership (owner_user_id, comparado contra el caller o is_admin).
//   2. El diff campo-a-campo contra el payload recibido (§15.5).
// Solo se listan los campos que participan en el diff crítico + owner_user_id;
// NO es un espejo completo de la fila (los no-críticos nunca se comparan,
// siempre se aplican directo si nada crítico cambió).

export interface CurrentPropertySnapshot {
  id: string;
  owner_user_id: string;
  operation_type: string;
  property_type: string;
  price: number;
  address: string;
  location: string | null;
  description: string;
}

export type PropertyFetchResult =
  | { ok: true; property: CurrentPropertySnapshot }
  | {
    ok: false;
    error_code: "PROPERTY_NOT_FOUND" | "DB_ERROR";
    message?: string;
  };

export interface PropertyFetcher {
  fetch(property_id: string): Promise<PropertyFetchResult>;
}

// ── DirectPropertyUpdater ─────────────────────────────────────────────────────
//
// Camino "sin re-revisión": ningún campo crítico cambió. Aplica TODO el payload
// (críticos que no cambiaron + no-críticos) de una sola vez a `properties`.

export type DirectUpdateResult =
  | { ok: true }
  | { ok: false; error_code: "DB_ERROR"; message?: string };

export interface DirectPropertyUpdater {
  apply(property_id: string, input: EditPropertyInput): Promise<DirectUpdateResult>;
}

// ── RevisionUpserter ──────────────────────────────────────────────────────────
//
// Camino "con re-revisión" (PRD §15.6): AL MENOS un campo crítico cambió.
// `changed_fields` = snapshot COMPLETO del payload recibido (críticos y
// no-críticos juntos — se aplican todos al aprobar, no se separan).
// Upsert (73.2, índice único parcial: máx 1 revisión pending/needs_changes
// activa por propiedad): si ya existe una fila activa, la actualiza (mismo id,
// no crea una segunda) y la regresa a 'pending' si estaba en 'needs_changes'.
// Si no existe (o la única existente está approved/rejected), inserta una nueva
// fila en 'pending'.

export type RevisionUpsertResult =
  | { ok: true; revision_id: string }
  | { ok: false; error_code: "DB_ERROR"; message?: string };

export interface RevisionUpserter {
  upsert(
    property_id: string,
    submitted_by: string,
    changed_fields: EditPropertyInput,
  ): Promise<RevisionUpsertResult>;
}

// ── Deps inyectables del handler ──────────────────────────────────────────────

export interface EditPropertyDeps {
  callerVerifier: CallerVerifier;
  propertyFetcher: PropertyFetcher;
  directPropertyUpdater: DirectPropertyUpdater;
  revisionUpserter: RevisionUpserter;
}

// ── Respuesta de éxito (contrato observable por el cliente — usePublish.ts) ───

export type EditPropertySuccessBody =
  | { ok: true; mode: "direct" }
  | { ok: true; mode: "revision"; revision_id: string };
