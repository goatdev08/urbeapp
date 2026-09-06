-- Migración 20260906100002 — public.lead_temperature_daily + public.snapshot_lead_temperature()
-- + public.purge_events_raw() + 2 jobs pg_cron + check_rollup_health() extendida + índice
-- leads_agent_score_idx (subtarea 266.3, exploración 045 §8.2-§8.4). Aditiva pura: 1 tabla
-- nueva, 2 funciones nuevas, create or replace de check_rollup_health() (MISMA firma, sin
-- consumidores móviles ni EF — no es contrato publicado), 2 jobs nuevos de pg_cron, 1 índice.
-- Rollback: supabase/migrations/rollbacks/20260906100002_crm_temperature_daily.sql
-- Tests: supabase/tests/101_crm_temperature_daily_test.sql (plan 87) — el contrato completo
-- (SEAMS, decisiones D-EOD/D-SIGNALS/D-COND-C/D-COND-D/D-SNAPSHOT-ARG, edge cases) está en la
-- cabecera de ese archivo; no se repite aquí para no duplicar la fuente de verdad.
--
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ: snapshot diario por (lead_id, day) de la temperatura (private.crm_temperature,
-- 266.2) + conteo de señales del día, para que el sparkline del CRM (266.4+) tenga
-- historial real. Backfill de 14 días al aplicar esta migración (para que el sparkline no
-- nazca plano) y purga de events_raw a 90 días (decisión ya tomada en la exploración 045
-- §8.4: retención = borrado real de crudo, el agregado en lead_temperature_daily no caduca).
--
-- ── D-EOD: corte de día en UTC FIJO, nunca el timezone de sesión ────────────────────────────
-- p_at = medianoche UTC del día SIGUIENTE a p_day, calculado como
-- `((p_day + 1)::timestamp) at time zone 'utc'` — un timestamp SIN zona interpretado
-- explícitamente como UTC produce el mismo timestamptz sin importar el `set local timezone`
-- de la sesión (verificado en el RED bajo 4 zonas: UTC/America/Mexico_City/Pacific/Kiritimati/
-- Pacific/Niue, mismo resultado 28 en los 4 casos). El mismo par (v_day_start, v_day_end)
-- acota el conteo de `signals` (D-SIGNALS: conteo POR DÍA, nunca acumulado histórico).
--
-- ── Snapshot SOLO de leads (registrar ≠ exponer) ────────────────────────────────────────────
-- Decisión de la exploración 045 §8.2: el snapshot es solo de leads activos (deleted_at is
-- null) — las filas anónimas del radar no persisten historial por persona sin lead; su
-- sparkline se calcula en lectura desde events_raw dentro de la retención de 90 días.
--
-- ── Elegibilidad por día: nunca fabricar historia ANTES de que el lead existiera ────────────
-- Un lead solo recibe fila para el día D si `coalesce(min(lead_origin_properties.contacted_at
-- del lead), leads.first_contact_at) < medianoche UTC del día SIGUIENTE a D` — el primer
-- contacto real (o el alta del
-- lead si nunca tuvo un origen registrado) es el "día cero" de su sparkline. Sin este piso,
-- un backfill de 14 días o una corrida puntual para una fecha vieja fabricaría presencia para
-- leads que ni existían entonces (verificado en el GREEN: sin el piso, un lead con actividad
-- de hace 20 días heredaba también filas de corridas puntuales de OTROS tests para fechas de
-- hace 3-6 meses, ninguna de las cuales pertenece a su backfill de 14 días).
--
-- ── Append-only con dientes (molde lead_status_history, 20260807000003:110-128) ─────────────
-- revoke all ANTES de grant select a authenticated; RLS select vía private.can_view_lead
-- (mismo helper que lead_status_history/lead_origin_properties — ya excluye admin de
-- plataforma, fix #226). Ninguna policy ni grant de insert/update/delete para authenticated:
-- solo service_role escribe (pg_cron corre como el rol que programó el job).
--
-- ── purge_events_raw(): misma retención que purge_ad_impressions (90 días, frontera `<`
-- estricta — exactamente 90 días se CONSERVA), pero sobre events_raw (tabla de producto, no
-- facturable). NUNCA toca lead_temperature_daily (el agregado no caduca).
--
-- ── check_rollup_health() extendida — condiciones C y D, mismo mecanismo (public.notifications,
-- type='admin_rollup_unhealthy', índice ancla notifications_admin_rollup_unhealthy_anchor_idx
-- de 20260904300001) que las condiciones A/B ORIGINALES, que esta migración NO toca:
--   C (stale_snapshot): existe ≥1 lead activo y NINGUNA fila en lead_temperature_daily con
--     day ∈ {hoy, ayer} — existencia global, mismo estilo laxo que la condición B (no exige
--     1 fila por lead). Un aviso por día mientras siga así (anchor por fecha).
--   D (job_failing, generalizada): mismo criterio que la condición A (últimas 3 corridas de
--     cron.job_run_details sin ningún 'succeeded'), aplicado a CADA UNO de los 2 jobs nuevos
--     por separado — NUNCA a rollup_ad_impressions_monthly_daily (esa sigue siendo,
--     verbatim, la condición A; NEG4 de 92_rollup_monitor_test.sql exige que un job ajeno
--     caído no dispare esa alerta). El anchor de D lleva el jobname (`job_failing:<job>:
--     <fecha>`) — a diferencia del anchor de A (`job_failing:<fecha>`, sin jobname, sin
--     tocar) — para que dos jobs caídos el mismo día no colisionen en el índice único.
--
-- ── Índice — el único que el EXPLAIN de 266.1 justificó ─────────────────────────────────────
-- leads_agent_score_idx (agent_id, score desc) where deleted_at is null. Ningún otro.
--
-- Idempotente: create table if not exists, create or replace function, cron.schedule
-- idempotente por jobname, create index if not exists, drop policy if exists + create.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1) public.lead_temperature_daily
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.lead_temperature_daily (
  lead_id     uuid not null references public.leads (id) on delete cascade,
  day         date not null,
  temperature integer not null,
  signals     jsonb not null default '{}'::jsonb,
  primary key (lead_id, day)
);

