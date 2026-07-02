/**
 * types.ts — tipos del dominio leads/CRM.
 *
 * AgentLead: lead enriquecido para la pantalla CRM del agente autenticado.
 *
 * Fuentes de datos (schema migración 0006 + 0015):
 *   - `leads`: campos de estado del lead (id, user_id, agent_id, status, etc.).
 *   - `users` (via leads.user_id FK): phone — para integración WhatsApp (#15.5).
 *   - `user_preferences` (via users.id → user_preferences.user_id): full_name,
 *     profile_photo_url — columnas de migración 0015; corrección descubierta en
 *     tarea #14 (el nombre/foto viene de user_preferences, NO de users).
 *   - `lead_origin_properties` (LEFT JOIN via leads.id): propiedad de origen del
 *     contacto. Nullable — un lead puede existir sin propiedad de origen registrada.
 *   - `properties` (via lead_origin_properties.property_id): address.
 *   - `property_videos` (via properties.id): thumbnail_url del primer video (position=1).
 *
 * Invariantes de negocio (migración 0006):
 *   - 🔒 agent_id ≠ user_id (CHECK en la tabla).
 *   - 🔒 Un lead por par (agent_id, user_id) activo (unique index WHERE deleted_at IS NULL).
 *   - El buscador NO ve su propio lead (RLS, sólo el agente dueño y el owner de la inmobiliaria).
 */

// STUB mínimo — subtarea 15.2 RED phase.
// La fase GREEN añadirá los tipos derivados de Database['public']['Tables']['leads']['Row'].

/** Estados posibles del lead (enum lead_status, migración 0001). */
export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'in_progress'
  | 'visit_scheduled'
  | 'closed_won'
  | 'closed_lost'
  | 'discarded';

/**
 * AgentLead — lead enriquecido para la lista CRM del agente.
 *
 * Todos los campos de origen externo al lead (usuario interesado, propiedad de
 * origen) son nullable porque:
 *   a) usuario sin onboarding puede no tener user_preferences
 *   b) lead sin propiedad de origen (lead_origin_properties vacío) → origin_* = null
 *   c) agente sin phone en users.phone → phone = null
 */
export interface AgentLead {
  // ── Campos propios del lead ──────────────────────────────────────────────
  id: string;
  user_id: string;
  agent_id: string;
  status: LeadStatus;
  internal_notes: string | null;
  first_contact_at: string;
  last_contact_at: string | null;
  updated_at: string;
  created_at: string;

  // ── Usuario interesado (buscador) ────────────────────────────────────────
  /** Teléfono del buscador (users.phone) — usado en integración WhatsApp. */
  phone: string | null;
  /** Nombre completo del buscador (user_preferences.full_name, migración 0015). */
  full_name: string | null;
  /** Foto de perfil del buscador (user_preferences.profile_photo_url, migración 0015). */
  profile_photo_url: string | null;

  // ── Propiedad de origen del contacto (nullable) ──────────────────────────
  /** property_id de lead_origin_properties[0]. Null si no hay origin registrado. */
  origin_property_id: string | null;
  /** Dirección de la propiedad de origen. Null si no hay origin. */
  origin_property_address: string | null;
  /** Thumbnail del primer video de la propiedad de origen. Null si no hay origin o sin video. */
  origin_property_thumbnail_url: string | null;
}

/**
 * Agent — miembro agente de una agencia, para el selector del CRM del owner (#28.2).
 *
 * Fuentes de datos (schema migración 0003 + 0015):
 *   - `agency_members`: user_id, member_role='agent', status='active'.
 *   - `user_preferences` (via users.id → user_preferences.user_id): full_name,
 *     profile_photo_url — columnas de migración 0015, ausentes en users.
 *
 * full_name / profile_photo_url son nullable: un agente sin onboarding puede no
 * tener fila en user_preferences.
 */
export interface Agent {
  id: string;
  full_name: string | null;
  profile_photo_url: string | null;
}
