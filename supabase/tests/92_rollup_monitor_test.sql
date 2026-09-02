-- Tests pgTAP — public.check_rollup_health() (tarea #215,
-- hardening(201.1)). Ejecutar con:
--   supabase test db supabase/tests/92_rollup_monitor_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de
-- una transacción revertida (no persiste). Impersonamos con
-- pg_temp.act_as(uid, role) (mismo patrón que 51/62/63/68/69/71_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- POR QUÉ existe este SUT (origen: guardian de 201.1, 2026-08-23)
-- La ventana de tolerancia del rollup para un mes M es ~90 - len(M) días:
-- M deja de ser ELEGIBLE (y por tanto el rollup deja de recalcularlo, y
-- ad_metrics_for_agency deja de leer su crudo) cuando M < now() - 90 días.
-- Si el job pg_cron queda caído más de eso abarcando el fin de M, el mes se
-- congela con lo consolidado hasta entonces (parcial, o nada) y NUNCA se
-- recupera — en silencio: cron.job_run_details registra los fallos pero
-- nadie los mira. Este SUT es el que los mira.
--
-- SEAM bajo prueba: el contrato PÚBLICO de public.check_rollup_health() —
-- firma de catálogo, autorización por GRANT/REVOKE ejercitada con
-- impersonación JWT real, las FILAS que deja en public.notifications tras
-- invocarla con fixtures reales sembrados a mano en cron.job_run_details y
-- ad_impressions, y el registro del job en cron.job. NUNCA internals (no se
-- valida el cuerpo del plpgsql).
--
-- SUT (AÚN NO EXISTE — RED 2026-09-02). Una migración GREEN debe crear:
--
--   public.check_rollup_health() returns void
--   security definer, set search_path = '', patrón EXACTO de
--   public.rollup_ad_impressions_monthly (20260823000004) y
--   public.purge_notifications (20260825000001). revoke execute from public,
--   anon, authenticated; grant execute to service_role. Reusa la extensión
--   pg_cron ya instalada (NO create extension).
--   Job pg_cron: jobname='check_rollup_health_daily', schedule='0 10 * * *'
--   (10:00 UTC — después del rollup 0 8 y de la purga 0 9 del MISMO día, para
--   que juzgue la corrida de hoy, y en un hueco libre: 0 11 es
--   purge_notifications_daily y 0 15 notify_ads_expiring_soon_daily),
--   command='select public.check_rollup_health();'.
--
-- ── D-COND-A (fallos consecutivos) ─────────────────────────────────────────
-- Alerta si las ÚLTIMAS N=3 ejecuciones del job del rollup (jobname EXACTO
-- 'rollup_ad_impressions_monthly_daily', 20260823000004), ordenadas por
-- start_time desc, existen las 3 y NINGUNA tiene status = 'succeeded'.
-- `<> 'succeeded'` (no `= 'failed'`) a propósito: pg_cron también deja
-- 'failed'/'running'/'starting', y cualquiera de ellos sostenido 3 corridas
-- seguidas significa lo mismo — el rollup no está consolidando. Con MENOS de
-- 3 registros NO alerta (no hay evidencia de fallo consecutivo todavía) y
-- con una sola 'succeeded' entre las 3 tampoco (el job se recuperó). Se
-- filtra por el jobid del rollup: otro job cayéndose no es asunto de esta
-- alerta.
--
-- ── D-COND-B (mes congelado parcial) ───────────────────────────────────────
-- Alerta si existe un mes M con crudo en ad_impressions tal que M ya NO es
-- elegible y NO tiene ninguna fila en ad_impressions_monthly. "Más allá de
-- la ventana de tolerancia (~90 - len(M) días desde que M terminó)" es
-- ALGEBRAICAMENTE la misma frontera: M termina en M + 1 mes = M + len(M)
-- días, y la tolerancia restante es 90 - len(M), así que el límite es
-- M + len(M) + 90 - len(M) = M + 90 días — es decir, exactamente el corte de
-- elegibilidad `M < now() - 90 días`, la MISMA constante de
-- purge_ad_impressions / rollup_ad_impressions_monthly /
-- ad_metrics_for_agency. Por eso el SUT no inventa una tercera constante.
-- Que quede crudo visible de un mes ya no elegible no es contradictorio con
-- la purga: purge_ad_impressions borra por `created_at` (20260817000002), no
-- por shown_at — la cola de un mes recién salido de la ventana sigue ahí.
--
-- ── D-DEST (destinatarios) ────────────────────────────────────────────────
-- TODOS los admins de PLATAFORMA vivos: public.users role='admin' AND
-- deleted_at is null — el mismo predicado exacto de los 4 escritores admin
-- (20260827000002/#223.2a), que además habilita el índice parcial
-- users_role_idx. Un admin dado de baja no recibe nada; un usuario no-admin
-- tampoco.
--
-- ── D-ANCLA (idempotencia) ────────────────────────────────────────────────
-- type='admin_rollup_unhealthy', deep_link='/admin' (ruta viva: el índice
-- admin es el hub de las colas — mismo destino interino que
-- admin_agency_pending tras #223.2b). related_entity_id/related_entity_type
-- van NULL: la condición no es una entidad. Como los índices ancla de
-- 20260825000001 son PARCIALES POR TYPE y llevan related_entity_id (que en
-- NULL nunca colisiona en un índice único), este type necesita su propio
-- índice con la MISMA forma que el de ad_expiring_soon (20260822000001), que
-- ya usa un discriminador sacado de `data`:
--   notifications_admin_rollup_unhealthy_anchor_idx UNIQUE
--   on public.notifications (user_id, type, (data->>'anchor'))
--   where type = 'admin_rollup_unhealthy'
-- + `on conflict ... do nothing` (nunca un error, igual que los 3 escritores
-- de disparo único). El ancla:
--   condición A → 'job_failing:' || la FECHA de hoy (YYYY-MM-DD) — un aviso
--     por día por admin mientras el job siga caído (el job de monitoreo corre
--     a diario; dos corridas el mismo día no repiten el aviso).
--   condición B → 'stale_month:' || M (YYYY-MM-DD) — UN aviso por mes
--     afectado y para siempre: la condición es permanente (ese mes ya no se
--     va a recuperar solo) y exige acción manual, repetirla a diario sería
--     ruido.
-- Las dos condiciones son independientes: pueden disparar en la misma
-- corrida y producir DOS avisos por admin (anclas distintas).
--
-- ── Estrategia RED ─────────────────────────────────────────────────────────
-- El SUT no existe todavía: catálogo puro (has_function, pg_proc,
-- pg_get_function_*, has_function_privilege por OID) es seguro aunque la
-- función no exista, y TODA llamada real va dentro de
-- `do $$ ... exception when others ... $$` — así el RED falla por ASERCIÓN,
-- nunca por 42883 abortando el script (gotcha documentado en
-- 67_set_agency_status_atomic_test.sql:170).
--
-- ── Edge cases enumerados ──────────────────────────────────────────────────
-- SIG0-SIG7: firma (sin argumentos, returns void, security definer) y
--   privilegios estáticos (authenticated/anon SIN execute, service_role CON).
-- IDX1: existe el índice único parcial que ancla la deduplicación.
-- CRON1-3: 1 fila propia en cron.job con jobname/schedule/command exactos.
-- AUTH1/AUTH2: authenticated y anon reciben 42501 — solo postgres/service_role.
-- FAIL1-6 (D-COND-A): 3 corridas seguidas sin 'succeeded' → EXACTAMENTE 1
--   aviso por admin VIVO; 0 al admin dado de baja; 0 al usuario no-admin;
--   deep_link '/admin'; data.condition='job_failing'; data.statuses lleva los
--   3 statuses observados (diagnóstico, sin PII).
-- DEDUPE1: segunda corrida idéntica → 0 filas NUEVAS.
-- NEG1: las 3 últimas 'succeeded' → 0 avisos.
-- NEG2: 2 fallos pero la 3ª de las últimas 3 es 'succeeded' → 0 (se recuperó).
-- NEG3: solo 2 ejecuciones en total, ambas fallidas → 0 (aún no son 3).
-- NEG4: OTRO job (purge_ad_impressions_daily) con 3 fallos y el rollup en
--   'succeeded' → 0 (filtra por jobid, no mira todo cron.job_run_details).
-- STALE1-4 (D-COND-B): mes con crudo, ya fuera de la ventana, sin fila
--   consolidada → 1 aviso por admin vivo, 0 al borrado,
--   data.condition='stale_month', data.month = M.
-- DEDUPE2: segunda corrida → 0 filas nuevas.
-- STALE_NEG1: el MISMO mes con su fila consolidada presente → 0 avisos (la
--   condición mira ad_impressions_monthly de verdad, no solo la antigüedad).
-- STALE_NEG2: crudo de un mes AÚN ELEGIBLE sin fila consolidada → 0 avisos
--   (el rollup todavía puede consolidarlo; alertar sería un falso positivo
--   diario).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(35);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) Fixtures — prefijo '920XXX'. El historial REAL de cron.job_run_details
--    del stack local se borra dentro de esta transacción (revertida al final)
--    para que "las últimas 3 corridas" sea determinista.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000920001', 'admin1_92@urbea.mx'),
  ('00000000-0000-0000-0000-000000920002', 'admin2_92@urbea.mx'),
  ('00000000-0000-0000-0000-000000920003', 'admin_borrado_92@urbea.mx'),
  ('00000000-0000-0000-0000-000000920004', 'usuario_regular_92@urbea.mx');

update public.users set role = 'admin'
 where id in ('00000000-0000-0000-0000-000000920001',
              '00000000-0000-0000-0000-000000920002',
              '00000000-0000-0000-0000-000000920003');
update public.users set deleted_at = now()
 where id = '00000000-0000-0000-0000-000000920003';

-- Sembrador de historial del job del rollup: p_statuses[1] es la corrida MÁS
-- RECIENTE. Borra el historial previo de ESE job para que la ventana de las
-- últimas 3 sea exactamente lo que el caso quiere probar.
create or replace function pg_temp.seed_runs_92(p_statuses text[], p_jobname text default 'rollup_ad_impressions_monthly_daily')
returns void language plpgsql as $$
declare
  v_jobid bigint;
  i integer;
begin
  select j.jobid into v_jobid from cron.job j where j.jobname = p_jobname;
  delete from cron.job_run_details where jobid = v_jobid;
  for i in 1 .. coalesce(array_length(p_statuses, 1), 0) loop
    -- runid EXPLÍCITO: el rol `postgres` de Supabase no es superusuario y no
    -- tiene USAGE sobre cron.runid_seq (owner supabase_admin) -- dejar el
    -- default da 'permission denied for sequence runid_seq'.
    -- username = current_user (postgres) a propósito: cron.job_run_details
    -- tiene RLS con `using (username = current_user)` y pg_cron escribe sus
    -- corridas reales justamente como postgres.
    insert into cron.job_run_details (runid, jobid, job_pid, database, username, command, status, start_time, end_time)
    values ((select coalesce(max(d.runid), 0) + 1 from cron.job_run_details d),
            v_jobid, 0, current_database(), current_user,
            'select public.' || p_jobname || '();', p_statuses[i],
            now() - (i || ' hours')::interval, now() - (i || ' hours')::interval);
  end loop;
end $$;

-- Corre el SUT sin dejar que un 42883 (RED, la función todavía no existe)
-- aborte el script. Devuelve el sqlstate en la tabla de resultado.
create temp table result_run_92 (step text, ok boolean, err_sqlstate text);
create or replace function pg_temp.run_sut_92(p_step text)
returns void language plpgsql as $$
begin
  perform public.check_rollup_health();
  insert into result_run_92 values (p_step, true, null);
exception when others then
  insert into result_run_92 values (p_step, false, sqlstate);
end $$;

-- Cuenta los avisos de esta alerta para un usuario concreto.
create or replace function pg_temp.count_alerts_92(p_user uuid)
returns integer language sql as $$
  select count(*)::integer from public.notifications
   where type = 'admin_rollup_unhealthy' and user_id = p_user;
$$;

-- Agencia/ad mínimos para poder sembrar crudo (FKs de ad_impressions).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000920011', 'owner_92@urbea.mx');
insert into public.agencies (id, name, slug, status, can_advertise, advertiser_category, created_by_user_id) values
  ('00000000-0000-0000-0000-000000920101', 'Agencia Monitor 92', 'agencia-monitor-92',
   'active', true, 'otro', '00000000-0000-0000-0000-000000920011');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000920201', '00000000-0000-0000-0000-000000920101', 'ready');
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000920301', '00000000-0000-0000-0000-000000920101',
   '00000000-0000-0000-0000-000000920201', 'Ad Monitor 92', 'phone', '+5213300009201',
   'active', '2025-12-01'::timestamptz, '2026-12-01'::timestamptz);

-- Meses del fixture, RELATIVOS a now(): stale_month está 5 meses atrás (muy
-- por fuera de los 90 días, sin fragilidad de fin de mes) y el mes en curso
-- SIEMPRE es elegible.
create temp table test_months_92 as
select
  (date_trunc('month', now()) - interval '5 months')::date              as stale_month,
  date_trunc('month', now()) - interval '5 months' + interval '5 days'  as stale_ts,
  date_trunc('month', now())::date                                      as current_month,
  date_trunc('month', now()) + interval '1 day'                         as current_ts;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Firma pública — catálogo EXACTO + privilegios estáticos.
-- ════════════════════════════════════════════════════════════════════════════

select has_function(
  'public', 'check_rollup_health', array[]::text[],
  'SIG0_la_funcion_public_check_rollup_health_existe_sin_argumentos'
);

create temp table result_sig_92 (ok boolean, result_sig text, args_sig text);
do $$
declare
  v_oid oid;
begin
  v_oid := to_regprocedure('public.check_rollup_health()');
  if v_oid is null then
    insert into result_sig_92 values (false, null, null);
  else
    insert into result_sig_92
    select true, pg_get_function_result(v_oid), pg_get_function_arguments(v_oid);
  end if;
exception when others then
  insert into result_sig_92 values (false, null, null);
end $$;

select is((select result_sig from result_sig_92), 'void',
  'SIG1_retorna_void_los_asserts_verifican_por_las_filas_de_notifications');
select is(coalesce((select args_sig from result_sig_92), 'ERR'), '',
  'SIG2_no_recibe_ningun_argumento');
select is(
  (select prosecdef from pg_proc where proname = 'check_rollup_health' and pronamespace = 'public'::regnamespace),
  true, 'SIG3_es_security_definer');
select ok(
  (
    select not has_function_privilege('authenticated', p.oid, 'EXECUTE')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'check_rollup_health' and p.pronargs = 0
  ) is true,
  'SIG4_authenticated_NO_tiene_EXECUTE_estatico_catalogo_puro'
);
select ok(
  (
    select not has_function_privilege('anon', p.oid, 'EXECUTE')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'check_rollup_health' and p.pronargs = 0
  ) is true,
  'SIG5_anon_NO_tiene_EXECUTE_estatico_catalogo_puro'
);
select ok(
  (
    select has_function_privilege('service_role', p.oid, 'EXECUTE')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'check_rollup_health' and p.pronargs = 0
  ) is true,
  'SIG6_service_role_SI_tiene_EXECUTE_estatico_catalogo_puro'
);

select ok(
  (
    select indexdef like '%UNIQUE%'
       and indexdef like '%admin_rollup_unhealthy%'
       and indexdef like '%anchor%'
    from pg_indexes
    where schemaname = 'public' and tablename = 'notifications'
      and indexname = 'notifications_admin_rollup_unhealthy_anchor_idx'
  ) is true,
  'IDX1_existe_el_indice_unico_parcial_que_ancla_la_deduplicacion_por_data_anchor'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Job pg_cron propio.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_cron_92 (jobname text, schedule text, command text);
insert into result_cron_92
  select jobname, schedule, command from cron.job where jobname = 'check_rollup_health_daily';

select is((select count(*)::int from result_cron_92), 1,
  'CRON1_existe_exactamente_1_fila_en_cron_job_para_check_rollup_health_daily');
select is(coalesce((select schedule from result_cron_92), 'NONE'), '0 10 * * *',
  'CRON2_schedule_0_10_UTC_despues_del_rollup_0_8_y_la_purga_0_9_del_mismo_dia');
select is(coalesce((select command from result_cron_92), 'NONE'), 'select public.check_rollup_health();',
  'CRON3_command_exacto');

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Autorización funcional — impersonación JWT real.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000920001', 'authenticated'); -- ¡incluso un ADMIN!
select throws_ok(
  $$ select public.check_rollup_health() $$,
  '42501', null,
  'AUTH1_authenticated_no_puede_ejecutar_el_monitor_ni_siendo_admin_de_plataforma'
);
reset role;

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select public.check_rollup_health() $$,
  '42501', null,
  'AUTH2_anon_no_puede_ejecutar_el_monitor'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) D-COND-A — 3 corridas seguidas sin 'succeeded'.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.seed_runs_92(array['failed', 'failed', 'failed']);
select pg_temp.run_sut_92('fail');

select is((select ok from result_run_92 where step = 'fail'), true,
  'RUN0_la_llamada_como_superusuario_no_lanza_excepcion');
select is(pg_temp.count_alerts_92('00000000-0000-0000-0000-000000920001'), 1,
  'FAIL1a_el_admin_vivo_1_recibe_EXACTAMENTE_1_aviso');
select is(pg_temp.count_alerts_92('00000000-0000-0000-0000-000000920002'), 1,
  'FAIL1b_el_admin_vivo_2_recibe_EXACTAMENTE_1_aviso');
select is(pg_temp.count_alerts_92('00000000-0000-0000-0000-000000920003'), 0,
  'FAIL2_el_admin_dado_de_baja_deleted_at_no_recibe_nada');
select is(pg_temp.count_alerts_92('00000000-0000-0000-0000-000000920004'), 0,
  'FAIL3_el_usuario_no_admin_no_recibe_nada');
select is(
  (select deep_link from public.notifications
    where type = 'admin_rollup_unhealthy' and user_id = '00000000-0000-0000-0000-000000920001'),
  '/admin',
  'FAIL4_deep_link_admin_ruta_viva'
);
select is(
  (select data->>'condition' from public.notifications
    where type = 'admin_rollup_unhealthy' and user_id = '00000000-0000-0000-0000-000000920001'),
  'job_failing',
  'FAIL5_data_condition_job_failing'
);
select is(
  (select (data->'statuses')::text from public.notifications
    where type = 'admin_rollup_unhealthy' and user_id = '00000000-0000-0000-0000-000000920001'),
  '["failed", "failed", "failed"]',
  'FAIL6_data_statuses_lleva_los_3_statuses_observados_diagnostico_sin_PII'
);

-- Segunda corrida idéntica: el ancla del día ya existe -> ni una fila nueva.
select pg_temp.run_sut_92('fail_again');
select is(pg_temp.count_alerts_92('00000000-0000-0000-0000-000000920001'), 1,
  'DEDUPE1_una_segunda_corrida_el_mismo_dia_no_agrega_ni_una_fila_nueva');

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Negativos de D-COND-A. Se borran los avisos previos entre casos: así un
--    falso positivo NO puede esconderse detrás del ancla de la sección 4.
-- ════════════════════════════════════════════════════════════════════════════

delete from public.notifications where type = 'admin_rollup_unhealthy';
select pg_temp.seed_runs_92(array['succeeded', 'succeeded', 'succeeded']);
select pg_temp.run_sut_92('neg1');
select is(pg_temp.count_alerts_92('00000000-0000-0000-0000-000000920001'), 0,
  'NEG1_las_3_ultimas_corridas_succeeded_no_generan_ningun_aviso');

delete from public.notifications where type = 'admin_rollup_unhealthy';
-- La MÁS RECIENTE falló y la anterior también, pero la 3ª sí corrió bien: el
-- job no lleva 3 seguidas caído.
select pg_temp.seed_runs_92(array['failed', 'failed', 'succeeded', 'failed']);
select pg_temp.run_sut_92('neg2');
select is(pg_temp.count_alerts_92('00000000-0000-0000-0000-000000920001'), 0,
  'NEG2_una_succeeded_dentro_de_las_ultimas_3_no_alerta_el_job_se_recupero');

delete from public.notifications where type = 'admin_rollup_unhealthy';
select pg_temp.seed_runs_92(array['failed', 'failed']);
select pg_temp.run_sut_92('neg3');
select is(pg_temp.count_alerts_92('00000000-0000-0000-0000-000000920001'), 0,
  'NEG3_solo_2_ejecuciones_en_total_aun_no_hay_3_fallos_consecutivos');

delete from public.notifications where type = 'admin_rollup_unhealthy';
select pg_temp.seed_runs_92(array['succeeded', 'succeeded', 'succeeded']);
select pg_temp.seed_runs_92(array['failed', 'failed', 'failed'], 'purge_ad_impressions_daily');
select pg_temp.run_sut_92('neg4');
select is(pg_temp.count_alerts_92('00000000-0000-0000-0000-000000920001'), 0,
  'NEG4_otro_job_caido_3_veces_no_dispara_esta_alerta_se_filtra_por_el_jobid_del_rollup');

-- ════════════════════════════════════════════════════════════════════════════
-- 6) D-COND-B — mes congelado parcial (crudo fuera de la ventana, sin fila
--    consolidada). El historial del rollup queda en 'succeeded' para que la
--    única condición posible sea ésta.
-- ════════════════════════════════════════════════════════════════════════════