comment on table public.lead_temperature_daily is
  'Snapshot diario por lead de la temperatura (private.crm_temperature, 266.2) y el conteo '
  'de señales DEL DÍA (video_completed/likes/saves/contacts — no acumulado). Solo leads '
  'ACTIVOS (deleted_at is null): las filas anónimas del radar no persisten historial por '
  'persona sin lead (registrar ≠ exponer). Escrito exclusivamente por '
  'public.snapshot_lead_temperature() vía pg_cron. Append-only con dientes: sin policy ni '
  'grant de insert/update/delete para authenticated.';

alter table public.lead_temperature_daily enable row level security;

drop policy if exists lead_temperature_daily_select on public.lead_temperature_daily;
create policy lead_temperature_daily_select on public.lead_temperature_daily
  for select to authenticated
  using (private.can_view_lead(lead_id));

revoke all on public.lead_temperature_daily from anon, authenticated;
grant select on public.lead_temperature_daily to authenticated;
grant select, insert, update, delete on public.lead_temperature_daily to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) public.snapshot_lead_temperature(p_day date default current_date)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.snapshot_lead_temperature(p_day date default current_date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day_start timestamptz := (p_day::timestamp) at time zone 'utc';
  v_day_end   timestamptz := ((p_day + 1)::timestamp) at time zone 'utc';
begin
  insert into public.lead_temperature_daily (lead_id, day, temperature, signals)
  select
    l.id,
    p_day,
    private.crm_temperature(l.agent_id, l.user_id, v_day_end),
    jsonb_build_object(
      'video_completed', (
        select count(*) from public.events_raw er
        join public.properties p on p.id = er.property_id
        where er.event_type = 'video_completed'
          and p.owner_user_id = l.agent_id
          and er.user_id = l.user_id
          and er.created_at >= v_day_start and er.created_at < v_day_end
      ),
      'likes', (
        select count(*) from public.likes lk
        join public.properties p on p.id = lk.property_id
        where p.owner_user_id = l.agent_id
          and lk.user_id = l.user_id
          and lk.created_at >= v_day_start and lk.created_at < v_day_end
      ),
      'saves', (
        select count(*) from public.saves sv
        join public.properties p on p.id = sv.property_id
        where p.owner_user_id = l.agent_id
          and sv.user_id = l.user_id
          and sv.created_at >= v_day_start and sv.created_at < v_day_end
      ),
      'contacts', (
        select count(*) from public.lead_origin_properties lop
        where lop.lead_id = l.id
          and lop.contacted_at >= v_day_start and lop.contacted_at < v_day_end
      )
    )
  from public.leads l
  where l.deleted_at is null
    and coalesce(
      (select min(lop.contacted_at) from public.lead_origin_properties lop where lop.lead_id = l.id),
      l.first_contact_at
    ) < v_day_end
  on conflict (lead_id, day) do update
    set temperature = excluded.temperature,
        signals = excluded.signals;
end;
$$;

comment on function public.snapshot_lead_temperature(date) is
  'Snapshot diario (subtarea 266.3): upsert de temperatura + signals por día para TODOS los '
  'leads activos (deleted_at is null). p_at = medianoche UTC del día siguiente a p_day, FIJO '
  '(nunca el timezone de sesión — D-EOD). signals cuenta solo eventos con timestamp DENTRO '
  'de p_day (D-SIGNALS, no acumulado). Idempotente (upsert por PK); recalcula si llega '
  'actividad nueva del mismo día (no es insert ciego). Programada diario vía pg_cron '
  '(jobname snapshot_lead_temperature_daily, 0 7 * * * UTC, antes de la purga de las 9 y del '
  'monitor de las 10). SECURITY DEFINER, solo service_role.';

revoke execute on function public.snapshot_lead_temperature(date) from public, anon, authenticated;
grant execute on function public.snapshot_lead_temperature(date) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) public.purge_events_raw() — retención 90 días (misma constante que
--    purge_ad_impressions, 20260817000002), frontera `<` estricta. NUNCA toca
--    lead_temperature_daily (el agregado no caduca).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.purge_events_raw()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.events_raw
   where created_at < now() - interval '90 days';
