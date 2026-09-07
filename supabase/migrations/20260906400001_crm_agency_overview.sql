-- Migración 20260906400001 — public.crm_agency_overview (subtarea 269.1, exploración 045
-- §6.6/§12/§14 T-E). Aditiva pura: 1 RPC nueva en `public`, ninguna tabla tocada, ningún
-- contrato publicado roto (§0.5 producción viva). Impacto-prod: sin riesgo (RPC de lectura).
-- Rollback: supabase/migrations/rollbacks/20260906400001_crm_agency_overview.sql
-- Tests: supabase/tests/107_crm_agency_overview_test.sql (RED, plan 62) — el contrato
-- completo (SEAMS, decisiones D-*, edge cases) está en la cabecera de ese archivo; no se
-- repite aquí para no duplicar la fuente de verdad.
--
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ: vista de agencia del CRM — por cada agente ACTIVO de la agencia (owner/admin/agent
-- con al menos 1 lead, o cualquier 'agent'): sin_tocar, tiempo_respuesta, temp_promedio,
-- badge (pierde_leads/acumula/NULL); más el bloque de leads SIN GESTOR (agente suspendido,
-- mecanismo #203/20260904200001). D-AUTZ: 0 filas salvo owner/admin ACTIVO de p_agency_id
-- (private.agency_role_of), fail-closed, nunca excepción (anti-IDOR, mismo molde que
-- private.can_manage_agent_pipeline de 266.4).
--
-- ── Reuso, sin helper nuevo (ponytail full) ────────────────────────────────────────────────
-- private.agency_role_of (20260805000003), private.crm_temperature (20260906100001),
-- lead_status_history (20260807000003), agency_members status='suspended' (mecanismo #203,
-- 20260904200001). Una sola función, sin helper compartido: a diferencia de
-- crm_leads_page/crm_funnel (266.4), aquí NINGUNA otra RPC repite esta expresión de
-- autorización — extraer private.can_manage_agency_overview(uuid) hoy sería Speculative
-- Generality (un solo llamador).
--
-- ── 🔴 Frontera de agencia — hallazgo del guardian (§0.5.4, corrección post-RED) ────────────
-- Esta RPC es SECURITY DEFINER: salta RLS por completo. La primera versión filtraba SOLO por
-- agency_members.status='suspended' (D-UNMANAGED) y por agency_members.status='active'
-- (D-AGENTROWS/D-METRICS-SCOPE), sin acotar además por leads.agency_id = p_agency_id. Techo
-- alcanzable con datos reales de producción (rotación de agentes entre agencias — un agente
-- puede quedar suspendido en la agencia A y luego activarse en la B, o cargar leads
-- históricos de una agencia PREVIA distinta a la ACTIVA hoy; agency_members_one_active_per_user
-- solo garantiza una fila 'active' a la vez, no descarta el histórico de otras agencias):
-- sin el filtro por leads.agency_id, un lead que NO pertenece a p_agency_id se colaba tanto en
-- el bloque 'unmanaged' (D-UNMANAGED) como en las métricas de un agent row (D-METRICS-SCOPE) —
-- exponiendo el nombre de un buscador y el pipeline de OTRA agencia al owner/admin de esta. El
-- fix replica la MISMA frontera que la policy leads_select (20260807000006) exigiría bajo RLS
-- normal: agent_id=auth.uid() OR private.agency_role_of(agency_id) in ('owner','admin') — aquí
-- expresada como leads.agency_id = p_agency_id (la agencia ya validada por D-AUTZ), sobre la
-- MISMA columna que private.set_lead_agency_id (#203) ya resuelve como fuente de verdad ("la
-- agencia donde el agente CAPTÓ el lead"). NO es circular usar leads.agency_id aquí (a
-- diferencia de lo que la nota original de D-UNMANAGED asumía): ese campo resuelve PRIMERO a
-- la membresía ACTIVA al momento de crear el lead, y solo cae a la SUSPENDIDA más reciente si
-- no había ninguna activa — exactamente la semántica que esta RPC necesita.
--
-- ── "Transición REAL" — el mismo criterio en D-RESPONSE y D-STALE ──────────────────────────
-- Una fila de lead_status_history con old_status IS NOT NULL: la fila de creación
-- (old_status NULL, poblada por el trigger trg_lead_status_history) NUNCA cuenta como
-- transición, aunque el lead nazca ya en 'contacted' (mismo criterio que
-- crm_leads_page:290-296 para last_status_change_at). response_hours = mediana en horas de
-- (1ª transición real a 'contacted' − leads.created_at) sobre TODOS los leads no borrados
-- del agente (abiertos o cerrados); NULL si ninguno transicionó jamás. Un lead cuenta como
-- stale si está ABIERTO, nunca transicionó de verdad, y su edad ≥ crm_agent_flag_stale_days.
--
-- ── avg_temperature: NULL de 0 leads abiertos por semántica nativa de avg(), sin caso
--    especial (ponytail: se apoya en la aritmética de SQL en vez de un IF adicional,
--    mismo criterio que private.crm_temperature §0.5.1/D-AVGTEMP).
--
-- ── Claves de app_config — por COALESCE, NUNCA sembradas (mismo patrón que
--    private.crm_temperature, 20260906100001) ─────────────────────────────────────────────
--   crm_agent_flag_untouched_min   (default 3)  — sin_tocar >= esto → pierde_leads.
--   crm_agent_flag_response_hours  (default 24) — tiempo_respuesta > esto → pierde_leads
--                                                  (estrictamente mayor; 24 exacto NO dispara).
--   crm_agent_flag_stale_leads_min (default 5)  — leads stale >= esto → acumula.
--   crm_agent_flag_stale_days      (default 7)  — edad mínima para que un lead abierto sin
--                                                  transición real cuente como stale.
--   pierde_leads MANDA sobre acumula si ambas condiciones aplican a la vez.
--
-- security definer + search_path='' + REVOKE public/anon + GRANT solo authenticated: mismo
-- criterio que public.crm_leads_page/crm_funnel (20260906100003) — es un contrato PÚBLICO
-- que el cliente llama directo (a diferencia de private.crm_temperature/crm_band, que son
-- helpers internos sin EXECUTE para ningún rol de cliente).
--
-- Idempotente: create or replace function + revoke/grant repetibles.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.crm_agency_overview(p_agency_id uuid)
returns table (
  kind             text,
  agent_id         uuid,
  agent_name       text,
  lead_id          uuid,
  untouched_count  integer,
  response_hours   numeric,
  avg_temperature  integer,
  flag             text,
  temperature      integer,
  first_contact_at timestamptz,
  lead_display_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_untouched_min  int;
  v_response_hours numeric;
  v_stale_min      int;
  v_stale_days     numeric;
begin
  -- D-AUTZ fail-closed: sin owner/admin ACTIVO de p_agency_id, vacío sin tocar leads
  -- (anti-IDOR). coalesce a false: agency_role_of(NULL-membresía) da NULL, no false, y un
  -- `IF NOT (... )` trataría ese NULL como "no entra al bloque" (mismo hallazgo que
  -- private.can_manage_agent_pipeline, 266.4).
  if not coalesce(private.agency_role_of(p_agency_id) in ('owner', 'admin'), false) then
    return;
  end if;

  v_untouched_min  := coalesce((select (value::text)::numeric from public.app_config where key = 'crm_agent_flag_untouched_min'), 3)::int;
  v_response_hours := coalesce((select (value::text)::numeric from public.app_config where key = 'crm_agent_flag_response_hours'), 24);
  v_stale_min      := coalesce((select (value::text)::numeric from public.app_config where key = 'crm_agent_flag_stale_leads_min'), 5)::int;
  v_stale_days     := coalesce((select (value::text)::numeric from public.app_config where key = 'crm_agent_flag_stale_days'), 7);

  return query
  with active_members as (
    -- D-AGENTROWS: agency_member ACTIVO con member_role IN ('agent','admin','owner').
    select
      am.user_id as agent_id,
      am.member_role,
      nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '') as agent_name
    from public.agency_members am
    join public.users u on u.id = am.user_id
    where am.agency_id = p_agency_id
      and am.status = 'active'
      and am.member_role in ('agent', 'admin', 'owner')
  ),
  agent_all_leads as (
    -- D-METRICS-SCOPE (🔴 corregido tras hallazgo del guardian, §0.5.4): TODOS los leads no
    -- borrados de cada miembro activo, ACOTADOS a l.agency_id = p_agency_id — un agente puede
    -- acumular leads de una agencia PREVIA (agency_members_one_active_per_user solo garantiza
    -- una membresía ACTIVA a la vez, no descarta el histórico); sin este filtro, leads de OTRA
    -- agencia se colarían en untouched_count/response_hours/avg_temperature/stale de esta.
    select am.agent_id, l.id as lead_id, l.status, l.created_at, l.user_id
    from active_members am
    join public.leads l on l.agent_id = am.agent_id
    where l.deleted_at is null
      and l.agency_id = p_agency_id
  ),
  real_contact as (
    -- 1ª transición REAL (old_status IS NOT NULL) a 'contacted' por lead — la fila de
    -- creación (old_status NULL) nunca cuenta (D-RESPONSE/D-STALE).
    select h.lead_id, min(h.changed_at) as first_contacted_at
    from public.lead_status_history h
    where h.old_status is not null and h.new_status = 'contacted'
    group by h.lead_id
  ),
  lead_calc as (
    select
      aal.agent_id,
      aal.lead_id,
      aal.status,
      aal.user_id,
      -- D-CLOSED: el resto del enum (post-reconcile 20260807000002) es abierto.
      (aal.status not in ('closed_won_rent', 'closed_won_sale', 'closed_lost', 'discarded', 'closed_won')) as is_open,
      rc.first_contacted_at,
      (extract(epoch from (rc.first_contacted_at - aal.created_at)))::numeric / 3600 as response_hours_of_lead,
      aal.created_at
    from agent_all_leads aal
    left join real_contact rc on rc.lead_id = aal.lead_id
  ),
  lead_calc2 as (
    select
      lc.*,
      private.crm_temperature(lc.agent_id, lc.user_id, now()) as temperature_of_lead,
      (
        lc.is_open
        and lc.first_contacted_at is null
        and now() - lc.created_at >= (v_stale_days || ' days')::interval
      ) as is_stale
    from lead_calc lc
  ),
  agent_metrics as (
    select
      am.agent_id,
      am.agent_name,
      am.member_role,
      count(lc.lead_id) filter (where lc.status = 'new') as untouched_count,
      -- percentile_cont SIEMPRE evalúa el ORDER BY como double precision y devuelve double
      -- precision (no existe overload numeric) — cast explícito de vuelta a numeric, el tipo
      -- declarado en RETURNS TABLE (columna 6), o Postgres rechaza la función con "structure
      -- of query does not match function result type".
      (percentile_cont(0.5) within group (order by lc.response_hours_of_lead)
        filter (where lc.first_contacted_at is not null))::numeric as response_hours,
      round(avg(lc.temperature_of_lead) filter (where lc.is_open))::integer as avg_temperature,
      count(lc.lead_id) filter (where lc.is_stale) as stale_count,
      count(lc.lead_id) as total_leads
    from active_members am
    left join lead_calc2 lc on lc.agent_id = am.agent_id
    group by am.agent_id, am.agent_name, am.member_role
  ),
  agent_rows as (
    select
      am.agent_id,
      am.agent_name,
      am.untouched_count::integer as untouched_count,
      am.response_hours,
      am.avg_temperature,
      -- D-FLAG: pierde_leads MANDA sobre acumula si ambas aplican.
      case
        when am.untouched_count >= v_untouched_min
          or (am.response_hours is not null and am.response_hours > v_response_hours)
        then 'pierde_leads'
        when am.stale_count >= v_stale_min then 'acumula'
        else null
      end as flag
    from agent_metrics am
    where am.member_role = 'agent' or am.total_leads > 0
  ),
  unmanaged_rows as (
    -- D-UNMANAGED (🔴 corregido tras hallazgo del guardian, §0.5.4 — frontera de agencia): un
    -- lead es "sin gestor" de p_agency_id SOLO si (a) su leads.agency_id = p_agency_id (la
    -- agencia donde el agente lo CAPTÓ, resuelta por private.set_lead_agency_id/#203 — activa
    -- al momento de crear el lead, o la suspendida más reciente si no había ninguna activa) Y
    -- (b) el agente sigue siendo, HOY, un agency_member status='suspended' EN ESA MISMA
    -- p_agency_id. La RPC es SECURITY DEFINER y salta RLS: debe replicar la MISMA frontera que
    -- la policy leads_select (20260807000006: agent_id=auth.uid() OR
    -- private.agency_role_of(agency_id) in ('owner','admin')) exigiría bajo RLS normal. Sin (a),
    -- un agente suspendido EN A pero ACTIVO en B (su lead nuevo captado en B, agency_id=B) se
    -- colaría como "sin gestor" de A — fuga de un lead que ni siquiera pertenece a A.
    select
      l.id as lead_id,
      private.crm_temperature(l.agent_id, l.user_id, now()) as temperature,
      l.first_contact_at,
      nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '') as lead_display_name
    from public.leads l
    join public.agency_members am on am.user_id = l.agent_id
      and am.agency_id = p_agency_id
      and am.status = 'suspended'
    join public.users u on u.id = l.user_id
    where l.deleted_at is null
      and l.agency_id = p_agency_id
      and l.status not in ('closed_won_rent', 'closed_won_sale', 'closed_lost', 'discarded', 'closed_won')
  )
  select
    'agent'::text as kind,
    ar.agent_id,
    ar.agent_name,
    null::uuid as lead_id,
    ar.untouched_count,
    ar.response_hours,
    ar.avg_temperature,
    ar.flag,
    null::integer as temperature,
    null::timestamptz as first_contact_at,
    null::text as lead_display_name
  from agent_rows ar

  union all

  select
    'unmanaged'::text as kind,
    null::uuid as agent_id,
    null::text as agent_name,
    ur.lead_id,
    null::integer as untouched_count,
    null::numeric as response_hours,
    null::integer as avg_temperature,
    null::text as flag,
    ur.temperature,
    ur.first_contact_at,
    ur.lead_display_name
  from unmanaged_rows ur

  -- D-ORDER: kind='agent' primero (ASC ya separa 'agent' < 'unmanaged'), por agent_name ASC;
  -- luego kind='unmanaged', por temperature DESC, lead_id ASC.
  order by kind asc, agent_name asc, temperature desc, lead_id asc;
