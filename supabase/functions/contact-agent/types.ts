// supabase/functions/contact-agent/types.ts
// Tipos e interfaces DI para la Edge Function contact-agent.
// Solo interfaces; sin imports de supabase-js (que vive en _shared/clients.ts).
//
// Responsabilidades del skeleton (14.2):
//   - CallerVerifier: JWT obligatorio; 401 si falta o es inválido.
//   - ContactAgentInput: { propertyId: string (UUID) }; 400 si falta o no es UUID.
//   - Subtareas 14.3-14.6 añadirán más deps (property resolver, lead writer, etc.).

// ── Input validado ─────────────────────────────────────────────────────────────

export interface ContactAgentInput {
  propertyId: string; // UUID obligatorio; validado manualmente (sin Zod, ponytail:)
}

// ── CallerVerifier ─────────────────────────────────────────────────────────────
//
// Verifica que el JWT pertenece a un usuario autenticado y devuelve user_id.
// Solo usuarios logueados pueden contactar agentes (RLS también lo exige).
// UNAUTHENTICATED: sin JWT o JWT inválido → 401.

export type CallerVerifyResult =
  | { ok: true; user_id: string }
  | { ok: false; error_code: "UNAUTHENTICATED" };

export interface CallerVerifier {
  verify_caller(authHeader: string | null): Promise<CallerVerifyResult>;
}

// ── PropertyWithAgent ─────────────────────────────────────────────────────────
//
// Forma de la fila devuelta por el JOIN properties ⋈ users (owner).
// Columnas mínimas para contact-agent: id, address, price, status, agente.
// El resolver usa el hint PostgREST users!properties_owner_user_id_fkey
// para desambiguar la FK (análogo a usePropertyDetail.ts:115).

export interface PropertyWithAgent {
  id: string;
  address: string;
  price: number; // MXN pesos — ej. $1,650,000.00 → 1_650_000
  status: string; // 'active' | 'draft' | 'paused' | 'closed' | etc.
  owner_user_id: string;
  agent_id: string; // = owner_user_id (alias explícito; el resolver los normaliza)
  agent_phone: string | null; // NULL si el agente no tiene teléfono registrado
  video_id?: string; // UUID del property_video principal; undefined si sin video
}

// ── PropertyResolveResult ─────────────────────────────────────────────────────
//
// PROPERTY_NOT_FOUND: propiedad no existe o deleted_at IS NOT NULL.
// DB_ERROR: falla de infraestructura (timeout, constraint, etc.).

export type PropertyResolveResult =
  | { ok: true; data: PropertyWithAgent }
  | { ok: false; error_code: "PROPERTY_NOT_FOUND" | "DB_ERROR" };

// ── PropertyResolver ──────────────────────────────────────────────────────────
//
// DI port — obtiene propiedad + agente dueño (JOIN con disambiguación de FK).
// Consulta equivalente (en el adapter real, creado en 14.3 GREEN):
//   SELECT p.id, p.address, p.price, p.status, p.owner_user_id,
//          u.id AS agent_id, u.phone AS agent_phone
//   FROM properties p
//   JOIN users u ON p.owner_user_id = u.id   -- hint: users!properties_owner_user_id_fkey
//   WHERE p.id = propertyId AND p.deleted_at IS NULL
// Si la fila no aparece → { ok: false, error_code: "PROPERTY_NOT_FOUND" }.
// La validación de status y phone la hace el handler (no el resolver).

export interface PropertyResolver {
  resolve(propertyId: string): Promise<PropertyResolveResult>;
}

// ── LeadRecord ────────────────────────────────────────────────────────────────
//
// Fila mínima de `leads` que el handler necesita para continuar el flujo (14.4+).
// Los campos extra (internal_notes, last_contact_at, etc.) los gestiona 14.5/14.6.

export interface LeadRecord {
  id: string;               // UUID del lead
  status: string;           // 'new' | 'contacted' | ... (lead_status enum)
  first_contact_at: string; // ISO 8601
}