end;
$$;

comment on function public.purge_events_raw() is
  'Borra de events_raw lo que rebasa 90 días por created_at (frontera `<` estricta -- '
  'exactamente 90 días se conserva, mismo patrón que purge_ad_impressions '
  '20260817000002). NUNCA toca lead_temperature_daily (el agregado del snapshot no '
  'caduca). Programada diario vía pg_cron (jobname purge_events_raw_daily, 0 9 * * * UTC, '
  'después del snapshot de las 7). SECURITY DEFINER, solo service_role.';

revoke execute on function public.purge_events_raw() from public, anon, authenticated;
grant execute on function public.purge_events_raw() to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) pg_cron — 2 jobs nuevos. Snapshot antes de la purga. La extensión ya está
--    instalada (20260817000002); cron.schedule con el mismo jobname actualiza
--    in-place, no duplica.
-- ════════════════════════════════════════════════════════════════════════════

select cron.schedule(
  'snapshot_lead_temperature_daily',
  '0 7 * * *',
  'select public.snapshot_lead_temperature();'
);

select cron.schedule(
  'purge_events_raw_daily',
  '0 9 * * *',
  'select public.purge_events_raw();'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) public.check_rollup_health() EXTENDIDA — MISMA firma (returns void), condiciones
--    A/B ORIGINALES (20260904300001) intactas verbatim. Se agregan C y D.
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
  -- ── Condición D (266.3): jobs nuevos del snapshot diario del CRM, cada uno
  -- por separado -- NUNCA se mezcla con c_jobname (condición A, ver NEG4 de
  -- 92_rollup_monitor_test.sql: un job ajeno caído no dispara esa alerta).
  c_crm_jobnames constant text[] := array['snapshot_lead_temperature_daily', 'purge_events_raw_daily'];
  v_crm_jobname text;
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

  -- ── Condición C (266.3): snapshot faltante para hoy/ayer, habiendo ≥1 lead
  -- activo. Existencia GLOBAL (mismo estilo laxo que B): no exige 1 fila por
  -- lead, exige que el snapshot haya corrido hoy o ayer.
  if exists (select 1 from public.leads where deleted_at is null)
     and not exists (
       select 1 from public.lead_temperature_daily
       where day in (current_date, current_date - 1)
     )
  then
    v_anchor := 'stale_snapshot:' || to_char(current_date, 'YYYY-MM-DD');

    insert into public.notifications (
      user_id, type, title, body, deep_link, data
    )
    select
      u.id,
      'admin_rollup_unhealthy',
      'El snapshot diario del CRM no está corriendo',
      'No hay ningún snapshot en lead_temperature_daily para hoy ni ayer, y ' ||
      'existen leads activos: el sparkline de temperatura se está quedando sin datos.',
      '/admin',
      jsonb_build_object(
        'condition', 'stale_snapshot',
        'anchor', v_anchor
      )
    from public.users u
    where u.role = 'admin'
      and u.deleted_at is null
    on conflict (user_id, type, (data ->> 'anchor'))
      where type = 'admin_rollup_unhealthy'
      do nothing;
  end if;

  -- ── Condición D (266.3): CADA UNO de los 2 jobs nuevos, últimas 3 corridas
  -- sin ningún 'succeeded' -- mismo mecanismo que A, generalizado, NUNCA
  -- mezclado con c_jobname (A sigue siendo del rollup, solamente).
  foreach v_crm_jobname in array c_crm_jobnames loop
    v_jobid := null;
    select j.jobid into v_jobid from cron.job j where j.jobname = v_crm_jobname;

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
        v_anchor := 'job_failing:' || v_crm_jobname || ':' || to_char(now(), 'YYYY-MM-DD');

        insert into public.notifications (
          user_id, type, title, body, deep_link, data
        )
        select
          u.id,
          'admin_rollup_unhealthy',
          'Un job del CRM no está corriendo',
          'Las últimas ' || c_consecutive_failures || ' ejecuciones del job ' ||
          v_crm_jobname || ' no terminaron bien.',
          '/admin',
          jsonb_build_object(
            'condition', 'job_failing',
            'anchor', v_anchor,
            'job', v_crm_jobname,
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
  end loop;
end;
$$;

comment on function public.check_rollup_health() is
  'Monitor del rollup mensual de métricas de anuncios (#215) EXTENDIDO (266.3) con el '
  'snapshot diario del CRM. Avisa a los admin de plataforma VIVOS por public.notifications '
  '(type ''admin_rollup_unhealthy'', deep_link ''/admin'') cuando: (A) las últimas 3 '
  'ejecuciones de rollup_ad_impressions_monthly_daily no terminaron en ''succeeded''; (B) '
  'existe un mes con crudo en ad_impressions fuera de la ventana de 90 días sin fila en '
  'ad_impressions_monthly; (C) no existe NINGUNA fila en lead_temperature_daily para hoy ni '
  'ayer habiendo leads activos; (D) las últimas 3 ejecuciones de '
  'snapshot_lead_temperature_daily o de purge_events_raw_daily (cada uno por separado) no '
  'terminaron en ''succeeded''. Deduplicado con ON CONFLICT DO NOTHING sobre '
  'notifications_admin_rollup_unhealthy_anchor_idx (20260904300001). Programada diario vía '
  'pg_cron (jobname check_rollup_health_daily, 0 10 * * * UTC). Solo lectura salvo por las '
  'notificaciones que escribe: NO repara nada.';

revoke execute on function public.check_rollup_health() from public, anon, authenticated;
grant execute on function public.check_rollup_health() to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Índice leads_agent_score_idx — el único que el EXPLAIN de 266.1 justificó.
-- ════════════════════════════════════════════════════════════════════════════

create index if not exists leads_agent_score_idx
  on public.leads (agent_id, score desc)
  where deleted_at is null;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) Backfill — 14 días previos (incluye hoy) al aplicar la migración, para que
--    el sparkline no nazca plano.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  d date;
begin
  for d in select generate_series(current_date - 13, current_date, interval '1 day')::date loop
    perform public.snapshot_lead_temperature(d);
  end loop;
end $$;
