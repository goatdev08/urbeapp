-- Migración 20260906100003 — public.crm_leads_page + public.crm_funnel (subtarea 266.4,
-- exploración 045 "Rediseño CRM" §7.4/§12/§14). Aditiva pura: 2 funciones nuevas en `public`,
-- ninguna tabla tocada, ningún contrato publicado roto (§0.5 producción viva) —
-- get_lead_stats (20260808000002) queda INTACTO (REUSO_CON_RESERVA ya resuelto en la tarea:
-- no cabe, lo llaman builds 1.0.3 instalados).
-- Rollback: supabase/migrations/rollbacks/20260906100003_crm_leads_page_funnel.sql
-- Tests: supabase/tests/102_crm_leads_page_funnel_test.sql (plan 67) — el contrato completo
-- (SEAMS, decisiones D-DEFAULTS/D-AUTZ/D-TIEBREAK/D-NEXTCURSOR/D-REMAINING/D-ASOF/
-- D-STATUSPROJ/D-FUNNEL-WINDOW/D-VOLVIERON/D-AGENDARON/D-QUERY, edge cases) está en la
-- cabecera de ese archivo; no se repite aquí para no duplicar la fuente de verdad.
--
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ: 2 RPC de lectura para la pantalla del CRM del agente (fase D, exploración 045):
--   public.crm_leads_page(p_agent_id, p_band, p_cursor, p_limit, p_query) — página del
--     pipeline: temperatura T1 en lectura (private.crm_temperature, 266.2), banda por
--     tendencia (private.crm_band, 266.2), sparkline de 14 días (lead_temperature_daily,
--     266.3), status proyectado 8→4 (§7.4), cursor keyset con as_of congelado.
--   public.crm_funnel(p_agent_id, p_days) — 5 KPIs agregados (vieron/volvieron/guardaron/
--     contactaron/agendaron) para la vista de embudo.
--
-- ── D-AUTZ — private.can_manage_agent_pipeline (helper NUEVO, evita duplicar la expresión) ──
-- La exploración pedía resolver "la agencia ACTIVA del AGENTE objetivo vía agency_members",
-- NUNCA por leads.agency_id (ese campo puede arrastrar el fallback a membresía SUSPENDIDA de
-- #203.1/20260904200001 — el lead de un agente suspendido nace bajo la agencia de su última
-- membresía suspendida, para que el "lead sin gestor" no quede huérfano; es una regla de OTRA
-- policy, no de esta RPC). Los helpers que hacían justo esto por membresía COMPARTIDA HOY
-- (private.is_agency_owner_of/is_agency_admin_of) ya NO sirven para leads:
-- private.is_agency_admin_of fue ELIMINADO por 20260807000006 (75.5-bis, el mismo bug de
-- deriva histórica que #100 corrigió en properties) y is_agency_owner_of quedó reservado a
-- properties. Se escribe un helper chico y nuevo (verificado en vivo: is_agency_admin_of NO
-- existe en la DB local — "function private.is_agency_admin_of(uuid) does not exist" — antes
-- de escribir esto se intentó reusarlo y falló) que compone la MISMA regla con las piezas que
-- SÍ siguen vigentes (private.agency_role_of, ya usado por leads_select 20260901000001):
--   1) agencia ACTIVA de p_agent_id, vía agency_members.status='active' (a lo más 1 fila,
--      constraint agency_members_one_active_per_user).
--   2) private.agency_role_of(esa agencia) — rol del CALLER en ella — IN ('owner','admin').
-- Se centraliza en `private` (Duplicated Code, CLAUDE.md §0: la expresión se repetiría en
-- crm_leads_page Y crm_funnel) en vez de escribirla 2 veces. Fail-closed: sin ninguna de las
-- 2 condiciones (p_agent_id=auth.uid() O el helper), RETURN vacío (plpgsql) — nunca una
-- excepción que distinga "no existe" de "no es tuyo" (anti-IDOR, molde
-- ad_metrics_for_agency/get_lead_stats). Idéntico en AMBAS funciones (mismo D-AUTZ). Sin
-- EXECUTE para ningún rol de cliente (mismo criterio que private.crm_temperature/crm_band,
-- 266.2): solo lo llaman estas 2 RPC, ya SECURITY DEFINER.
--
-- ── Cursor keyset con as_of congelado (D-ASOF/D-TIEBREAK/D-NEXTCURSOR/D-REMAINING) ─────────
-- v_as_of = coalesce((p_cursor->>'as_of')::timestamptz, now()) — se recalcula T1 con ESE
-- reloj para TODAS las páginas de una misma corrida (permite que el número de un lead no
-- cambie a media paginación, precedente de private.crm_temperature 266.2). ORDER BY
-- temperature DESC, lead_id ASC; el predicado del keyset y "remaining" usan la MISMA
-- comparación relativa a la última fila devuelta — remaining = cuántas filas de `matched`
-- (banda+query, SIN el filtro del cursor de entrada) quedan estrictamente DESPUÉS de esa fila.
--
-- ── Batch, no N+1 para strong_signal_at/last_activity_at (patrón get_lead_stats) ───────────
-- Un solo scan por tipo de señal (saves/likes/events_raw/lead_origin_properties), filtrado a
-- los usuarios de ESTE agente y agregado por user_id — evita 1 subconsulta correlacionada por
-- lead. private.crm_temperature/private.crm_band SÍ se llaman por lead (no se puede evitar sin
-- tocar su contrato ya publicado en 266.2, congelado por 100_crm_temperature_test.sql) — el
-- riesgo de performance de esto es EXACTAMENTE el que el PLAN de la subtarea señaló; medido con
-- el seed de 266.1 y pegado en la bitácora del GREEN (criterio <300 ms, fallback documentado si
-- no se cumple).
--
-- ponytail: `signals` (ambas funciones lo devuelven en el tipo, pero NINGÚN assert del RED fija
-- su contenido exacto) se llena con conteos ALL-TIME hasta v_as_of (video_completed/
-- video_views/likes/saves) reusando el mismo scan de strong_signal_at — cero costo extra. Techo
-- conocido: si el diseño de UI pide una ventana específica (p.ej. "señales de los últimos 7
-- días"), esto se ajusta ahí; no se especula hoy sin ese requisito.
--
-- Idempotente: create or replace function + revoke/grant repetibles.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 0) private.can_manage_agent_pipeline — helper de D-AUTZ, compartido por las 2 RPC.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function private.can_manage_agent_pipeline(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- coalesce a false: sin esto, "sin agencia activa" o "sin rol en ella" produce NULL (no
  -- false) por la lógica de 3 valores de SQL, y un `IF NOT (... OR NULL) THEN` de plpgsql
  -- trata ese NULL como falso -- NO entra al bloque -- dejando pasar al no autorizado
  -- (hallazgo real del GREEN: AG2/PADMIN/OWN2 veían el pipeline ajeno hasta este fix).
  select coalesce(
    private.agency_role_of(
      (select am.agency_id from public.agency_members am
        where am.user_id = p_agent_id and am.status = 'active' limit 1)
    ) in ('owner', 'admin'),
    false
  );
$$;

comment on function private.can_manage_agent_pipeline(uuid) is
  'D-AUTZ de crm_leads_page/crm_funnel (subtarea 266.4): true si el CALLER es owner/admin '
  'ACTIVO de la agencia donde p_agent_id (el AGENTE objetivo) está ACTIVO hoy '
  '(agency_members.status=''active'', vía private.agency_role_of — NUNCA leads.agency_id, '
  'que puede arrastrar el fallback a membresía suspendida de #203.1). Reemplaza a '
  'private.is_agency_admin_of, eliminado por 20260807000006 (75.5-bis) por el mismo defecto '
  'de deriva histórica que #100 corrigió en properties. Sin EXECUTE para ningún rol de '
  'cliente: solo lo llaman RPC ya SECURITY DEFINER.';

revoke execute on function private.can_manage_agent_pipeline(uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) public.crm_leads_page
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.crm_leads_page(
  p_agent_id uuid,
  p_band text default null,
  p_cursor jsonb default null,
  p_limit int default 20,
  p_query text default null
)
returns table (
  lead_id           uuid,
  user_id           uuid,
  full_name         text,
  avatar_url        text,
  temperature       integer,
  delta             integer,
  band              text,
  signals           jsonb,
  sparkline         integer[],
  last_activity_at  timestamptz,
  origin_property   jsonb,
  status_projected  text,
  next_cursor       jsonb,
  remaining         integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_as_of      timestamptz := coalesce((p_cursor ->> 'as_of')::timestamptz, now());
  v_cur_temp   int         := (p_cursor ->> 'temperature')::int;
  v_cur_lead   uuid        := (p_cursor ->> 'lead_id')::uuid;
  v_trend_days int;
begin
  -- D-AUTZ fail-closed: sin ninguna de las 2 condiciones, vacío sin tocar leads (anti-IDOR).
  -- coalesce a false (defensa en profundidad, ver comentario del helper): un `IF NOT (x OR
  -- NULL) THEN` trataría NULL como "no entra al bloque" y dejaría pasar al no autorizado.
  if not coalesce(
    p_agent_id = (select auth.uid())
    or private.can_manage_agent_pipeline(p_agent_id),
    false
  ) then
    return;
  end if;

  v_trend_days := coalesce(
    (select (value::text)::numeric from public.app_config where key = 'crm_trend_window_days'),
    3
  )::int;

  return query
  with base_leads as (
    -- "Mis X" filtra EXPLÍCITO por p_agent_id (#226/77) — nunca por RLS relajada.
    select
      l.id as lead_id,
      l.user_id,
      l.status,
      u.first_name,
      u.last_name,
      u.avatar_url
    from public.leads l
    join public.users u on u.id = l.user_id
    where l.agent_id = p_agent_id
      and l.deleted_at is null
      and (
        p_query is null or p_query = ''
        or (coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) ilike ('%' || p_query || '%')
      )
  ),
  origin as (
    -- Primer contacto por lead (misma regla que get_lead_stats 20260808000002): la fila con
    -- MENOR contacted_at, vía DISTINCT ON.
    select distinct on (lop.lead_id)
      lop.lead_id, lop.property_id, lop.contacted_at, p.address
    from public.lead_origin_properties lop
    join public.properties p on p.id = lop.property_id
    join base_leads bl on bl.lead_id = lop.lead_id
    order by lop.lead_id, lop.contacted_at asc
  ),
  signal_ts as (
    -- Batch por (agente, usuario): UN scan por tipo de señal, filtrado a los usuarios de
    -- ESTE agente, agregado por user_id — evita 1 subconsulta correlacionada por lead.
    select
      u.user_id,
      max(u.ts) filter (
        where u.kind in ('save', 'video_completed', 'contact_repeat', 'zone_search')
      ) as strong_signal_at,
      max(u.ts) as last_activity_at,
      count(*) filter (where u.kind = 'video_completed') as video_completed_count,
      count(*) filter (where u.kind = 'video_view') as video_view_count,
      count(*) filter (where u.kind = 'like') as like_count,
      count(*) filter (where u.kind = 'save') as save_count
    from (
      select sv.user_id, sv.created_at as ts, 'save'::text as kind
      from public.saves sv
      join public.properties p on p.id = sv.property_id
      where p.owner_user_id = p_agent_id
        and sv.created_at <= v_as_of
        and sv.user_id in (select bl.user_id from base_leads bl)
      union all
      select lk.user_id, lk.created_at, 'like'
      from public.likes lk
      join public.properties p on p.id = lk.property_id
      where p.owner_user_id = p_agent_id
        and lk.created_at <= v_as_of
        and lk.user_id in (select bl.user_id from base_leads bl)
      union all
      select er.user_id, er.created_at, er.event_type
      from public.events_raw er
      join public.properties p on p.id = er.property_id
      where er.event_type in ('video_view', 'video_completed', 'contact_repeat', 'zone_search')
        and p.owner_user_id = p_agent_id
        and er.created_at <= v_as_of
        and er.user_id in (select bl.user_id from base_leads bl)
      union all
      select bl.user_id, lop.contacted_at, 'contact'
      from public.lead_origin_properties lop
      join base_leads bl on bl.lead_id = lop.lead_id
      where lop.contacted_at <= v_as_of
    ) u
    group by u.user_id
  ),
  daily_days as (
    select generate_series((v_as_of::date - 13), v_as_of::date, interval '1 day')::date as day
  ),
  daily_matrix as (
    -- CROSS JOIN acotado a 14 días por lead (PK lead_id+day de lead_temperature_daily) —
    -- alimenta sparkline (int[14], D-*) Y max14 (banda) en un solo pase.
    select bl.lead_id, dd.day, dtd.temperature
    from base_leads bl
    cross join daily_days dd
    left join public.lead_temperature_daily dtd
      on dtd.lead_id = bl.lead_id and dtd.day = dd.day
  ),
  sparkline_agg as (
    select
      dm.lead_id,
      array_agg(dm.temperature order by dm.day asc) as sparkline,
      max(dm.temperature) as max14_daily
    from daily_matrix dm
    group by dm.lead_id
  ),
  scored as (
    select
      bl.lead_id,
      bl.user_id,
      bl.status,
      bl.first_name,
      bl.last_name,
      bl.avatar_url,
      private.crm_temperature(p_agent_id, bl.user_id, v_as_of) as temperature,
      private.crm_temperature(
        p_agent_id, bl.user_id, v_as_of - (v_trend_days || ' days')::interval
      ) as temp_prev,
      st.strong_signal_at,
      st.last_activity_at,
      coalesce(st.video_completed_count, 0) as video_completed_count,
      coalesce(st.video_view_count, 0) as video_view_count,
      coalesce(st.like_count, 0) as like_count,
      coalesce(st.save_count, 0) as save_count,
      sa.sparkline,
      sa.max14_daily,
      o.property_id as origin_property_id,
      o.address as origin_address,
      o.contacted_at as origin_contacted_at
    from base_leads bl
    left join signal_ts st on st.user_id = bl.user_id
    left join sparkline_agg sa on sa.lead_id = bl.lead_id
    left join origin o on o.lead_id = bl.lead_id
  ),
  banded as (
    select
      s.*,
      greatest(coalesce(s.max14_daily, s.temperature), s.temperature) as max14,
      private.crm_band(
        true,
        s.temperature,
        s.temp_prev,
        greatest(coalesce(s.max14_daily, s.temperature), s.temperature),
        s.strong_signal_at,
        (
          select max(h.changed_at)
          from public.lead_status_history h
          where h.lead_id = s.lead_id
            and h.old_status is not null
            and h.changed_at <= v_as_of
        ),
        v_as_of
      ) as band
    from scored s
  ),
  matched as (
    -- Universo COMPLETO que matchea banda+query (sin el filtro del cursor de entrada) —
    -- es la base de "remaining" (D-REMAINING).
    select * from banded bd
    where p_band is null or bd.band = p_band
  ),
  paged as (
    -- D-TIEBREAK: predicado del keyset relativo al cursor de ENTRADA.
    select
      m.*,
      row_number() over (order by m.temperature desc, m.lead_id asc) as rn
    from matched m
    where v_cur_temp is null
       or (m.temperature < v_cur_temp)
       or (m.temperature = v_cur_temp and m.lead_id > v_cur_lead)
  ),
  page_rows as (
    select * from paged where rn <= p_limit
  ),
  last_row as (
    -- Última fila DEVUELTA en esta página (ancla de next_cursor y de remaining).
    select pr0.temperature, pr0.lead_id from page_rows pr0 order by pr0.rn desc limit 1
  ),
  remaining_count as (
    -- D-REMAINING: filas de `matched` (universo completo) estrictamente DESPUÉS de la
    -- última fila de esta página, en el MISMO orden (temperature desc, lead_id asc).
    select count(*)::int as n
    from matched m, last_row lr
    where (m.temperature < lr.temperature)
       or (m.temperature = lr.temperature and m.lead_id > lr.lead_id)
  )
  select
    pr.lead_id,
    pr.user_id,
    nullif(trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), '') as full_name,
    pr.avatar_url,
    pr.temperature,
    (pr.temperature - pr.temp_prev) as delta,
    pr.band,
    jsonb_build_object(
      'video_completed', pr.video_completed_count,
      'video_views', pr.video_view_count,
      'likes', pr.like_count,
      'saves', pr.save_count
    ) as signals,
    pr.sparkline,
    pr.last_activity_at,
    case when pr.origin_property_id is null then null
      else jsonb_build_object(
        'property_id', pr.origin_property_id,
        'address', pr.origin_address,
        'contacted_at', pr.origin_contacted_at
      )
    end as origin_property,
    -- D-STATUSPROJ: proyección 8→4 exacta de la exploración 045 §7.4, los 11 valores del
    -- enum incluidos los 3 legacy (new, in_progress, closed_won).
    case pr.status
      when 'whatsapp_opened'  then 'nuevo'
      when 'new'              then 'nuevo'
      when 'contacted'        then 'contactado'
      when 'interested'       then 'contactado'
      when 'in_progress'      then 'contactado'
      when 'visit_scheduled'  then 'visita'
      when 'closed_won_rent'  then 'cerrado'
      when 'closed_won_sale'  then 'cerrado'
      when 'closed_lost'      then 'cerrado'
      when 'discarded'        then 'cerrado'
      when 'closed_won'       then 'cerrado'
    end as status_projected,
    case when (select n from remaining_count) = 0 then null
      else jsonb_build_object(
        'as_of', v_as_of,
        'temperature', (select lr2.temperature from last_row lr2),
        'lead_id', (select lr2.lead_id from last_row lr2)
      )
    end as next_cursor,
    (select n from remaining_count) as remaining
  from page_rows pr
  order by pr.temperature desc, pr.lead_id asc;
end;
$$;

comment on function public.crm_leads_page(uuid, text, jsonb, int, text) is
  'Página del pipeline del CRM (subtarea 266.4, exploración 045 §12): temperatura T1 en '
  'lectura (private.crm_temperature) + banda por tendencia (private.crm_band) + sparkline '
  '14d (lead_temperature_daily) + status_projected 8→4 (§7.4) + cursor keyset (temperature '
  'desc, lead_id asc) con as_of congelado dentro del cursor. D-AUTZ fail-closed: '
  'p_agent_id=auth.uid() o owner/admin de SU agencia activa hoy '
  '(private.can_manage_agent_pipeline) — sin autorización, 0 filas, nunca excepción. '
  '"Mis X" filtra EXPLÍCITO por p_agent_id (#226/77).';

revoke execute on function public.crm_leads_page(uuid, text, jsonb, int, text) from public, anon;
grant execute on function public.crm_leads_page(uuid, text, jsonb, int, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) public.crm_funnel
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.crm_funnel(
  p_agent_id uuid,
  p_days int default 30
)
returns table (
  vieron      integer,
  volvieron   integer,
  guardaron   integer,
  contactaron integer,
  agendaron   integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz;
begin
  -- D-AUTZ idéntica a crm_leads_page (mismo helper, mismo criterio fail-closed).
  -- coalesce a false (defensa en profundidad, ver comentario del helper): un `IF NOT (x OR
  -- NULL) THEN` trataría NULL como "no entra al bloque" y dejaría pasar al no autorizado.
  if not coalesce(
    p_agent_id = (select auth.uid())
    or private.can_manage_agent_pipeline(p_agent_id),
    false
  ) then
    return;
  end if;

  v_since := now() - (p_days || ' days')::interval;

  return query
  with agent_props as (
    select id from public.properties where owner_user_id = p_agent_id
  ),
  views as (
    -- D-FUNNEL-WINDOW: frontera INFERIOR inclusiva, sin límite superior.
    select er.user_id, er.session_id
    from public.events_raw er
    where er.event_type = 'video_view'
      and er.created_at >= v_since
      and er.property_id in (select id from agent_props)
  ),
  vieron_c as (
    select count(distinct user_id)::int as n from views
  ),
  volvieron_c as (
    -- D-VOLVIERON: distinct user_id con >= 2 session_id DISTINTOS.
    select count(*)::int as n
    from (
      select user_id from views group by user_id having count(distinct session_id) >= 2
    ) t
  ),
  guardaron_c as (
    select count(distinct sv.user_id)::int as n
    from public.saves sv
    where sv.created_at >= v_since
      and sv.property_id in (select id from agent_props)
  ),
  contactaron_c as (
    select count(*)::int as n
    from public.leads l
    where l.agent_id = p_agent_id
      and l.created_at >= v_since
  ),
  agendaron_c as (
    -- D-AGENDARON: distinct lead_id (no count(*)) — reprogramar 2 veces el mismo lead no
    -- infla el KPI.
    select count(distinct h.lead_id)::int as n
    from public.lead_status_history h
    join public.leads l on l.id = h.lead_id
    where l.agent_id = p_agent_id
      and h.new_status = 'visit_scheduled'
      and h.changed_at >= v_since
  )
  select
    (select n from vieron_c),
    (select n from volvieron_c),
    (select n from guardaron_c),
    (select n from contactaron_c),
    (select n from agendaron_c);
end;
$$;

comment on function public.crm_funnel(uuid, int) is
  'Embudo del CRM (subtarea 266.4, exploración 045 §12): 5 KPIs agregados '
  '(vieron/volvieron/guardaron/contactaron/agendaron) SIEMPRE como conteos, nunca filas de '
  'no-leads (registrar ≠ exponer). Ventana p_days con frontera INFERIOR inclusiva '
  '(events_raw.created_at, saves.created_at, leads.created_at, '
  'lead_status_history.changed_at). D-AUTZ idéntica a crm_leads_page.';

revoke execute on function public.crm_funnel(uuid, int) from public, anon;
grant execute on function public.crm_funnel(uuid, int) to authenticated;
