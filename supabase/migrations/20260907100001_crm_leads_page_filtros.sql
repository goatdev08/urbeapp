-- Migración 20260907100001 — public.crm_leads_page gana p_status/p_follow_up (subtarea
-- 271.1, tarea #271 producto(267), exploración 045 §19 tarea G "hoja completa de filtros").
-- Rollback: supabase/migrations/rollbacks/20260907100001_crm_leads_page_filtros.sql
-- Tests: supabase/tests/102_crm_leads_page_funnel_test.sql (plan 93, extendido desde 72;
-- el contrato completo — SEAMS, D-STATUSARRAY/D-FOLLOWUP nuevas + las D-* de 266.4 vigentes,
-- edge cases — está en la cabecera de ese archivo).
--
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 STUB RED (2026-09-07): esta migración SOLO ensancha la FIRMA de public.crm_leads_page
-- (2 parámetros nuevos, ambos DEFAULT NULL) para que el pgTAP falle por ASERCIÓN de
-- filtrado, nunca por "función no existe" ni por error de tipo de argumento. El CUERPO es
-- BYTE POR BYTE el mismo que 20260906100003_crm_leads_page_funnel.sql — los 2 parámetros
-- nuevos se declaran pero se IGNORAN por completo (no hay ninguna referencia a ellos dentro
-- del cuerpo). Las líneas marcadas `-- STUB RED` son las que el GREEN de 271.1 debe tocar:
--   1) subir status_projected (CASE 8→4) de la proyección final a la CTE `banded` (punto
--      delicado 2 de la subtarea, evitando duplicar el CASE en 2 sitios).
--   2) filtrar por p_status (sobre status_projected) y por p_follow_up dentro de la CTE
--      `matched` (punto delicado 1: es el universo base de `remaining`, D-REMAINING).
-- Ensanchamiento puro del contrato (§0.5.2): p_status/p_follow_up con DEFAULT NULL, ningún
-- build instalado (que llama con los 5 parámetros de hoy) pierde nada. DROP+CREATE en UNA
-- transacción porque cambiar la firma (agregar parámetros) NO admite `create or replace`
-- (Postgres trataría los 7 tipos de argumento como una identidad de función DISTINTA de la
-- de 5 — quedarían 2 overloads en vez de 1 reemplazado).
-- ════════════════════════════════════════════════════════════════════════════

begin;

drop function if exists public.crm_leads_page(uuid, text, jsonb, int, text);

create or replace function public.crm_leads_page(
  p_agent_id uuid,
  p_band text default null,
  p_cursor jsonb default null,
  p_limit int default 20,
  p_query text default null,
  p_status text[] default null,      -- STUB RED: declarado, IGNORADO por completo abajo
  p_follow_up boolean default null   -- STUB RED: declarado, IGNORADO por completo abajo
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
    -- STUB RED: status_projected (CASE 8→4) DEBE subir aquí (punto delicado 2) para que
    -- `matched` pueda filtrar por él sin duplicar el CASE del SELECT final. El stub NO lo
    -- hace todavía — se calcula solo abajo, en el SELECT final, como en 266.4.
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
    -- STUB RED: p_status/p_follow_up DEBEN entrar aquí (punto delicado 1, mismo criterio que
    -- p_band — `matched` es el universo base de `remaining`, D-REMAINING). El stub los IGNORA
    -- por completo: universo COMPLETO que matchea banda+query, exactamente igual que 266.4.
    select * from banded bd
    where p_band is null or bd.band = p_band
  ),
  paged as (
    -- D-TIEBREAK: predicado del keyset relativo al cursor de ENTRADA. NO se toca (Abraham
    -- descartó el selector de orden — el ORDER BY y la forma del cursor quedan intactos).
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

comment on function public.crm_leads_page(uuid, text, jsonb, int, text, text[], boolean) is
  'Página del pipeline del CRM (subtarea 266.4 + 271.1, exploración 045 §12/§19): temperatura '
  'T1 en lectura (private.crm_temperature) + banda por tendencia (private.crm_band) + '
  'sparkline 14d (lead_temperature_daily) + status_projected 8→4 (§7.4) + cursor keyset '
  '(temperature desc, lead_id asc) con as_of congelado dentro del cursor + filtro por los 4 '
  'estados proyectados (p_status, D-STATUSARRAY) + filtro por seguimiento (p_follow_up, '
  'D-FOLLOWUP) — AMBOS en la CTE matched, base de remaining. D-AUTZ fail-closed: '
  'p_agent_id=auth.uid() o owner/admin de SU agencia activa hoy '
  '(private.can_manage_agent_pipeline) — sin autorización, 0 filas, nunca excepción. '
  '"Mis X" filtra EXPLÍCITO por p_agent_id (#226/77).';

revoke execute on function public.crm_leads_page(uuid, text, jsonb, int, text, text[], boolean) from public, anon;
grant execute on function public.crm_leads_page(uuid, text, jsonb, int, text, text[], boolean) to authenticated;

commit;