end;
$$;

comment on function public.crm_agency_overview(uuid) is
  'Vista de agencia del CRM (subtarea 269.1, exploración 045 §6.6/§12/§14 T-E): por agente '
  'ACTIVO de la agencia (owner/admin con >=1 lead propio, o cualquier agent) — sin_tocar '
  '(status=''new''), tiempo_respuesta (mediana en horas de 1ª transición REAL a ''contacted'' '
  'menos alta, NULL si nunca), temp_promedio (private.crm_temperature sobre leads abiertos) y '
  'badge (''pierde_leads''|''acumula''|NULL); más el bloque SIN GESTOR (leads de agentes '
  'suspendidos en ESTA agencia, mecanismo #203/20260904200001) con temperatura y '
  'first_contact_at. 🔴 Frontera de agencia (fix post-guardian, §0.5.4): tanto las métricas '
  'por agente como el bloque sin-gestor se acotan ADEMÁS por leads.agency_id = p_agency_id '
  '(replica la frontera de la policy leads_select, 20260807000006, ya que esta RPC es '
  'SECURITY DEFINER y salta RLS) — sin esto, un agente con leads de OTRA agencia (rotación '
  'entre agencias) filtraba pipeline ajeno hacia este overview. D-AUTZ fail-closed: 0 filas '
  'salvo owner/admin ACTIVO de p_agency_id (private.agency_role_of). Umbrales por '
  'COALESCE(app_config, default) — NUNCA sembrados: crm_agent_flag_untouched_min=3, '
  'crm_agent_flag_response_hours=24, crm_agent_flag_stale_leads_min=5, '
  'crm_agent_flag_stale_days=7. pierde_leads MANDA sobre acumula si ambas condiciones '
  'aplican.';

revoke execute on function public.crm_agency_overview(uuid) from public, anon;
grant execute on function public.crm_agency_overview(uuid) to authenticated;
