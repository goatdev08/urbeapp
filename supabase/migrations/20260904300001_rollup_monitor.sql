-- Migración 20260904300001 — public.check_rollup_health() (tarea #215,
-- hardening(201.1)). ADITIVA PURA: 1 índice único parcial nuevo sobre
-- public.notifications, 1 función nueva, 1 job de pg_cron nuevo. Ninguna
-- tabla creada ni alterada, ningún contrato publicado tocado (§0.5
-- producción viva) — ni la RPC ad_metrics_for_agency, ni
-- rollup_ad_impressions_monthly, ni los 4 escritores admin_notify_* se
-- modifican.
-- Rollback: supabase/migrations/rollbacks/20260904300001_rollup_monitor.sql
-- Tests: supabase/tests/92_rollup_monitor_test.sql (35 asserts) — el contrato
-- completo (edge cases, decisiones D-COND-A/B, D-DEST, D-ANCLA) está en la
-- cabecera de ese archivo.
--
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ y POR QUÉ (guardian de 201.1, 2026-08-23)
-- El rollup solo recalcula meses ELEGIBLES (inicio >= now() - 90 días,
-- 20260823000004) y ad_metrics_for_agency solo lee monthly para los NO
-- elegibles (20260823000005). La ventana de tolerancia para un mes M es, por
-- tanto, ~90 - len(M) días desde que M termina: si el job pg_cron queda caído
-- más que eso abarcando el fin de M, M se congela con lo consolidado hasta
-- entonces (parcial, o nada) y NUNCA se recupera. cron.job_run_details
-- registra los fallos pero nadie los mira. Esta función los mira, una vez al
-- día, y avisa a los admins de plataforma por el centro de notificaciones que
-- ya existe (#219) — sin infraestructura nueva.
--
-- ── Condición A — fallos consecutivos ─────────────────────────────────────
-- Las ÚLTIMAS 3 ejecuciones del job del rollup (jobname EXACTO
-- 'rollup_ad_impressions_monthly_daily', el de 20260823000004), ordenadas por
-- start_time desc, existen las 3 y NINGUNA tiene status = 'succeeded'.
-- `<> 'succeeded'` en vez de `= 'failed'` a propósito: pg_cron también deja
-- 'running'/'starting', y cualquiera de esos sostenido 3 corridas seguidas
-- significa lo mismo (el rollup no está consolidando). Con menos de 3
-- registros no alerta (aún no hay evidencia) y una sola 'succeeded' entre las
-- 3 la cancela (el job se recuperó).
--
-- ── Condición B — mes congelado sin consolidar ────────────────────────────
-- Existe un mes M con crudo en ad_impressions que ya salió de la ventana y no
-- tiene NINGUNA fila en ad_impressions_monthly. La regla "más allá de la
-- tolerancia (~90 - len(M) días desde que M terminó)" es ALGEBRAICAMENTE el
-- corte de elegibilidad: M termina en M + len(M) días y la tolerancia
-- restante es 90 - len(M), así que el límite es M + 90 días — exactamente
-- `M < now() - 90 días`. Por eso aquí se REUSA `c_retention_days = 90`, la
-- MISMA constante de purge_ad_impressions (20260817000002),
-- rollup_ad_impressions_monthly (20260823000004) y ad_metrics_for_agency
-- (20260823000005), en vez de inventar una cuarta cifra. Si la retención
-- cambia, las cuatro cambian juntas (el mismo hilo de comentarios que ata las
-- otras tres).
-- Que quede crudo visible de un mes ya no elegible NO contradice la purga:
-- purge_ad_impressions borra por `created_at`, no por `shown_at`.
--
-- Las dos condiciones son independientes y pueden disparar en la misma
-- corrida: producen DOS avisos por admin (anclas distintas), nunca uno que
-- tape al otro.
--
-- ── Destinatarios ─────────────────────────────────────────────────────────
-- public.users con role='admin' AND deleted_at is null — el MISMO predicado
-- de los 4 escritores admin (20260827000002/#223.2a): un admin dado de baja
-- no recibe nada, y el predicado habilita el índice parcial users_role_idx.
--
-- ── Idempotencia (D-ANCLA) ────────────────────────────────────────────────
-- type='admin_rollup_unhealthy', deep_link='/admin' (el índice admin es el
-- hub de las colas — mismo destino que admin_agency_pending tras #223.2b).
-- related_entity_id/type van NULL: la condición no es una entidad, y por eso
-- los 3 índices ancla de 20260825000001 no sirven aquí (son parciales por
-- OTRO type y llevan related_entity_id, que en NULL nunca colisiona en un
-- índice único). Se crea un índice propio con la MISMA forma que
-- notifications_ad_expiring_soon_anchor_idx (20260822000001), el precedente
-- que ya deduplica por un discriminador sacado de `data`.
--   condición A → anchor 'job_failing:<fecha de hoy>' — un aviso por día por
--     admin mientras el job siga caído (dos corridas el mismo día no repiten).
--   condición B → anchor 'stale_month:<M>' — UN aviso por mes afectado, para
--     siempre: la condición es permanente (ese mes ya no se recupera solo) y
--     exige acción manual; repetirla a diario sería ruido.
--
-- ── 🔴 Gotcha de visibilidad: RLS en cron.job_run_details ─────────────────
-- Esa tabla tiene RLS con `using (username = current_user)` y su owner es
-- supabase_admin (el rol `postgres` de Supabase NO es superusuario). Esta
-- función es SECURITY DEFINER y su owner es `postgres`, el MISMO rol con el
-- que pg_cron ejecuta y registra los jobs de este proyecto — por eso ve el
-- historial. Si algún día un job se programara con otro rol, este monitor no
-- vería sus corridas (y callaría en vez de alertar de más: falla del lado
-- seguro para el ruido, no para la vigilancia — anotado como límite conocido).
--
-- Idempotente: create unique index if not exists, create or replace function,
-- cron.schedule idempotente por jobname (mismo patrón que 20260823000004 y
-- 20260825000001: el mismo jobname actualiza in-place, no duplica).
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Índice ancla de idempotencia. Parcial SOLO por type, nunca por
--    deleted_at (un aviso BORRADO por el admin sigue ocupando la llave --
--    mismo criterio que los anclas de 20260822000001/20260825000001).
-- ════════════════════════════════════════════════════════════════════════════

create unique index if not exists notifications_admin_rollup_unhealthy_anchor_idx
  on public.notifications (user_id, type, (data ->> 'anchor'))
  where type = 'admin_rollup_unhealthy';
comment on index public.notifications_admin_rollup_unhealthy_anchor_idx is
  'Ancla de idempotencia de admin_rollup_unhealthy (#215). El discriminador '
  'sale de data->>''anchor'' porque esta alerta no cuelga de ninguna entidad '
  '(related_entity_id va NULL, y NULL nunca colisiona en un índice único) -- '
  'misma forma que notifications_ad_expiring_soon_anchor_idx (20260822000001). '
  'anchor = ''job_failing:<fecha>'' (un aviso por día mientras el job siga '
  'caído) o ''stale_month:<M>'' (un aviso por mes afectado, para siempre).';

-- ════════════════════════════════════════════════════════════════════════════
-- 2) public.check_rollup_health()
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
-- 3) pg_cron — job propio. La extensión ya está instalada (20260817000002),
--    NO se crea aquí. cron.schedule con el mismo jobname es idempotente
--    (actualiza in-place), mismo patrón que 20260823000004.
-- ════════════════════════════════════════════════════════════════════════════

select cron.schedule(
  'check_rollup_health_daily',
  '0 10 * * *',
  'select public.check_rollup_health();'
);
