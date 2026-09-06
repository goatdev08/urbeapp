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
 *   - `agency_members`: user_id, member_role='agent', status ∈ {active,suspended}.
 *   - `user_preferences` (via users.id → user_preferences.user_id): full_name,
 *     profile_photo_url — columnas de migración 0015, ausentes en users.
 *
 * full_name / profile_photo_url son nullable: un agente sin onboarding puede no
 * tener fila en user_preferences.
 *
 * `status` (#203.2): un agente SUSPENDIDO sigue apareciendo en la lista — su
 * cuenta congelada sigue recibiendo leads nuevos (ruteo #203.1) y su
 * inventario necesita un lugar visible desde donde reasignarse. `removed` no
 * aplica aquí: esa membresía ya salió del `.in('status', [...])` de
 * useAgencyAgents.
 */
export interface Agent {
  id: string;
  full_name: string | null;
  profile_photo_url: string | null;
  status: 'active' | 'suspended';
}

/**
 * ── Rediseño CRM (tarea #266, fase D) — tipos de las 5 RPC nuevas ──────────
 * Fuente de verdad: las migraciones, NO se repiten sus decisiones D-XXX aquí.
 *   - 20260906100003_crm_leads_page_funnel.sql → crm_leads_page / crm_funnel
 *   - 20260906100004_crm_lead_detail_activity.sql → crm_lead_detail / lead_activity
 *   - 20260906100005_crm_radar_anon.sql → crm_radar_anon
 * Subtarea 266.7 (RED): estos tipos alimentan los 5 hooks nuevos en
 * hooks/useCrmLeadsPage.ts, useCrmFunnel.ts, useCrmLeadDetail.ts,
 * useLeadActivity.ts, useCrmRadarAnon.ts. NO se cablean a la UI (eso es #267).
 */

/**
 * Banda por tendencia (private.crm_band, subtarea 266.2). Los 4 valores
 * literales EXACTOS que la función SQL devuelve — 'hot' | 'cooling' |
 * 'warming' | 'silent' (20260906100001_crm_temperature.sql).
 */
export type CrmBand = 'hot' | 'cooling' | 'warming' | 'silent';

/**
 * Proyección 8→4 del status del lead para la UI del pipeline (§7.4, misma
 * regla EXACTA en crm_leads_page.status_projected y
 * crm_lead_detail.suggested_next_status "resuelto"). Valores literales que
 * devuelve el CASE de public.crm_leads_page.
 */
export type ProjectedStatus = 'nuevo' | 'contactado' | 'visita' | 'cerrado';

/** Conteos de señales de una fila de crm_leads_page (jsonb `signals`). */
export interface CrmLeadSignals {
  video_completed: number;
  video_views: number;
  likes: number;
  saves: number;
}

/** Propiedad de origen tal como la devuelve crm_leads_page (jsonb `origin_property`). */
export interface CrmLeadOriginProperty {
  property_id: string;
  address: string;
  contacted_at: string;
}

/**
 * CrmLeadRow — una fila de public.crm_leads_page (subtarea 266.4), la unidad
 * que useCrmLeadsPage acumula en su página. `next_cursor`/`remaining` NO
 * viven aquí: son metadatos DE LA PÁGINA (repetidos idénticos en cada fila
 * por el SQL), el hook los extrae una sola vez y no los expone por fila.
 */
export interface CrmLeadRow {
  lead_id: string;
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  temperature: number;
  delta: number;
  band: CrmBand;
  signals: CrmLeadSignals;
  sparkline: number[];
  last_activity_at: string | null;
  origin_property: CrmLeadOriginProperty | null;
  status_projected: ProjectedStatus;
}

/** Cursor keyset opaco de crm_leads_page (jsonb `next_cursor`/`p_cursor`). */
export interface CrmLeadsPageCursor {
  as_of: string;
  temperature: number;
  lead_id: string;
}

/** CrmFunnel — fila única de public.crm_funnel (subtarea 266.4), 5 KPIs agregados. */
export interface CrmFunnel {
  vieron: number;
  volvieron: number;
  guardaron: number;
  contactaron: number;
  agendaron: number;
}

/** Propiedad de origen tal como la devuelve crm_lead_detail (jsonb `origin_property`). */
export interface CrmLeadDetailOriginProperty {
  property_id: string;
  address: string;
  price: number;
  thumbnail_url: string | null;
}

/**
 * CrmLeadDetail — fila única de public.crm_lead_detail (subtarea 266.5),
 * cabecera de la ficha expandida del lead.
 */
export interface CrmLeadDetail {
  origin_property: CrmLeadDetailOriginProperty | null;
  other_properties: number;
  /** Valor CRUDO del enum lead_status (no la proyección 8→4) — puede ser null (visita/cerrado). */
  suggested_next_status: LeadStatus | null;
}

/**
 * LeadActivityEntry — fila de public.lead_activity (subtarea 266.5), timeline
 * unificado (events_raw ∪ likes ∪ saves ∪ lead_status_history). `kind` no se
 * acota a un enum estrecho: events_raw.event_type admite valores futuros
 * (registrar ≠ exponer no aplica aquí — es actividad del propio lead del
 * agente) además de los literales fijos 'like'/'save'/'status_change'.
 */
export interface LeadActivityEntry {
  occurred_at: string;
  kind: string;
  detail: Record<string, unknown>;
}

/** Conteos de señales de una fila de crm_radar_anon (jsonb `signals`). */
export interface CrmRadarSignals {
  views: number;
  completed: boolean;
  saved: boolean;
  liked: boolean;
}

/**
 * CrmRadarRow — fila de public.crm_radar_anon (subtarea 266.6). 🔒 Invariante
 * de privacidad (75.3/§7.5): NINGUNA columna puede portar identidad — sin
 * user_id/lead_id. `row_n` es un ordinal NO estable entre llamadas
 * (random() al final del ORDER BY del SQL) — nunca usarlo como key estable
 * de lista fuera del render actual.
 */
export interface CrmRadarRow {
  row_n: number;
  property_label: string;
  temperature: number;
  delta: number;
  sparkline: number[];
  signals: CrmRadarSignals;
  last_activity_at: string | null;
}
