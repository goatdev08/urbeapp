-- Rollback: 20260906100002_crm_temperature_daily.sql (subtarea 266.3)
-- Desprograma los 2 jobs nuevos de pg_cron PRIMERO (jobs huérfanos apuntando a funciones
-- que van a desaparecer fallarían en silencio cada día), luego restaura
-- check_rollup_health() a su cuerpo ANTERIOR (copiado literal de 20260904300001 — mismas
-- condiciones A/B, sin C/D), y por último quita las 2 funciones nuevas, el índice y la
-- tabla. NO se desinstala pg_cron (compartida con purge_ad_impressions_daily,
-- rollup_ad_impressions_monthly_daily y check_rollup_health_daily).
--
-- ⚠️ Las notificaciones ya escritas con data->>'condition' en ('stale_snapshot',
-- 'job_failing') para los jobs nuevos NO se borran: son avisos reales que un admin pudo
-- haber leído. Quedan inertes; purge_notifications() las limpia a los 30 días por su
-- cuenta (mismo criterio que 20260904300001).

select cron.unschedule('snapshot_lead_temperature_daily')
where exists (select 1 from cron.job where jobname = 'snapshot_lead_temperature_daily');

select cron.unschedule('purge_events_raw_daily')
where exists (select 1 from cron.job where jobname = 'purge_events_raw_daily');

-- ════════════════════════════════════════════════════════════════════════════
-- Restaurar check_rollup_health() a su cuerpo ANTERIOR (literal de 20260904300001) --
-- MISMA firma, solo condiciones A/B.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.check_rollup_health()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- MISMA constante (90) que purge_ad_impressions (20260817000002),
  -- rollup_ad_impressions_monthly (20260823000004) y ad_metrics_for_agency
  -- (20260823000005) -- ver cabecera de esta migración.
  c_retention_days constant integer := 90;
  c_consecutive_failures constant integer := 3;
  c_jobname constant text := 'rollup_ad_impressions_monthly_daily';
  v_jobid bigint;
  v_statuses text[];
  v_stale_month date;
  v_anchor text;
begin
  -- ── Condición A: las últimas 3 corridas del rollup, ninguna 'succeeded' ──
  select j.jobid into v_jobid from cron.job j where j.jobname = c_jobname;

  if v_jobid is not null then
    select array_agg(r.status order by r.start_time desc)
      into v_statuses
      from (
        select d.status, d.start_time
        from cron.job_run_details d
        where d.jobid = v_jobid
        order by d.start_time desc
        limit c_consecutive_failures
      ) r;

    if coalesce(array_length(v_statuses, 1), 0) = c_consecutive_failures
       and not exists (select 1 from unnest(v_statuses) s where s = 'succeeded')
    then
      v_anchor := 'job_failing:' || to_char(now(), 'YYYY-MM-DD');

      insert into public.notifications (
        user_id, type, title, body, deep_link, data
      )
      select
        u.id,
        'admin_rollup_unhealthy',
        'El rollup de métricas no está corriendo',
        'Las últimas ' || c_consecutive_failures || ' ejecuciones del job ' ||
        c_jobname || ' no terminaron bien. Si sigue así, un mes de métricas ' ||
        'se congelará sin consolidar y no se podrá recuperar.',
        '/admin',
        jsonb_build_object(
          'condition', 'job_failing',
          'anchor', v_anchor,
          'job', c_jobname,
          'statuses', to_jsonb(v_statuses)
        )
      from public.users u
      where u.role = 'admin'
        and u.deleted_at is null
      on conflict (user_id, type, (data ->> 'anchor'))
        where type = 'admin_rollup_unhealthy'
        do nothing;
    end if;
  end if;

  -- ── Condición B: mes con crudo, fuera de la ventana, sin consolidar ─────
  -- ponytail: barrido completo de ad_impressions con date_trunc por fila, sin
  -- índice de apoyo. Techo conocido: la tabla vive 90 días por la purga y esto
  -- corre UNA vez al día -- añadir un índice funcional por adelantado sería
  -- optimizar sin medición. Si el volumen crece, el índice es
  -- (date_trunc('month', shown_at)).
  for v_stale_month in
    select distinct date_trunc('month', ai.shown_at)::date
    from public.ad_impressions ai
    where date_trunc('month', ai.shown_at)
            < now() - (c_retention_days || ' days')::interval
      and not exists (
        select 1
        from public.ad_impressions_monthly aim
        where aim.year_month = date_trunc('month', ai.shown_at)::date
      )
    order by 1
  loop
    v_anchor := 'stale_month:' || to_char(v_stale_month, 'YYYY-MM-DD');

    insert into public.notifications (
      user_id, type, title, body, deep_link, data
    )
    select
      u.id,
      'admin_rollup_unhealthy',
      'Un mes de métricas quedó sin consolidar',
      'El mes ' || to_char(v_stale_month, 'YYYY-MM') || ' salió de la ventana ' ||
      'de retención sin que el rollup lo consolidara: sus métricas ya no se ' ||
      'van a recuperar solas.',
      '/admin',
      jsonb_build_object(
        'condition', 'stale_month',
        'anchor', v_anchor,
        'month', to_char(v_stale_month, 'YYYY-MM-DD')
      )
    from public.users u
    where u.role = 'admin'
      and u.deleted_at is null
    on conflict (user_id, type, (data ->> 'anchor'))
      where type = 'admin_rollup_unhealthy'
      do nothing;
  end loop;
end;
$$;

comment on function public.check_rollup_health() is
  'Monitor del rollup mensual de métricas de anuncios (#215, hardening de '
  '#201.1). Avisa a los admin de plataforma VIVOS (role=''admin'' and '
  'deleted_at is null) por public.notifications (type '
  '''admin_rollup_unhealthy'', deep_link ''/admin'') cuando (A) las últimas 3 '
  'ejecuciones del job rollup_ad_impressions_monthly_daily no terminaron en '
  '''succeeded'', o (B) existe un mes con crudo en ad_impressions que ya salió '
  'de la ventana de 90 días sin ninguna fila en ad_impressions_monthly (la '
  'tolerancia ~90-len(M) días desde el fin de M ES ese mismo corte). '
  'Deduplicado con ON CONFLICT DO NOTHING sobre '
  'notifications_admin_rollup_unhealthy_anchor_idx: un aviso por día mientras '
  'el job siga caído, un aviso por mes afectado para siempre. Programada '
  'diario vía pg_cron (jobname check_rollup_health_daily, 0 10 * * * UTC -- '
  'después del rollup 0 8 y de la purga 0 9 del mismo día, en un hueco libre). '
  'Solo lectura salvo por las notificaciones que escribe: NO repara nada.';

revoke execute on function public.check_rollup_health() from public, anon, authenticated;
grant execute on function public.check_rollup_health() to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- Quitar lo aditivo de esta migración: funciones nuevas, índice, tabla.
-- ════════════════════════════════════════════════════════════════════════════

drop function if exists public.snapshot_lead_temperature(date);
drop function if exists public.purge_events_raw();

drop index if exists public.leads_agent_score_idx;

drop table if exists public.lead_temperature_daily;