delete from public.notifications where type = 'admin_rollup_unhealthy';
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000920301', '00000000-0000-0000-0000-000000920101', '00000000-0000-0000-0000-000000920971', gen_random_uuid(), '92001', null, (select stale_ts from test_months_92), 4000, true, false, null);

-- ANCLA del fixture: el mes sembrado está REALMENTE fuera de la ventana de
-- 90 días y no tiene fila consolidada. Sin esto, STALE1-4 podrían "pasar"
-- por un fixture mal construido en vez de por el contrato.
select is(
  (select (stale_month::timestamptz < now() - interval '90 days')
      and not exists (select 1 from public.ad_impressions_monthly m where m.year_month = stale_month)
     from test_months_92),
  true,
  'ANCHOR1_el_mes_sembrado_esta_fuera_de_los_90_dias_y_no_tiene_fila_consolidada'
);

select pg_temp.run_sut_92('stale');
select is(pg_temp.count_alerts_92('00000000-0000-0000-0000-000000920001'), 1,
  'STALE1a_el_admin_vivo_1_recibe_1_aviso_por_el_mes_congelado_sin_consolidar');
select is(pg_temp.count_alerts_92('00000000-0000-0000-0000-000000920002'), 1,
  'STALE1b_el_admin_vivo_2_recibe_1_aviso');
