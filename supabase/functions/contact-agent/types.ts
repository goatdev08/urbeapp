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

// ── Deps inyectables del handler ───────────────────────────────────────────────

export interface ContactAgentDeps {
  callerVerifier: CallerVerifier;
  propertyResolver: PropertyResolver; // 14.3: resolver de propiedad + agente dueño
  // 14.4+: leadWriter, etc. se agregarán progresivamente
}
