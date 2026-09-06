-- Migración 20260906100005 — public.crm_radar_anon (subtarea 266.6, exploración 045
-- "Rediseño CRM" §7.5/§12/§14). LA PIEZA DE MAYOR RIESGO DE PRIVACIDAD DE LA ÉPICA: es la
-- forma EXACTA de la fuga 75.3 (events_raw de personas SIN lead, servido con security
-- definer). Aditiva pura: 1 función nueva en `public`, ninguna tabla tocada, ningún contrato
-- publicado roto (§0.5 producción viva) — impacto-prod: sin riesgo de contrato/migración;
-- riesgo de FUGA si el GREEN falla, cerrado por los 4 invariantes de abajo + pgTAP.
-- Rollback: supabase/migrations/rollbacks/20260906100005_crm_radar_anon.sql
-- Tests: supabase/tests/104_crm_radar_anon_test.sql (pgTAP, plan 42) — el contrato completo
-- (SEAM, decisiones D-XXX, edge cases) está en la cabecera de ese archivo; no se repite aquí
-- para no duplicar la fuente de verdad.
--
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ: public.crm_radar_anon(p_agent_id, p_limit) — personas SIN lead con Δ>0 sobre
-- propiedades del agente, agregadas ANTES de salir de la base, sin ninguna columna capaz de
-- portar identidad: row_n (ordinal int, row_number() denso), property_label (address de LA
-- propiedad del agente, no de la persona), temperature/delta (private.crm_temperature,
-- 266.2), sparkline (conteo diario crudo, 266.3-adjacent, NO snapshot), signals (banderas de
-- conteo), last_activity_at.
--
-- ── D-AUTZ-REUSE — private.can_manage_agent_pipeline TAL CUAL (266.4, no se reescribe) ─────
-- Mismo criterio EXACTO que crm_leads_page/crm_funnel: p_agent_id=auth.uid() ∨ el CALLER es
-- owner/admin ACTIVO de la agencia donde p_agent_id está ACTIVO hoy. Fail-closed: sin
-- ninguna de las 2 condiciones, RETURN vacío — nunca una excepción que distinga "no existe"
-- de "no es tuyo" (anti-IDOR, molde ad_metrics_for_agency/get_lead_stats). coalesce a false
-- (defensa en profundidad, mismo hallazgo de 266.4: un `IF NOT (x OR NULL)` trataría NULL
-- como "no entra al bloque" y dejaría pasar al no autorizado).
--
-- ── Pipeline de 6 pasos (§7.5) ──────────────────────────────────────────────────────────────
-- (1) agent_props: propiedades DEL AGENTE (owner_user_id = p_agent_id).
-- (2) activity_typed → eligible_users: actividad EN LA VENTANA crm_radar_window_days
--     (default 14) = video_view/video_completed (events_raw) ∪ likes ∪ saves sobre esas
--     propiedades (D-ELIGIBILIDAD: video_view SÍ cuenta aquí aunque no pese en T1) — SIN
--     lead ACTIVO con este agente (D-ACTIVE-LEAD: deleted_at is null, MISMO criterio exacto
--     que private.crm_temperature; status no importa).
-- (3) property_kanon / kanon_ok: k-anonimato POR PROPIEDAD, count(distinct user_id) sobre
--     eligible_activity (D-KANON-SCOPE: el conjunto YA FILTRADO sin lead — NUNCA el tráfico
--     total; contar sobre el total permitiría deducir por sustracción la identidad del
--     anónimo restante, el modo exacto que 75.3/§7.5 buscan cerrar) ≥ crm_anon_min_viewers
--     (default 3).
-- (4) attributed: la propiedad MÁS RECIENTE de cada persona elegible (D-PROPERTY-ATTRIBUTION,
--     distinct on user_id order by ts desc), filtrada a que ESA propiedad pase kanon_ok →
--     scored/delta_filtered: private.crm_temperature(p_agent_id, user_id, at) en v_now y en
--     v_now−crm_trend_window_days (MISMA ventana que crm_leads_page, 266.4); solo Δ>0.
-- (5) sparkline_agg: conteo DIARIO crudo (events_raw ∪ saves, SIN filtrar event_type — D-SPARK-
--     ANON) por (user_id, property_id=atribuida), longitud crm_radar_window_days, 0 en los
--     días sin evento (no hay snapshot por persona anónima, a diferencia de
--     lead_temperature_daily/266.3). signals_agg: {views, completed, saved, liked} sobre la
--     MISMA ventana y el MISMO par (user_id, property_id) — D-SIGNALS-ANON.
-- (6) row_number() over (order by temperature desc, delta desc, random()) — D-ROWN: random()
--     AL FINAL, nunca antes: con empate total en temperature/delta, el orden (y por tanto
--     row_n) varía entre llamadas — row_n nunca identifica a la misma persona 2 veces.
--
-- ── D-LIMIT-RADAR — mismo clamp que 266.5 (hallazgo del guardian) ──────────────────────────
-- p_limit ≤ 0 o NULL se acota a ≥ 1: greatest(coalesce(p_limit, 20), 1). 0 NO abre el pool
-- completo (a diferencia de "sin límite"); NULL usa el default (20).
--
-- ── security definer + search_path='' + ACL ────────────────────────────────────────────────
-- SECURITY DEFINER porque lee events_raw/likes/saves de personas que NO son leads del
-- agente — events_raw_select se lo prohíbe con razón (private.can_view_user_events exige
-- una relación vigente, "registrar ≠ exponer"). La autorización vive EXPLÍCITA en el cuerpo
-- (mismo patrón que ad_metrics_for_agency/get_lead_stats/crm_leads_page), nunca en RLS.
-- revoke execute from public, anon; grant execute to authenticated (mismo criterio que las 4
-- RPC de 266.4/266.5 — el CRM del agente es un contrato de cliente autenticado).
--
-- Idempotente: create or replace function + revoke/grant repetibles.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.crm_radar_anon(
  p_agent_id uuid,
  p_limit int default 20
)
returns table (
  row_n            int,
  property_label   text,
  temperature      int,
  delta            int,
  sparkline        int[],
  signals          jsonb,
  last_activity_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_window_days int;
  v_min_viewers int;
  v_trend_days  int;
  v_limit       int;
  v_now         timestamptz := now();
begin
  -- D-AUTZ-REUSE fail-closed: idéntico a crm_leads_page/crm_funnel (266.4). coalesce a false
  -- (defensa en profundidad, hallazgo real de 266.4: sin esto, un NULL de "sin agencia
  -- activa" deja pasar al no autorizado bajo la lógica de 3 valores de SQL).
  if not coalesce(
    p_agent_id = (select auth.uid())
    or private.can_manage_agent_pipeline(p_agent_id),
    false
  ) then
    return;
  end if;

  v_window_days := coalesce(
    (select (value::text)::numeric from public.app_config where key = 'crm_radar_window_days'), 14
  )::int;
  v_min_viewers := coalesce(
    (select (value::text)::numeric from public.app_config where key = 'crm_anon_min_viewers'), 3
  )::int;
  v_trend_days := coalesce(
    (select (value::text)::numeric from public.app_config where key = 'crm_trend_window_days'), 3
  )::int;
  -- D-LIMIT-RADAR: mismo clamp que 266.5. 0 NO abre el pool completo; NULL usa el default 20.
  v_limit := greatest(coalesce(p_limit, 20), 1);

  return query
  with agent_props as (
    -- (1) Propiedades DEL AGENTE.
    select id, address from public.properties where owner_user_id = p_agent_id
  ),
  activity_typed as (
    -- (2) D-ELIGIBILIDAD: video_view/video_completed ∪ likes ∪ saves, en la ventana, sobre
    -- propiedades del agente. `kind` distingue el tipo para signals/k-anon; el sparkline
    -- (más abajo) NO usa este CTE para excluir likes (D-SPARK-ANON: solo events_raw ∪ saves).
    select er.user_id, er.property_id, er.created_at as ts, er.event_type as kind
    from public.events_raw er
    join agent_props ap on ap.id = er.property_id
    where er.event_type in ('video_view', 'video_completed')
      and er.created_at between v_now - (v_window_days || ' days')::interval and v_now
    union all
    select lk.user_id, lk.property_id, lk.created_at, 'like'
    from public.likes lk
    join agent_props ap on ap.id = lk.property_id
    where lk.created_at between v_now - (v_window_days || ' days')::interval and v_now
    union all
    select sv.user_id, sv.property_id, sv.created_at, 'save'
    from public.saves sv
    join agent_props ap on ap.id = sv.property_id
    where sv.created_at between v_now - (v_window_days || ' days')::interval and v_now
  ),
  eligible_users as (
    -- D-ACTIVE-LEAD: deleted_at is null, MISMO criterio exacto que private.crm_temperature
    -- (status no importa). "Sin lead activo CON ESTE agente" — un lead con otro agente no
    -- excluye (LEADACT3).
    select distinct at.user_id
    from activity_typed at
    where not exists (
      select 1 from public.leads l
      where l.agent_id = p_agent_id and l.user_id = at.user_id and l.deleted_at is null
    )
  ),
  eligible_activity as (
    -- D-KANON-SCOPE: este es el conjunto (YA sin leads) sobre el que se cuenta el
    -- k-anonimato — nunca el tráfico total de la propiedad.
    select at.* from activity_typed at
    join eligible_users eu on eu.user_id = at.user_id
  ),
  property_kanon as (
    -- (3) k-anonimato POR PROPIEDAD, count(distinct user_id) — NUNCA count(*) (decisión
    -- 2026-08-20, ad_metrics_for_agency): 1 usuario con N eventos no debe pasar el umbral.
    select property_id, count(distinct user_id) as distinct_viewers
    from eligible_activity
    group by property_id
  ),
  kanon_ok as (
    select property_id from property_kanon where distinct_viewers >= v_min_viewers
  ),
  attributed as (
    -- (4) D-PROPERTY-ATTRIBUTION: la propiedad de la actividad MÁS RECIENTE de cada persona
    -- (sobre TODA su actividad elegible, sin restringir aún por kanon_ok) — luego se exige
    -- que ESA propiedad concreta pase el k-anonimato.
    select ar.user_id, ar.property_id, ar.last_activity_at
    from (
      select distinct on (ea.user_id)
        ea.user_id, ea.property_id, ea.ts as last_activity_at
      from eligible_activity ea
      order by ea.user_id, ea.ts desc
    ) ar
    join kanon_ok ko on ko.property_id = ar.property_id
  ),
  scored as (
    select
      a.user_id,
      a.property_id,
      a.last_activity_at,
      private.crm_temperature(p_agent_id, a.user_id, v_now) as temperature,
      private.crm_temperature(
        p_agent_id, a.user_id, v_now - (v_trend_days || ' days')::interval
      ) as temp_prev
    from attributed a
  ),
  delta_filtered as (
    -- Solo Δ>0 (banda "Calentando", §7.3) — un anónimo sin señal nueva no aparece.
    select s.*, (s.temperature - s.temp_prev) as delta
    from scored s
    where (s.temperature - s.temp_prev) > 0
  ),
  signals_agg as (
    -- D-SIGNALS-ANON: {views, completed, saved, liked}, sobre el MISMO par
    -- (user_id, property_id=atribuida) y la MISMA ventana de eligible_activity.
    select
      df.user_id,
      jsonb_build_object(
        'views', count(*) filter (where ea.kind = 'video_view'),
        'completed', count(*) filter (where ea.kind = 'video_completed') > 0,
        'saved', count(*) filter (where ea.kind = 'save') > 0,
        'liked', count(*) filter (where ea.kind = 'like') > 0
      ) as signals
    from delta_filtered df
    join eligible_activity ea on ea.user_id = df.user_id and ea.property_id = df.property_id
    group by df.user_id
  ),
  daily_days as (
    select generate_series(
      (v_now::date - (v_window_days - 1)), v_now::date, interval '1 day'
    )::date as day
  ),
  raw_daily as (
    -- D-SPARK-ANON: conteo DIARIO de actividad CRUDA — events_raw ∪ saves SIN filtrar
    -- event_type (NO es temperatura, no hay snapshot por persona anónima) y SIN likes
    -- (misma consulta independiente que ancla el RED, 104_..._test.sql/SPARK2).
    select er.user_id, er.property_id, (er.created_at)::date as day, count(*)::int as n
    from public.events_raw er
    join agent_props ap on ap.id = er.property_id
    where er.created_at between v_now - (v_window_days || ' days')::interval and v_now
    group by er.user_id, er.property_id, (er.created_at)::date
    union all
    select sv.user_id, sv.property_id, (sv.created_at)::date, count(*)::int
    from public.saves sv
    join agent_props ap on ap.id = sv.property_id
    where sv.created_at between v_now - (v_window_days || ' days')::interval and v_now
    group by sv.user_id, sv.property_id, (sv.created_at)::date
  ),
  raw_daily_merged as (
    select user_id, property_id, day, sum(n)::int as n
    from raw_daily
    group by user_id, property_id, day
  ),
  sparkline_agg as (
    select
      df.user_id,
      array_agg(coalesce(rdm.n, 0) order by dd.day) as sparkline
    from delta_filtered df
    cross join daily_days dd
    left join raw_daily_merged rdm
      on rdm.user_id = df.user_id and rdm.property_id = df.property_id and rdm.day = dd.day
    group by df.user_id
  ),
  ranked as (
    -- (6) D-ROWN: random() AL FINAL de la lista de ORDER BY — solo decide entre empates
    -- exactos de (temperature, delta); row_number() es denso por construcción.
    select
      ap.address as property_label,
      df.temperature,
      df.delta,
      sa.sparkline,
      sg.signals,
      df.last_activity_at,
      (row_number() over (order by df.temperature desc, df.delta desc, random()))::int as rn
    from delta_filtered df
    join agent_props ap on ap.id = df.property_id
    left join sparkline_agg sa on sa.user_id = df.user_id
    left join signals_agg sg on sg.user_id = df.user_id
  )
  select
    r.rn as row_n,
    r.property_label,
    r.temperature,
    r.delta,
    r.sparkline,
    r.signals,
    r.last_activity_at
  from ranked r
  where r.rn <= v_limit
  order by r.rn;
end;
$$;

comment on function public.crm_radar_anon(uuid, int) is
  'Radar anónimo del CRM (subtarea 266.6, exploración 045 §7.5): personas SIN lead con Δ>0 '
  'sobre propiedades del agente, agregadas ANTES de salir de la base. 7 columnas, NINGUNA '
  'capaz de portar identidad (row_n es ordinal no estable — random() al final del ORDER BY). '
  'k-anonimato POR PROPIEDAD (count(distinct user_id) >= crm_anon_min_viewers) computado '
  'SOLO sobre el conjunto ya filtrado sin lead activo (D-KANON-SCOPE) — nunca sobre el '
  'tráfico total, para cerrar la deducción por sustracción (la fuga 75.3). D-AUTZ-REUSE: '
  'private.can_manage_agent_pipeline (266.4), fail-closed, 0 filas, nunca excepción. '
  'SECURITY DEFINER porque lee events_raw/likes/saves de no-leads (events_raw_select lo '
  'prohíbe con razón) — la autorización vive en el cuerpo, no en RLS.';

revoke execute on function public.crm_radar_anon(uuid, int) from public, anon;
grant execute on function public.crm_radar_anon(uuid, int) to authenticated;
