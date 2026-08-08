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

/**
 * Estados posibles del lead (enum lead_status, migración 0001 +
 * 20260807000002_lead_status_reconcile_enum — #75.1).
 *
 * Los primeros 7 son legacy: Postgres no puede vaciar un enum y hay apps
 * v1.0.3 en la calle que aún los escriben/leen. Los últimos 4 son los
 * vigentes desde #75.1 (`new`→`whatsapp_opened`, `closed_won` se partió en
 * `closed_won_rent`/`closed_won_sale`, `interested` es nuevo). Ver
 * ALL_LEAD_STATUSES en lead_status_meta.ts para el set que el picker ofrece.
 */
export type LeadStatus =
  // ── Legacy (solo lectura — no se pueden volver a elegir) ─────────────────
  | 'new'
  | 'in_progress'
  | 'closed_won'
  // ── Vigentes ──────────────────────────────────────────────────────────────
  | 'whatsapp_opened'
  | 'contacted'
  | 'interested'
  | 'visit_scheduled'
  | 'closed_won_rent'
  | 'closed_won_sale'
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

  // ── Scoring/actividad (migración 20260807000004, subtarea 75.5/75.6) ──────
  // Obligatorios: los triggers de la migración mantienen score/level/is_follow_up
  // siempre poblados en la fila real de `leads` (nunca null) — useAgentLeads.ts
  // (GREEN 75.6) los pide en el select y los mapea 1:1, sin fallback.
  /** Score denormalizado (leads.score) — 10 contacto + 4×saves + 1×likes. */
  score: number;
  /** Nivel frío/tibio/caliente derivado del score (leads.level). */
  level: LeadTemperature;
  /** Bandera de seguimiento pendiente, ortogonal al status (leads.is_follow_up). */
  is_follow_up: boolean;
}

/** Nivel de actividad del lead (enum lead_temperature, migración 20260807000004). */
export type LeadTemperature = 'frio' | 'tibio' | 'caliente';

/**
 * LeadStats — estadísticas tangibles de actividad de un lead (RPC
 * `get_lead_stats`, migración 20260808000002, subtarea 112.3/112.4).
 *
 * Reemplaza `score`/`level` en la UI (decisión del dueño, tarea #112): en vez
 * de un puntaje opaco o una etiqueta de temperatura, hechos concretos de lo
 * que el buscador hizo con la propiedad de origen.
 *
 * 🔴 El RPC solo devuelve fila para leads cuyo usuario YA dio like a la
 * propiedad de origen (el like es el filtro de entrada). Un lead sin like no
 * tiene fila — se representa como key AUSENTE en el mapa que devuelve
 * useLeadStats, nunca como este tipo con ceros/false. La UI debe tratar esa
 * ausencia como "todavía sin señales", no como error.
 */
export interface LeadStats {
  /** true si el usuario terminó de ver el video de origen (event_type='video_completed'). */
  vio_completo: boolean;
  /** Número de veces que vio el video de origen (event_type='video_view', deduplicado por sesión). */
  veces_visto: number;
  /** true si guardó la propiedad de origen (tabla `saves`). */
  guardo: boolean;
  /** Máximo entre eventos/like/save — timestamp de la señal de actividad más reciente. */
  ultima_actividad: string;
}

/**
 * Modo de orden de useAgentLeads (§19.9, subtarea 75.6):
 *   - 'score': orden por defecto — leads.score DESC, desempate por updated_at DESC.
 *   - 'last_contact': modo alternativo ("botón secundario") — leads.last_contact_at
 *     DESC (nulls al final — un lead sin seguimiento posterior al contacto inicial
 *     no debe aparecer arriba), desempate por updated_at DESC.
 */
export type LeadSortMode = 'score' | 'last_contact';

/**
 * LeadStatusHistoryEntry — fila del timeline append-only de un lead
 * (tabla lead_status_history, migración 20260807000003, subtarea 75.1/75.6).
 * Solo lectura: la tabla la puebla EXCLUSIVAMENTE el trigger
 * trg_lead_status_history — ningún cliente ni Edge Function escribe aquí.
 */
export interface LeadStatusHistoryEntry {
  id: string;
  lead_id: string;
  /** NULL en la fila de creación del lead (no hay "estado anterior"). */
  old_status: LeadStatus | null;
  new_status: LeadStatus;
  /** NULL si el usuario que hizo el cambio fue borrado (ON DELETE SET NULL). */
  changed_by: string | null;
  changed_at: string;
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