select is(pg_temp.count_alerts_92('00000000-0000-0000-0000-000000920003'), 0,
  'STALE2_el_admin_dado_de_baja_tampoco_recibe_esta_condicion');
select is(
  (select data->>'condition' from public.notifications
    where type = 'admin_rollup_unhealthy' and user_id = '00000000-0000-0000-0000-000000920001'),
  'stale_month',
  'STALE3_data_condition_stale_month'
);
select is(
  (select data->>'month' from public.notifications
    where type = 'admin_rollup_unhealthy' and user_id = '00000000-0000-0000-0000-000000920001'),
  (select to_char(stale_month, 'YYYY-MM-DD') from test_months_92),
  'STALE4_data_month_identifica_EXACTAMENTE_el_mes_afectado'
);

select pg_temp.run_sut_92('stale_again');
select is(pg_temp.count_alerts_92('00000000-0000-0000-0000-000000920001'), 1,
  'DEDUPE2_una_segunda_corrida_no_agrega_otro_aviso_por_el_mismo_mes');

-- STALE_NEG1: el mismo mes YA consolidado -> nada que alertar.
delete from public.notifications where type = 'admin_rollup_unhealthy';
insert into public.ad_impressions_monthly (agency_id, ad_id, municipality_id, neighborhood_id, year_month, impressions, views, completions, cta_taps) values
  ('00000000-0000-0000-0000-000000920101', '00000000-0000-0000-0000-000000920301', null, null, (select stale_month from test_months_92), 1, 1, 0, 0);
select pg_temp.run_sut_92('stale_neg1');
select is(pg_temp.count_alerts_92('00000000-0000-0000-0000-000000920001'), 0,
  'STALE_NEG1_el_mes_con_su_fila_consolidada_presente_no_alerta');

-- STALE_NEG2: crudo de un mes AÚN ELEGIBLE sin consolidar -> tampoco alerta
-- (el rollup todavía puede consolidarlo; alertar sería ruido diario).
delete from public.notifications where type = 'admin_rollup_unhealthy';
delete from public.ad_impressions where agency_id = '00000000-0000-0000-0000-000000920101';
delete from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000920101';
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000920301', '00000000-0000-0000-0000-000000920101', '00000000-0000-0000-0000-000000920972', gen_random_uuid(), '92002', null, (select current_ts from test_months_92), 4000, true, false, null);
select pg_temp.run_sut_92('stale_neg2');
select is(pg_temp.count_alerts_92('00000000-0000-0000-0000-000000920001'), 0,
  'STALE_NEG2_crudo_de_un_mes_AUN_ELEGIBLE_sin_consolidar_no_alerta');

select * from finish();
rollback;
