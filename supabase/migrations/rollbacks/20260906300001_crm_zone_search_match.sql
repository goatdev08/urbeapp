-- Rollback de 20260906300001_crm_zone_search_match.sql (subtarea 268.3).
-- Restaura private.crm_temperature EXACTAMENTE a la versión de 20260906100001 (subtarea
-- 266.2, other_events sin emparejamiento espacial). No toca private.crm_band (esta
-- migración nunca la tocó). create or replace + revoke: idempotente, repetible.

create or replace function private.crm_temperature(
  p_agent_id uuid,
  p_user_id uuid,
  p_at timestamptz
)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_weight_video_completed'), 10) as w_video,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_max_video_completed'), 5)::int as max_video,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_weight_like'), 5) as w_like,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_weight_save'), 18) as w_save,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_weight_contact_first'), 30) as w_contact_first,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_weight_contact_repeat'), 30) as w_contact_repeat,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_weight_zone_search'), 8) as w_zone_search,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_decay_daily'), 0.08) as decay,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_temp_floor_active_lead'), 0) as floor_active
  ),
  active_lead as (
    select l.id
    from public.leads l
    where l.agent_id = p_agent_id
      and l.user_id = p_user_id
      and l.deleted_at is null
  ),
  contacts as (
    -- 1ª fila por contacted_at = piso de entrada; el resto = re-contacto (§7.2). Solo del
    -- lead ACTIVO (join a active_lead: un lead borrado no aporta nada).
    select
      lop.contacted_at as ts,
      case when row_number() over (order by lop.contacted_at asc) = 1
           then cfg.w_contact_first
           else cfg.w_contact_repeat
      end as weight
    from public.lead_origin_properties lop
    join active_lead al on al.id = lop.lead_id
    cross join cfg
    where lop.contacted_at <= p_at
  ),
  video_events as (
    -- Tope crm_max_video_completed: cuentan los MÁS RECIENTES (order by desc + limit).
    select er.created_at as ts, cfg.w_video as weight
    from public.events_raw er
    join public.properties p on p.id = er.property_id
    cross join cfg
    where er.event_type = 'video_completed'
      and p.owner_user_id = p_agent_id
      and er.user_id = p_user_id
      and er.created_at <= p_at
    order by er.created_at desc
    limit (select max_video from cfg)
  ),
  other_events as (
    -- Fase C, aditivo: nadie escribe estos event_type hoy, pero la fórmula ya los suma.
    select
      er.created_at as ts,
      case er.event_type
        when 'zone_search' then cfg.w_zone_search
        when 'contact_repeat' then cfg.w_contact_repeat
      end as weight
    from public.events_raw er
    join public.properties p on p.id = er.property_id
    cross join cfg
    where er.event_type in ('zone_search', 'contact_repeat')
      and p.owner_user_id = p_agent_id
      and er.user_id = p_user_id
      and er.created_at <= p_at
  ),
  likes_signal as (
    select l.created_at as ts, cfg.w_like as weight
    from public.likes l
    join public.properties p on p.id = l.property_id
    cross join cfg
    where p.owner_user_id = p_agent_id
      and l.user_id = p_user_id
      and l.created_at <= p_at
  ),
  saves_signal as (
    select s.created_at as ts, cfg.w_save as weight
    from public.saves s
    join public.properties p on p.id = s.property_id
    cross join cfg
    where p.owner_user_id = p_agent_id
      and s.user_id = p_user_id
      and s.created_at <= p_at
  ),
  all_signals as (
    select ts, weight from contacts
    union all select ts, weight from video_events
    union all select ts, weight from other_events
    union all select ts, weight from likes_signal
    union all select ts, weight from saves_signal
  ),
  totals as (
    select coalesce(sum(
      all_signals.weight * power(1 - cfg.decay, (extract(epoch from (p_at - all_signals.ts)))::numeric / 86400)
    ), 0) as raw_sum
    from all_signals
    cross join cfg
  )
  select least(100, round(greatest(
    case when exists (select 1 from active_lead) then (select floor_active from cfg) else 0 end,
    (select raw_sum from totals)
  )))::int;
$$;

comment on function private.crm_temperature(uuid, uuid, timestamptz) is
  'T1 (subtarea 266.2, exploración 045 §7.1): min(100, round(greatest(piso_activo, '
  'Σ w_i·(1−decay)^días))) sobre video_completed/likes/saves/contacto (lead activo) + '
  'zone_search/contact_repeat aditivos de fase C. Reloj SIEMPRE por p_at, nunca now(). '
  'Claves de app_config por COALESCE, NO sembradas. Helper interno de las RPC de '
  '266.4–266.6 — sin EXECUTE para anon/authenticated.';

revoke execute on function private.crm_temperature(uuid, uuid, timestamptz) from public, anon, authenticated;
