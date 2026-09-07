/**
 * types.ts — tipos del dominio leads/CRM.
 *
 * Invariantes de negocio del lead (migración 0006):
 *   - 🔒 agent_id ≠ user_id (CHECK en la tabla).
 *   - 🔒 Un lead por par (agent_id, user_id) activo (unique index WHERE deleted_at IS NULL).
 *   - El buscador NO ve su propio lead (RLS, sólo el agente dueño y el owner de la inmobiliaria).
 *
 * El CRM se reescribió sobre el rediseño de datos de #266/#267 (RPCs
 * crm_leads_page/crm_funnel/crm_lead_detail/lead_activity/crm_radar_anon,
 * abajo) — el shape "lead enriquecido plano" de la primera versión
 * (AgentLead/LeadStats/LeadSortMode/LeadStatusHistoryEntry) se retiró en
 * 267.7 junto con sus únicos consumidores (useAgentLeads/useLeadStats/
 * useLeadStatusHistory/LeadCard/LeadExpandedView/ActionStatsBar).
 */

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

/**
 * ── Vista de agencia del CRM (tarea #269, subtarea 269.5) ──────────────────
 * Fuente: public.crm_agency_overview (migración 20260906400001), una fila por
 * agente activo (`kind: 'agent'`) más una fila por lead sin agente asignado
 * (`kind: 'unmanaged'`). El hook useCrmAgencyOverview separa la fila cruda en
 * estos dos tipos, sin arrastrar `kind` ni los campos NULL del otro kind.
 */

/** AgencyAgentRow — fila `kind='agent'` de crm_agency_overview, proyectada. */
export interface AgencyAgentRow {
  agent_id: string;
  agent_name: string | null;
  untouched_count: number;
  response_hours: number | null;
  avg_temperature: number | null;
  flag: 'pierde_leads' | 'acumula' | null;
}

/** UnmanagedLeadRow — fila `kind='unmanaged'` de crm_agency_overview, proyectada. */
export interface UnmanagedLeadRow {
  lead_id: string;
  lead_display_name: string | null;
  temperature: number;
  first_contact_at: string | null;
}