// ── LeadRepo ──────────────────────────────────────────────────────────────────
//
// Puerto DI para operaciones idempotentes sobre la tabla `leads`.
// El índice único parcial leads_agent_user_unique_active (WHERE deleted_at IS NULL)
// garantiza 1 lead activo por par (agent_id, user_id).
//
// Flujo defensivo ante race condition:
//   1. find_active_lead → si found → reusar
//   2. insert_lead → si CONFLICT_23505 → find_active_lead de nuevo
//   El handler nunca propaga un 500 por un INSERT concurrente duplicado.
//
// DB invariante: CHECK lead_agent_not_self (agent_id <> user_id).
// El handler corta el self-contact (400 CANNOT_CONTACT_SELF) ANTES de llamar
// al repo, por lo que el CHECK es una segunda capa defensiva.

export type FindActiveLeadResult =
  | { ok: true; found: true; lead: LeadRecord }
  | { ok: true; found: false }
  | { ok: false; error_code: "DB_ERROR" };

export type InsertLeadResult =
  | { ok: true; lead: LeadRecord }
  | { ok: false; error_code: "CONFLICT_23505" | "DB_ERROR" };

export interface LeadRepo {
  /**
   * SELECT id, status, first_contact_at
   * FROM leads
   * WHERE agent_id = ? AND user_id = ? AND deleted_at IS NULL
   */
  find_active_lead(agent_id: string, user_id: string): Promise<FindActiveLeadResult>;

  /**
   * INSERT INTO leads (agent_id, user_id, status, first_contact_at)
   * VALUES (?, ?, 'new', now()) RETURNING id, status, first_contact_at
   *
   * Puede devolver CONFLICT_23505 si otra request ganó la carrera.
   */
  insert_lead(agent_id: string, user_id: string): Promise<InsertLeadResult>;
}

// ── OriginRepo ─────────────────────────────────────────────────────────────────
//
// Puerto DI para operaciones sobre lead_origin_properties y properties.contact_count.
//
// INVARIANTE DEL CONTADOR (§14.5):
//   contact_count se incrementa SOLO cuando se inserta una fila NUEVA en
//   lead_origin_properties (inserted=true). Si el ON CONFLICT DO NOTHING es un no-op
//   (par lead_id+property_id ya existía — índice lead_origin_lead_property_unique),
//   el contador NO se incrementa. Esto mide contactos únicos lead↔property, no taps.
//
// Flujo:
//   1. insert_origin → si inserted=true → increment_contact_count(property_id)
//   2. insert_origin → si inserted=false → NO llamar increment_contact_count

export type InsertOriginResult =
  | { ok: true; inserted: boolean } // inserted=true → fila nueva; inserted=false → no-op
  | { ok: false; error_code: "DB_ERROR" };

export type IncrementContactCountResult =
  | { ok: true }
  | { ok: false; error_code: "DB_ERROR" };

export interface OriginRepo {
  /**
   * INSERT INTO lead_origin_properties
   *   (lead_id, property_id, property_video_id, contacted_at)
   * VALUES (?, ?, ?, now())
   * ON CONFLICT (lead_id, property_id) DO NOTHING   -- índice lead_origin_lead_property_unique
   * RETURNING lead_id
   *
   * Si RETURNING devuelve fila → { ok: true, inserted: true }
   * Si DO NOTHING (conflicto) → { ok: true, inserted: false }
   */
  insert_origin(
    lead_id: string,
    property_id: string,
    property_video_id?: string,
  ): Promise<InsertOriginResult>;

  /**
   * UPDATE properties SET contact_count = contact_count + 1 WHERE id = ?
   *
   * Solo debe llamarse cuando insert_origin devuelve inserted: true.
   */
  increment_contact_count(property_id: string): Promise<IncrementContactCountResult>;
}

// ── Deps inyectables del handler ───────────────────────────────────────────────

export interface ContactAgentDeps {
  callerVerifier: CallerVerifier;
  propertyResolver: PropertyResolver; // 14.3: resolver de propiedad + agente dueño
  leadRepo: LeadRepo;                 // 14.4: creación idempotente del lead
  originRepo: OriginRepo;             // 14.5: lead_origin_properties + contact_count
}
