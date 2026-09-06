-- Tests pgTAP — public.lead_temperature_daily + public.snapshot_lead_temperature() +
-- public.purge_events_raw() + job pg_cron (×2) + public.check_rollup_health() extendida +
-- índice leads_agent_score_idx (subtarea 266.3, exploración 045 §8.2-§8.4/§14 T-A). Ejecutar
-- con:
--   supabase test db supabase/tests/101_crm_temperature_daily_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de una transacción
-- revertida (no persiste). El rol `postgres` de este proyecto NO es superuser real (ver
-- 20260904300001) — toda operación sobre tablas/funciones fail-closed pasa por
-- pg_temp.act_as(uid, role) (mismo patrón que 02/35/51/62/68/92/100_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAMS bajo prueba (comportamiento observable, NUNCA internals):
--   1) Shape catalográfico + RLS + grants fail-closed de public.lead_temperature_daily.
--   2) El contrato PÚBLICO de public.snapshot_lead_temperature(p_day date) — firma, ACL
--      service_role-only, y las FILAS que deja en lead_temperature_daily tras invocarla con
--      fixtures reales (nunca la misma expresión SQL que usará el SUT).
--   3) El contrato PÚBLICO de public.purge_events_raw() — firma, ACL, filas que borra/conserva.
--   4) El registro de los 2 jobs nuevos en cron.job (catálogo puro).
--   5) El comportamiento observable de public.check_rollup_health() EXTENDIDA — las filas que
--      dej a en public.notifications ante 2 condiciones nuevas (mismo mecanismo que
--      92_rollup_monitor_test.sql, que esta suite NO toca ni modifica).
--   6) El índice leads_agent_score_idx — catálogo puro.
--
-- SUT (AÚN NO EXISTE — RED 2026-09-06): supabase/migrations/20260906100002_
-- crm_temperature_daily.sql debe crear todo lo anterior.
--
-- ── D-EOD (decisión de diseño del test-author — "fin del día p_day en UTC") ─────────────────
-- No se fija el microsegundo exacto (day+1 00:00:00 UTC menos 1µs, o equivalente) — el
-- contrato exige solo que (a) un evento a las 00:30 UTC del día D cuente para D, y (b) el
-- resultado sea IDÉNTICO bajo 4 timezones de SESIÓN distintas (TZDAY1-4): si la implementación
-- usara `p_day::timestamp` interpretado en el timezone de sesión en vez de UTC fijo, el
-- resultado CAMBIARÍA entre zonas (verificado con una implementación candidata "ingenua" antes
-- de escribir este archivo: 27/27/29/28 en vez de 28/28/28/28 — ver bitácora).
--
-- ── D-SIGNALS (decisión: signals es POR DÍA, no acumulado histórico) ─────────────────────────
-- El SUT top-level solo dice "signals jsonb con conteos". Se decide: cuenta SOLO eventos con
-- timestamp dentro del día p_day (00:00-23:59:59.999999 UTC) — un evento de OTRO día no debe
-- sumarse (SIGNALS2 lo cazaría). La TEMPERATURA sí es acumulada/decayendo (eso ya lo prueba
-- 100_crm_temperature_test.sql vía private.crm_temperature) — signals es la única pieza
-- genuinamente nueva de este archivo y por eso se aísla por día.
--
-- ── D-COND-C (check_rollup_health, snapshot faltante) ────────────────────────────────────────
-- Unhealthy ⟺ existe al menos 1 lead ACTIVO Y NO existe NINGUNA fila en
-- lead_temperature_daily con day ∈ {current_date, current_date-1} (existencia global, mismo
-- estilo laxo que la condición B de 92 — no es "cada lead tiene su fila", es "el snapshot
-- corrió ayer u hoy"). type='admin_rollup_unhealthy' (reusa el canal existente, NO crea un
-- 2º tipo de notificación), data->>'condition'='stale_snapshot'.
--
-- ── D-COND-D (check_rollup_health, jobs nuevos caídos) ───────────────────────────────────────
-- MISMO mecanismo que la condición A de 92 (últimas 3 corridas de cron.job_run_details,
-- ninguna 'succeeded'), generalizado a CADA UNO de los 2 jobs nuevos por separado (anchors/
-- condiciones independientes — D3 prueba que NO está hardcodeado a un solo jobname).
-- data->>'condition'='job_failing', data->>'job'=<jobname>. Los jobs de la fixture de esta
-- sección se registran con `cron.schedule(...)` DIRECTO en el test (comando inocuo 'select 1;')
-- — es fixture, no el SUT; el GREEN los re-registra con el comando real vía el MISMO jobname
-- (cron.schedule es idempotente por jobname, no duplica).
--
-- ── D-SNAPSHOT-ARG (firma exacta de snapshot_lead_temperature) ───────────────────────────────
-- public.snapshot_lead_temperature(p_day date default current_date) — el default se fija
-- literal como `CURRENT_DATE` (no `now()::date`) porque así lo normaliza pg_get_function_
-- arguments; un mutante que cambiara el default a otra expresión lo cazaría SIG3.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ─────────────────────────────────
-- Happy path: tabla shape completo (TAB1-16), grants fail-closed (GRANT1-6), escritura
--   directa de authenticated rechazada (WRITE1-3), firma+ACL de las 2 funciones (SIG1-10,
--   ACL1-10), snapshot recalcula (no solo inserta) y es idempotente (FUNC1a-e), signals por
--   día (FUNC4a-b), índice (IDX1-2), jobs registrados (CRON1-7).
-- Edge cases del PRD/exploración 045 (§8.2-§8.4): lead borrado NO recibe snapshot nuevo
--   (FUNC2), backfill de 14 días exacto e idempotente (FUNC-BACK1-3), retención 90d con
--   frontera `<` estricta (PURGE1-4, exactamente 90d se CONSERVA), snapshot nunca tocado por
--   la purga (PURGE4).
-- Ramas de reglas no obvias: corte de día en UTC fijo, no timezone de sesión (TZDAY1-4);
--   check_rollup_health extendida sin romper 92 (COND-C/D, archivo 92 NUNCA se toca).
-- Boundary/error (ACL, privacidad): agente ajeno 0 filas (PRIV2), owner/admin de agencia SÍ
--   (PRIV3-4), admin de PLATAFORMA sin relación 0 filas — #226 (PRIV5), anon denegado en su
--   propia primera invocación real (ACLREAL1/3, gotcha 203.1).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(87);

-- ── Helper de impersonación (mismo patrón que 02/35/51/62/68/92/100_*) ──────────────────────
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '0000002660XX' (subtarea 266.3).
--   AG1     agente, dueño de P1                                  : ...266001
--   U1      buscador que contactó a AG1 -> L1                    : ...266002
--   AG2     agente AJENO (sin relación con L1)                   : ...266003
--   OWN     owner ACTIVO de la agencia de AG1                    : ...266004
--   ADM     admin (member_role) ACTIVO de la agencia de AG1      : ...266005
--   PADMIN  admin de PLATAFORMA (users.role), SIN relación        : ...266006
--   U3      buscador de L3 (lead de AG1, SOFT-DELETED)           : ...266007
--   UTZ     buscador de LTZ (fixture de bomba de fecha)          : ...266008
--   UIDEMP  buscador de LIDEMP (idempotencia/recálculo)          : ...266009
--   UBACK   buscador de LBACK (backfill de 14 días)              : ...266010
--   USIG    buscador de LSIG (signals por día)                   : ...266011
--   UPURGE  solo para eventos crudos de purge_events_raw         : ...266012
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266001', 'ag1.266@test.local'),
  ('00000000-0000-0000-0000-000000266002', 'u1.266@test.local'),
  ('00000000-0000-0000-0000-000000266003', 'ag2.266@test.local'),
  ('00000000-0000-0000-0000-000000266004', 'own.266@test.local'),
  ('00000000-0000-0000-0000-000000266005', 'adm.266@test.local'),
  ('00000000-0000-0000-0000-000000266006', 'padmin.266@test.local'),
  ('00000000-0000-0000-0000-000000266007', 'u3.266@test.local'),
  ('00000000-0000-0000-0000-000000266008', 'utz.266@test.local'),
  ('00000000-0000-0000-0000-000000266009', 'uidemp.266@test.local'),
  ('00000000-0000-0000-0000-000000266010', 'uback.266@test.local'),
  ('00000000-0000-0000-0000-000000266011', 'usig.266@test.local'),
  ('00000000-0000-0000-0000-000000266012', 'upurge.266@test.local');

update public.users set role = 'agent', is_verified_agent = true
  where id in ('00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266003');
update public.users set role = 'admin'
  where id = '00000000-0000-0000-0000-000000266006'; -- PADMIN

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000266101', 'Inmobiliaria CRM Temp 266', 'inmo-crm-temp-266',
   'active', '00000000-0000-0000-0000-000000266004');

insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000266111', '00000000-0000-0000-0000-000000266101', '00000000-0000-0000-0000-000000266004', 'owner', 'active'),  -- OWN
  ('00000000-0000-0000-0000-000000266112', '00000000-0000-0000-0000-000000266101', '00000000-0000-0000-0000-000000266005', 'admin', 'active'),  -- ADM
  ('00000000-0000-0000-0000-000000266113', '00000000-0000-0000-0000-000000266101', '00000000-0000-0000-0000-000000266001', 'agent', 'active');  -- AG1

insert into public.properties (id, owner_user_id, agency_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000266201', '00000000-0000-0000-0000-000000266001',
   '00000000-0000-0000-0000-000000266101', 'departamento', 'rent', 'Fixture 266 — P1 (de AG1)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 12000, 'active');

insert into public.property_videos (id, property_id, agent_id, status, position, cloudflare_uid) values
  ('00000000-0000-0000-0000-000000266211', '00000000-0000-0000-0000-000000266201', '00000000-0000-0000-0000-000000266001', 'ready', 1, 'fixture-266-pv1'),
  ('00000000-0000-0000-0000-000000266212', '00000000-0000-0000-0000-000000266201', '00000000-0000-0000-0000-000000266001', 'ready', 2, 'fixture-266-pv2'),
  ('00000000-0000-0000-0000-000000266213', '00000000-0000-0000-0000-000000266201', '00000000-0000-0000-0000-000000266001', 'ready', 3, 'fixture-266-pv3'),
  ('00000000-0000-0000-0000-000000266214', '00000000-0000-0000-0000-000000266201', '00000000-0000-0000-0000-000000266001', 'ready', 4, 'fixture-266-pv4');

-- L1: lead general (AG1, U1) — visibilidad/privacidad + "lead activo global" de COND-C.
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000266401', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266002', 'contacted');

-- L3: lead de AG1 pero SOFT-DELETED (deleted_at) — no debe recibir snapshot nuevo.
insert into public.leads (id, agent_id, user_id, status, deleted_at) values
  ('00000000-0000-0000-0000-000000266403', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266007', 'contacted', now());
insert into public.lead_origin_properties (id, lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000266802', '00000000-0000-0000-0000-000000266403', '00000000-0000-0000-0000-000000266201', '2026-05-01 12:00:00+00');

-- LTZ: bomba de fecha — 1 solo signal, contacto a las 00:30 UTC del día 2026-01-15.
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000266404', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266008', 'contacted');
insert into public.lead_origin_properties (id, lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000266803', '00000000-0000-0000-0000-000000266404', '00000000-0000-0000-0000-000000266201', '2026-01-15 00:30:00+00');

-- LIDEMP: idempotencia + recálculo honesto. Contacto casi al final del día D0=2026-06-01.
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000266405', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266009', 'contacted');
insert into public.lead_origin_properties (id, lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000266804', '00000000-0000-0000-0000-000000266405', '00000000-0000-0000-0000-000000266201', '2026-06-01 23:59:00+00');

-- LBACK: backfill de 14 días. Actividad vieja (20 días antes de hoy), lead activo hoy.
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000266406', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266010', 'contacted');
insert into public.lead_origin_properties (id, lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000266805', '00000000-0000-0000-0000-000000266406', '00000000-0000-0000-0000-000000266201', now() - interval '20 days');

-- LSIG: signals por día. Día D1=2026-03-10: 1 contacto + 2 video_completed + 3 likes + 1 save.
-- Día D2=2026-03-11: 1 like EXTRA (no debe sumarse al conteo de D1 — SIGNALS2).
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000266407', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266011', 'contacted');
insert into public.lead_origin_properties (id, lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000266806', '00000000-0000-0000-0000-000000266407', '00000000-0000-0000-0000-000000266201', '2026-03-10 08:00:00+00');
insert into public.events_raw (event_type, user_id, property_id, created_at, payload) values
  ('video_completed', '00000000-0000-0000-0000-000000266011', '00000000-0000-0000-0000-000000266201', '2026-03-10 09:00:00+00', '{}'::jsonb),
  ('video_completed', '00000000-0000-0000-0000-000000266011', '00000000-0000-0000-0000-000000266201', '2026-03-10 10:00:00+00', '{}'::jsonb);
insert into public.likes (user_id, property_video_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266011', '00000000-0000-0000-0000-000000266211', '00000000-0000-0000-0000-000000266201', '2026-03-10 11:00:00+00'),
  ('00000000-0000-0000-0000-000000266011', '00000000-0000-0000-0000-000000266212', '00000000-0000-0000-0000-000000266201', '2026-03-10 12:00:00+00'),
  ('00000000-0000-0000-0000-000000266011', '00000000-0000-0000-0000-000000266213', '00000000-0000-0000-0000-000000266201', '2026-03-10 13:00:00+00');
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266011', '00000000-0000-0000-0000-000000266201', '2026-03-10 14:00:00+00');
-- Like extra de D2 — property_video distinto (unique user+video).
insert into public.likes (user_id, property_video_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266011', '00000000-0000-0000-0000-000000266214', '00000000-0000-0000-0000-000000266201', '2026-03-11 09:00:00+00');

-- LIDEMP: like de recálculo (día D0, 10:00 UTC) — usa PV1, distinto USUARIO que LSIG así que
-- no colisiona con el unique index (user_id, property_video_id).
-- (se inserta más abajo, junto al bloque RECALC, para mantener el fixture cerca del uso)

-- ════════════════════════════════════════════════════════════════════════════
-- 1) TABLA public.lead_temperature_daily — shape catalográfico (pgTAP puro, seguro
--    aunque la tabla no exista: has_table/has_column/col_type_is/col_not_null/col_is_pk
--    resuelven "not ok" sin lanzar).
-- ════════════════════════════════════════════════════════════════════════════

select has_table('public', 'lead_temperature_daily', 'TAB1_tabla_lead_temperature_daily_existe');

select has_column('public', 'lead_temperature_daily', 'lead_id', 'TAB2_columna_lead_id_existe');
select has_column('public', 'lead_temperature_daily', 'day', 'TAB3_columna_day_existe');
select has_column('public', 'lead_temperature_daily', 'temperature', 'TAB4_columna_temperature_existe');
select has_column('public', 'lead_temperature_daily', 'signals', 'TAB5_columna_signals_existe');

select col_type_is('public', 'lead_temperature_daily', 'lead_id', 'uuid', 'TAB6_lead_id_es_uuid');
select col_type_is('public', 'lead_temperature_daily', 'day', 'date', 'TAB7_day_es_date');
select col_type_is('public', 'lead_temperature_daily', 'temperature', 'integer', 'TAB8_temperature_es_integer');
select col_type_is('public', 'lead_temperature_daily', 'signals', 'jsonb', 'TAB9_signals_es_jsonb');

select col_not_null('public', 'lead_temperature_daily', 'lead_id', 'TAB10_lead_id_not_null');
select col_not_null('public', 'lead_temperature_daily', 'day', 'TAB11_day_not_null');
select col_not_null('public', 'lead_temperature_daily', 'temperature', 'TAB12_temperature_not_null');
select col_not_null('public', 'lead_temperature_daily', 'signals', 'TAB13_signals_not_null');

select col_is_pk('public', 'lead_temperature_daily', array['lead_id', 'day'], 'TAB14_pk_compuesta_lead_id_day');

-- FK on delete cascade a leads(id) — catálogo puro vía pg_constraint (0 filas si la tabla no
-- existe, nunca lanza).
select is(
  coalesce((
    select c.confdeltype::text
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace tn on tn.oid = t.relnamespace
    join pg_class rt on rt.oid = c.confrelid
    where tn.nspname = 'public' and t.relname = 'lead_temperature_daily'
      and rt.relname = 'leads' and c.contype = 'f'
  ), 'X'),
  'c',
  'TAB15_fk_lead_id_leads_on_delete_cascade'
);

-- RLS habilitado — catálogo puro vía pg_class.
select is(
  coalesce((
    select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'lead_temperature_daily'
  ), false),
  true,
  'TAB16_rls_habilitado'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) GRANTS fail-closed con dientes — catálogo vía has_table_privilege(role, oid, priv)
--    resuelto por join (0 filas si la tabla no existe = NULL, nunca lanza; a diferencia del
--    cast de texto que SÍ lanza, gotcha documentado en 68_rollup_ad_impressions_monthly_test).
-- ════════════════════════════════════════════════════════════════════════════

select is(
  coalesce((select has_table_privilege('anon', c.oid, 'SELECT') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'lead_temperature_daily'), false),
  false, 'GRANT1_anon_SIN_select'
);
select is(
  coalesce((select has_table_privilege('authenticated', c.oid, 'SELECT') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'lead_temperature_daily'), false),
  true, 'GRANT2_authenticated_CON_select'
);
select is(
  coalesce((select has_table_privilege('authenticated', c.oid, 'INSERT') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'lead_temperature_daily'), false),
  false, 'GRANT3_authenticated_SIN_insert'
);
select is(
  coalesce((select has_table_privilege('authenticated', c.oid, 'UPDATE') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'lead_temperature_daily'), false),
  false, 'GRANT4_authenticated_SIN_update'
);
select is(
  coalesce((select has_table_privilege('authenticated', c.oid, 'DELETE') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'lead_temperature_daily'), false),
  false, 'GRANT5_authenticated_SIN_delete'
);
select is(
  coalesce((select has_table_privilege('service_role', c.oid, 'INSERT') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'lead_temperature_daily'), false),
  true, 'GRANT6_service_role_CON_insert_control_positivo'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Escritura directa de authenticated — comportamiento real (throws_ok, ya seguro aunque
--    la tabla no exista: 42P01 también hace throw). Mismo patrón que
--    28_lead_status_reconcile_test.sql:6c-6e (agente dueño del lead, aun así no puede escribir).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000266001'); -- AG1, dueño de L1
select throws_ok(
  $$ insert into public.lead_temperature_daily (lead_id, day, temperature, signals)
     values ('00000000-0000-0000-0000-000000266401', current_date, 50, '{}'::jsonb) $$,
  null, 'WRITE1_authenticated_no_puede_insertar_directo'
);
select throws_ok(
  $$ update public.lead_temperature_daily set temperature = 99
     where lead_id = '00000000-0000-0000-0000-000000266401' $$,
  null, 'WRITE2_authenticated_no_puede_actualizar_directo'
);
select throws_ok(
  $$ delete from public.lead_temperature_daily
     where lead_id = '00000000-0000-0000-0000-000000266401' $$,
  null, 'WRITE3_authenticated_no_puede_borrar_directo'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Firma de catálogo — public.snapshot_lead_temperature(p_day date default current_date).
-- ════════════════════════════════════════════════════════════════════════════

select has_function('public', 'snapshot_lead_temperature', array['date'],
  'SIG1_snapshot_lead_temperature_existe_con_firma_p_day_date');

select function_returns('public', 'snapshot_lead_temperature', array['date'], 'void',
  'SIG2_snapshot_lead_temperature_retorna_void');

select is(
  (select pg_get_function_arguments(to_regprocedure('public.snapshot_lead_temperature(date)'))),
  'p_day date DEFAULT CURRENT_DATE',
  'SIG3_snapshot_lead_temperature_argumento_exacto_con_default_current_date'
);

select is(
  (select prosecdef from pg_proc where proname = 'snapshot_lead_temperature' and pronamespace = 'public'::regnamespace),
  true, 'SIG4_snapshot_lead_temperature_es_security_definer'
);

select is(
  (select proconfig from pg_proc where proname = 'snapshot_lead_temperature' and pronamespace = 'public'::regnamespace),
  array['search_path=""']::text[],
  'SIG5_snapshot_lead_temperature_search_path_vacio'
);

select is(
  coalesce((select pronargdefaults from pg_proc where proname = 'snapshot_lead_temperature' and pronamespace = 'public'::regnamespace), -1),
  1, 'SIG6_snapshot_lead_temperature_tiene_exactamente_1_default'
);

-- ── Firma de catálogo — public.purge_events_raw() sin argumentos ────────────────────────────

select has_function('public', 'purge_events_raw', array[]::text[],
  'SIG7_purge_events_raw_existe_sin_argumentos');

select function_returns('public', 'purge_events_raw', array[]::text[], 'void',
  'SIG8_purge_events_raw_retorna_void');

select is(
  (select prosecdef from pg_proc where proname = 'purge_events_raw' and pronamespace = 'public'::regnamespace),
  true, 'SIG9_purge_events_raw_es_security_definer'
);

select is(
  (select proconfig from pg_proc where proname = 'purge_events_raw' and pronamespace = 'public'::regnamespace),
  array['search_path=""']::text[],
  'SIG10_purge_events_raw_search_path_vacio'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) ACL de catálogo — anon/authenticated SIN execute, service_role CON execute (ambas
--    funciones). function_privs_are no invoca nada, seguro aunque la función no exista.
-- ════════════════════════════════════════════════════════════════════════════

select function_privs_are('public', 'snapshot_lead_temperature', array['date'], 'anon', array[]::name[],
  'ACL1_snapshot_anon_SIN_execute');
select function_privs_are('public', 'snapshot_lead_temperature', array['date'], 'authenticated', array[]::name[],
  'ACL2_snapshot_authenticated_SIN_execute');
select function_privs_are('public', 'snapshot_lead_temperature', array['date'], 'service_role', array['EXECUTE']::name[],
  'ACL3_snapshot_service_role_CON_execute');
select function_privs_are('public', 'purge_events_raw', array[]::text[], 'anon', array[]::name[],
  'ACL4_purge_anon_SIN_execute');
select function_privs_are('public', 'purge_events_raw', array[]::text[], 'authenticated', array[]::name[],
  'ACL5_purge_authenticated_SIN_execute');
select function_privs_are('public', 'purge_events_raw', array[]::text[], 'service_role', array['EXECUTE']::name[],
  'ACL6_purge_service_role_CON_execute');

-- ── Invocación real — PRIMERA llamada real a cada función en todo el archivo (gotcha 203.1:
--    el EXECUTE se comprueba al planificar y el plan se cachea). anon y authenticated denegados
--    ANTES de que service_role llame nunca a estas funciones. ────────────────────────────────

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select public.snapshot_lead_temperature() $$,
  '42501', null, 'ACLREAL1_anon_no_puede_ejecutar_snapshot_lead_temperature'
);
reset role;

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select public.purge_events_raw() $$,
  '42501', null, 'ACLREAL3_anon_no_puede_ejecutar_purge_events_raw'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266001'); -- authenticated, AG1
select throws_ok(
  $$ select public.snapshot_lead_temperature() $$,
  '42501', null, 'ACLREAL2_authenticated_no_puede_ejecutar_snapshot_lead_temperature'
);
select throws_ok(
  $$ select public.purge_events_raw() $$,
  '42501', null, 'ACLREAL4_authenticated_no_puede_ejecutar_purge_events_raw'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Comportamiento — public.snapshot_lead_temperature(). Corre como service_role (el rol
--    con el que pg_cron ejecuta este dominio). Todo protegido con DO $$ .. exception when
--    others .. $$ (la tabla y la función AÚN NO EXISTEN — 42P01/42883 esperado hoy, se reporta
--    como fallo de ASERCIÓN vía el sentinel, nunca aborta la transacción).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');

-- 6a) FUNC1 — LIDEMP: piso de entrada casi puro (contacto a 1 minuto del fin del día D0).
create temp table result_func1 (label text, ok boolean, temperature int, cnt int);
do $$
begin
  perform public.snapshot_lead_temperature('2026-06-01'::date);
  insert into result_func1
    select 'entry', true, ltd.temperature, (select count(*)::int from public.lead_temperature_daily where lead_id = '00000000-0000-0000-0000-000000266405' and day = '2026-06-01'::date)
    from public.lead_temperature_daily ltd
    where ltd.lead_id = '00000000-0000-0000-0000-000000266405' and ltd.day = '2026-06-01'::date;
exception when others then
  insert into result_func1 values ('entry', false, null, null);
end $$;

select is(coalesce((select temperature from result_func1 where label = 'entry'), -1), 30,
  'FUNC1_ENTRY_piso_de_entrada_casi_puro_da_30');
select is(coalesce((select cnt from result_func1 where label = 'entry'), -1), 1,
  'FUNC1_COUNT1_exactamente_1_fila_lead_id_day');

-- 6b) IDEMPOTENCIA — repetir la MISMA corrida sin mutar el crudo: mismo valor, sin duplicar.
create temp table result_func1_idemp (ok boolean, temperature int, cnt int);
do $$
begin
  perform public.snapshot_lead_temperature('2026-06-01'::date);
  insert into result_func1_idemp
    select true, temperature, (select count(*)::int from public.lead_temperature_daily where lead_id = '00000000-0000-0000-0000-000000266405' and day = '2026-06-01'::date)
    from public.lead_temperature_daily where lead_id = '00000000-0000-0000-0000-000000266405' and day = '2026-06-01'::date;
exception when others then
  insert into result_func1_idemp values (false, null, null);
end $$;

select is(coalesce((select temperature from result_func1_idemp), -1), 30,
  'FUNC1_IDEMP_VAL_correr_2_veces_da_el_mismo_valor');
select is(coalesce((select cnt from result_func1_idemp), -1), 1,
  'FUNC1_IDEMP_COUNT_correr_2_veces_NO_duplica_la_fila');

-- 6c) RECÁLCULO HONESTO — llega actividad NUEVA el mismo día D0 (un like a las 10:00 UTC),
--     re-correr sube el valor Y sigue siendo 1 sola fila (upsert, no insert ciego).
insert into public.likes (user_id, property_video_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266009', '00000000-0000-0000-0000-000000266211', '00000000-0000-0000-0000-000000266201', '2026-06-01 10:00:00+00');

create temp table result_func1_recalc (ok boolean, temperature int, cnt int);
do $$
begin
  perform public.snapshot_lead_temperature('2026-06-01'::date);
  insert into result_func1_recalc
    select true, temperature, (select count(*)::int from public.lead_temperature_daily where lead_id = '00000000-0000-0000-0000-000000266405' and day = '2026-06-01'::date)
    from public.lead_temperature_daily where lead_id = '00000000-0000-0000-0000-000000266405' and day = '2026-06-01'::date;
exception when others then
  insert into result_func1_recalc values (false, null, null);
end $$;

select is(coalesce((select temperature from result_func1_recalc), -1), 35,
  'FUNC1_RECALC_VAL_actividad_nueva_el_mismo_dia_sube_el_valor_a_35');
select is(coalesce((select cnt from result_func1_recalc), -1), 1,
  'FUNC1_RECALC_COUNT_sigue_siendo_1_sola_fila_upsert_no_insert_ciego');

-- 6d) FUNC2 — lead SOFT-DELETED (L3) no recibe fila nueva de snapshot.
create temp table result_func2 (ok boolean, cnt int);
do $$
begin
  perform public.snapshot_lead_temperature('2026-05-01'::date);
  insert into result_func2
    select true, (select count(*)::int from public.lead_temperature_daily where lead_id = '00000000-0000-0000-0000-000000266403' and day = '2026-05-01'::date);
exception when others then
  insert into result_func2 values (false, -1);
end $$;

select is(coalesce((select cnt from result_func2), -1), 0,
  'FUNC2_lead_soft_deleted_NO_recibe_fila_de_snapshot');

-- 6e) FUNC3 — argumento default (sin pasar p_day) usa current_date, service_role puede
--     ejecutarlo, y dEja fila para L1 (lead activo) el día de hoy.
create temp table result_func3 (ok boolean, exists_row boolean);
do $$
begin
  perform public.snapshot_lead_temperature();
  insert into result_func3
    select true, exists(select 1 from public.lead_temperature_daily where lead_id = '00000000-0000-0000-0000-000000266401' and day = current_date);
exception when others then
  insert into result_func3 values (false, false);
end $$;

select is(coalesce((select ok from result_func3), false), true,
  'FUNC3_snapshot_sin_argumentos_no_lanza_usa_current_date');
select is(coalesce((select exists_row from result_func3), false), true,
  'FUNC3_snapshot_por_default_deja_fila_para_lead_activo_L1_hoy');

-- 6f) FUNC4 — signals jsonb por DÍA (D1=2026-03-10): 1 contacto + 2 video_completed +
--     3 likes + 1 save. El like extra de D2 (2026-03-11) NO debe sumarse a D1 (SIGNALS2).
create temp table result_func4 (label text, ok boolean, signals jsonb);
do $$
begin
  perform public.snapshot_lead_temperature('2026-03-10'::date);
  insert into result_func4
    select 'd1_antes', true, signals
    from public.lead_temperature_daily where lead_id = '00000000-0000-0000-0000-000000266407' and day = '2026-03-10'::date;
exception when others then
  insert into result_func4 values ('d1_antes', false, null);
end $$;

select is(
  coalesce((select signals from result_func4 where label = 'd1_antes'), '{}'::jsonb),
  jsonb_build_object('video_completed', 2, 'likes', 3, 'saves', 1, 'contacts', 1),
  'SIGNALS1_conteos_exactos_del_dia_D1_2_video_3_likes_1_save_1_contacto'
);

-- Re-correr D1 DESPUÉS de que exista el like de D2 en events_raw/likes -- signals de D1 no
-- debe cambiar (el like de D2 vive en OTRO día).
create temp table result_func4b (label text, ok boolean, signals jsonb);
do $$
begin
  perform public.snapshot_lead_temperature('2026-03-10'::date);
  insert into result_func4b
    select 'd1_despues', true, signals
    from public.lead_temperature_daily where lead_id = '00000000-0000-0000-0000-000000266407' and day = '2026-03-10'::date;
exception when others then
  insert into result_func4b values ('d1_despues', false, null);
end $$;

select is(
  coalesce((select signals from result_func4b where label = 'd1_despues'), '{}'::jsonb),
  jsonb_build_object('video_completed', 2, 'likes', 3, 'saves', 1, 'contacts', 1),
  'SIGNALS2_el_like_extra_de_D2_NO_se_suma_al_conteo_de_D1'
);

-- 6g) BACKFILL — 14 llamadas para LBACK (current_date-13 .. current_date). count(*)=14,
--     repetir las 14 no duplica, y el rango de días es exacto.
create temp table result_backfill (phase text, ok boolean, cnt int, min_day date, max_day date);
do $$
declare
  d date;
begin
  for d in select generate_series(current_date - 13, current_date, interval '1 day')::date loop
    perform public.snapshot_lead_temperature(d);
  end loop;
  insert into result_backfill
    select 'run1', true, count(*)::int, min(day), max(day)
    from public.lead_temperature_daily where lead_id = '00000000-0000-0000-0000-000000266406';
exception when others then
  insert into result_backfill values ('run1', false, -1, null, null);
end $$;

select is(coalesce((select cnt from result_backfill where phase = 'run1'), -1), 14,
  'FUNCBACK1_backfill_de_14_dias_deja_exactamente_14_filas');
select is(
  array[coalesce((select min_day from result_backfill where phase = 'run1')::text, 'X'),
        coalesce((select max_day from result_backfill where phase = 'run1')::text, 'X')],
  array[(current_date - 13)::text, current_date::text],
  'FUNCBACK2_el_rango_de_dias_es_exactamente_current_date_menos_13_hasta_hoy'
);

do $$
declare
  d date;
begin
  for d in select generate_series(current_date - 13, current_date, interval '1 day')::date loop
    perform public.snapshot_lead_temperature(d);
  end loop;
  insert into result_backfill
    select 'run2', true, count(*)::int, min(day), max(day)
    from public.lead_temperature_daily where lead_id = '00000000-0000-0000-0000-000000266406';
exception when others then
  insert into result_backfill values ('run2', false, -1, null, null);
end $$;

select is(coalesce((select cnt from result_backfill where phase = 'run2'), -1), 14,
  'FUNCBACK3_repetir_el_backfill_completo_NO_duplica_sigue_en_14');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) BOMBA DE FECHA — corte de día en UTC fijo, NUNCA el timezone de sesión (D-EOD). LTZ
--    tiene 1 solo signal (contacto a las 00:30 UTC del 2026-01-15). Bajo una implementación
--    "ingenua" que usara el timezone de sesión, el resultado CAMBIARÍA entre zonas (27/27/29
--    en vez de 28 constante — verificado independientemente antes de escribir este archivo).
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_tz text;
  v_temp int;
  v_ok boolean;
  v_label text;
begin
  create temp table result_tzday (tz text, ok boolean, temperature int) on commit drop;
  foreach v_tz in array array['UTC', 'America/Mexico_City', 'Pacific/Kiritimati', 'Pacific/Niue'] loop
    begin
      execute format('set local timezone to %L', v_tz);
      execute format('set local role %I', 'service_role');
      perform public.snapshot_lead_temperature('2026-01-15'::date);
      select temperature into v_temp from public.lead_temperature_daily
        where lead_id = '00000000-0000-0000-0000-000000266404' and day = '2026-01-15'::date;
      insert into result_tzday values (v_tz, true, v_temp);
      reset role;
      set local timezone to 'UTC';
    exception when others then
      insert into result_tzday values (v_tz, false, null);
      reset role;
      set local timezone to 'UTC';
    end;
  end loop;
end $$;

select is(coalesce((select temperature from result_tzday where tz = 'UTC'), -1), 28,
  'TZDAY1_UTC_signal_a_las_0030_utc_cuenta_para_el_dia_15_da_28');
select is(coalesce((select temperature from result_tzday where tz = 'America/Mexico_City'), -1), 28,
  'TZDAY2_America_Mexico_City_mismo_resultado_28_corte_es_UTC_no_sesion');
select is(coalesce((select temperature from result_tzday where tz = 'Pacific/Kiritimati'), -1), 28,
  'TZDAY3_Pacific_Kiritimati_UTC_mas_14_mismo_resultado_28');
select is(coalesce((select temperature from result_tzday where tz = 'Pacific/Niue'), -1), 28,
  'TZDAY4_Pacific_Niue_UTC_menos_11_mismo_resultado_28');

-- ════════════════════════════════════════════════════════════════════════════
-- 8) PRIVACIDAD — visibilidad de lead_temperature_daily vía impersonación real. Se siembra
--    UNA fila directa para L1 (como service_role, bypassa RLS/grants) para tener algo que
--    ver/no-ver. Protegido (la tabla aún no existe).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
create temp table result_priv_seed (ok boolean);
do $$
begin
  insert into public.lead_temperature_daily (lead_id, day, temperature, signals)
    values ('00000000-0000-0000-0000-000000266401', '2026-07-01'::date, 60, '{}'::jsonb)
    on conflict (lead_id, day) do update set temperature = excluded.temperature;
  insert into result_priv_seed values (true);
exception when others then
  insert into result_priv_seed values (false);
end $$;
reset role;

create or replace function pg_temp.priv_count(p_lead_id uuid)
returns int language plpgsql as $$
declare v int;
begin
  select count(*)::int into v from public.lead_temperature_daily
    where lead_id = p_lead_id and day = '2026-07-01'::date;
  return v;
exception when others then
  return -1;
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-000000266001'); -- AG1, dueño de L1
select is(pg_temp.priv_count('00000000-0000-0000-0000-000000266401'), 1,
  'PRIV1_el_agente_dueno_ve_su_propia_fila');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266003'); -- AG2, ajeno
select is(pg_temp.priv_count('00000000-0000-0000-0000-000000266401'), 0,
  'PRIV2_agente_ajeno_NO_ve_la_fila_de_L1');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266004'); -- OWN, owner de la agencia de AG1
select is(pg_temp.priv_count('00000000-0000-0000-0000-000000266401'), 1,
  'PRIV3_owner_de_la_agencia_ve_la_fila');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266005'); -- ADM, admin de la agencia de AG1
select is(pg_temp.priv_count('00000000-0000-0000-0000-000000266401'), 1,
  'PRIV4_admin_de_la_agencia_ve_la_fila');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266006'); -- PADMIN, admin de PLATAFORMA sin relación
select is(pg_temp.priv_count('00000000-0000-0000-0000-000000266401'), 0,
  'PRIV5_admin_de_plataforma_sin_relacion_0_filas_226');
reset role;

-- anon: sin GRANT de select en absoluto (fail-closed con dientes) -> 42501 real, no 0 filas.
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select count(*) from public.lead_temperature_daily where lead_id = '00000000-0000-0000-0000-000000266401' $$,
  '42501', null, 'PRIV6_anon_denegado_sin_grant_ni_siquiera_0_filas'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 9) PURGA de events_raw — retención 90 días, frontera `<` estricta (exactamente 90 días se
--    CONSERVA, molde purge_ad_impressions). NUNCA toca lead_temperature_daily.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.events_raw (event_type, user_id, property_id, created_at, payload) values
  ('video_view', '00000000-0000-0000-0000-000000266012', '00000000-0000-0000-0000-000000266201', now() - interval '91 days', '{}'::jsonb),
  ('video_view', '00000000-0000-0000-0000-000000266012', '00000000-0000-0000-0000-000000266201', now() - interval '90 days', '{}'::jsonb),
  ('video_view', '00000000-0000-0000-0000-000000266012', '00000000-0000-0000-0000-000000266201', now() - interval '89 days', '{}'::jsonb),
  ('video_view', '00000000-0000-0000-0000-000000266012', '00000000-0000-0000-0000-000000266201', now(), '{}'::jsonb);

select pg_temp.act_as(null, 'service_role');

-- Snapshot manual PRE-EXISTENTE que la purga NUNCA debe tocar.
create temp table result_purge_snap_seed (ok boolean);
do $$
begin
  insert into public.lead_temperature_daily (lead_id, day, temperature, signals)
    values ('00000000-0000-0000-0000-000000266401', '2026-04-01'::date, 77, '{}'::jsonb)
    on conflict (lead_id, day) do update set temperature = excluded.temperature;
  insert into result_purge_snap_seed values (true);
exception when others then
  insert into result_purge_snap_seed values (false);
end $$;

create temp table result_purge (ok boolean, cnt_remaining int, has_91d boolean, has_90d boolean, snap_temp int);
do $$
begin
  perform public.purge_events_raw();
  insert into result_purge
    select true,
      (select count(*)::int from public.events_raw where user_id = '00000000-0000-0000-0000-000000266012'),
      exists(select 1 from public.events_raw where user_id = '00000000-0000-0000-0000-000000266012' and created_at < now() - interval '90 days 1 hour'),
      exists(select 1 from public.events_raw where user_id = '00000000-0000-0000-0000-000000266012' and created_at between now() - interval '90 days 1 hour' and now() - interval '89 days 23 hours'),
      (select temperature from public.lead_temperature_daily where lead_id = '00000000-0000-0000-0000-000000266401' and day = '2026-04-01'::date);
exception when others then
  insert into result_purge values (false, -1, null, null, null);
end $$;
reset role;

select is(coalesce((select cnt_remaining from result_purge), -1), 3,
  'PURGE1_quedan_exactamente_3_filas_90d_89d_hoy_la_de_91d_se_borro');
select is(coalesce((select has_91d from result_purge), true), false,
  'PURGE2_la_fila_de_91_dias_fue_borrada');
select is(coalesce((select has_90d from result_purge), false), true,
  'PURGE3_la_fila_de_exactamente_90_dias_se_CONSERVA_frontera_estricta');
select is(coalesce((select snap_temp from result_purge), -1), 77,
  'PURGE4_lead_temperature_daily_queda_intacta_la_purga_nunca_la_toca'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 10) pg_cron — jobs nuevos registrados, jobname/schedule/command exactos, conviven con los
--     3 jobs ya existentes (purge_ad_impressions_daily, rollup_ad_impressions_monthly_daily,
--     check_rollup_health_daily). Catálogo puro, seguro aunque el job no exista.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from cron.job where jobname = 'snapshot_lead_temperature_daily'),
  1, 'CRON1_existe_exactamente_1_job_snapshot_lead_temperature_daily'
);
select is(
  coalesce((select schedule from cron.job where jobname = 'snapshot_lead_temperature_daily'), 'NONE'),
  '0 7 * * *', 'CRON2_snapshot_schedule_0_7_utc'
);
select is(
  coalesce((select command from cron.job where jobname = 'snapshot_lead_temperature_daily'), 'NONE'),
  'select public.snapshot_lead_temperature();', 'CRON3_snapshot_command_exacto'
);
select is(
  (select count(*)::int from cron.job where jobname = 'purge_events_raw_daily'),
  1, 'CRON4_existe_exactamente_1_job_purge_events_raw_daily'
);
select is(
  coalesce((select schedule from cron.job where jobname = 'purge_events_raw_daily'), 'NONE'),
  '0 9 * * *', 'CRON5_purge_schedule_0_9_utc'
);
select is(
  coalesce((select command from cron.job where jobname = 'purge_events_raw_daily'), 'NONE'),
  'select public.purge_events_raw();', 'CRON6_purge_command_exacto'
);
select is(
  (select count(*)::int from cron.job where jobname in (
    'snapshot_lead_temperature_daily', 'purge_events_raw_daily',
    'purge_ad_impressions_daily', 'rollup_ad_impressions_monthly_daily', 'check_rollup_health_daily'
  )),
  5, 'CRON7_los_2_jobs_nuevos_conviven_con_los_3_jobs_existentes_no_los_reemplaza'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 11) check_rollup_health() EXTENDIDA — mismo mecanismo que 92_rollup_monitor_test.sql
--     (notifications, type='admin_rollup_unhealthy'), 2 condiciones NUEVAS. Este archivo
--     NUNCA toca 92_rollup_monitor_test.sql ni sus asserts.
-- ════════════════════════════════════════════════════════════════════════════

-- D-COND-C: snapshot faltante para current_date/current_date-1, habiendo lead activo (L1
-- siempre activo en todo este archivo).
select pg_temp.act_as(null, 'service_role');
create temp table result_condc (ok boolean);
do $$
begin
  delete from public.lead_temperature_daily where day in (current_date, current_date - 1);
  insert into result_condc values (true);
exception when others then
  insert into result_condc values (false);
end $$;
reset role;

delete from public.notifications where type = 'admin_rollup_unhealthy' and data ->> 'condition' = 'stale_snapshot';
select public.check_rollup_health();

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000266006' -- PADMIN
      and type = 'admin_rollup_unhealthy' and data ->> 'condition' = 'stale_snapshot'),
  1, 'CONDC1_unhealthy_sin_snapshot_de_hoy_ni_ayer_habiendo_lead_activo_avisa'
);

-- Sano: existe una fila de snapshot para hoy.
select pg_temp.act_as(null, 'service_role');
create temp table result_condc_healthy (ok boolean);
do $$
begin
  insert into public.lead_temperature_daily (lead_id, day, temperature, signals)
    values ('00000000-0000-0000-0000-000000266401', current_date, 40, '{}'::jsonb)
    on conflict (lead_id, day) do update set temperature = excluded.temperature;
  insert into result_condc_healthy values (true);
exception when others then
  insert into result_condc_healthy values (false);
end $$;
reset role;

delete from public.notifications where type = 'admin_rollup_unhealthy' and data ->> 'condition' = 'stale_snapshot';
select public.check_rollup_health();

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000266006'
      and type = 'admin_rollup_unhealthy' and data ->> 'condition' = 'stale_snapshot'),
  0, 'CONDC2_sano_con_snapshot_de_hoy_no_avisa'
);

-- D-COND-D: jobs nuevos con 3 corridas consecutivas sin 'succeeded'. Fixture: se registran
-- los 2 jobs con un comando INOCUO (NO es el SUT) solo para tener un jobid real donde colgar
-- cron.job_run_details -- el mismo mecanismo que 92 usa contra un job YA existente.
select cron.schedule('snapshot_lead_temperature_daily', '0 7 * * *', 'select 1;');
select cron.schedule('purge_events_raw_daily', '0 9 * * *', 'select 1;');

create or replace function pg_temp.seed_job_runs(p_jobname text, p_statuses text[])
returns void language plpgsql as $$
declare
  v_jobid bigint;
  v_status text;
  v_i int := 0;
begin
  select jobid into v_jobid from cron.job where jobname = p_jobname;
  delete from cron.job_run_details where jobid = v_jobid;
  foreach v_status in array p_statuses loop
    v_i := v_i + 1;
    insert into cron.job_run_details (runid, jobid, job_pid, database, username, command, status, start_time, end_time)
    values ((select coalesce(max(runid), 0) + 1 from cron.job_run_details),
            v_jobid, 1, current_database(), current_user, 'select 1;', v_status,
            now() - (v_i || ' minutes')::interval, now() - (v_i || ' minutes')::interval + interval '1 second');
  end loop;
end $$;

select pg_temp.seed_job_runs('snapshot_lead_temperature_daily', array['failed', 'failed', 'failed']);
delete from public.notifications where type = 'admin_rollup_unhealthy' and data ->> 'condition' = 'job_failing' and data ->> 'job' = 'snapshot_lead_temperature_daily';
select public.check_rollup_health();

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000266006'
      and type = 'admin_rollup_unhealthy' and data ->> 'condition' = 'job_failing'
      and data ->> 'job' = 'snapshot_lead_temperature_daily'),
  1, 'CONDD1_job_snapshot_con_3_corridas_sin_succeeded_avisa'
);

-- Sano: 1 de las últimas 3 se recuperó ('succeeded').
select pg_temp.seed_job_runs('snapshot_lead_temperature_daily', array['failed', 'succeeded', 'failed']);
delete from public.notifications where type = 'admin_rollup_unhealthy' and data ->> 'condition' = 'job_failing' and data ->> 'job' = 'snapshot_lead_temperature_daily';
select public.check_rollup_health();

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000266006'
      and type = 'admin_rollup_unhealthy' and data ->> 'condition' = 'job_failing'
      and data ->> 'job' = 'snapshot_lead_temperature_daily'),
  0, 'CONDD2_sano_1_de_las_ultimas_3_se_recupero_no_avisa'
);

-- El OTRO job nuevo (purge_events_raw_daily) dispara su PROPIA alerta -- prueba que el
-- mecanismo generaliza a los 2 jobs, no está hardcodeado a uno solo.
select pg_temp.seed_job_runs('purge_events_raw_daily', array['failed', 'failed', 'failed']);
delete from public.notifications where type = 'admin_rollup_unhealthy' and data ->> 'condition' = 'job_failing' and data ->> 'job' = 'purge_events_raw_daily';
select public.check_rollup_health();

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000266006'
      and type = 'admin_rollup_unhealthy' and data ->> 'condition' = 'job_failing'
      and data ->> 'job' = 'purge_events_raw_daily'),
  1, 'CONDD3_job_purge_events_raw_con_3_corridas_sin_succeeded_avisa_tambien'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 12) Índice leads_agent_score_idx — el único que el EXPLAIN de 266.1 justificó.
-- ════════════════════════════════════════════════════════════════════════════

select has_index('public', 'leads', 'leads_agent_score_idx', 'IDX1_indice_leads_agent_score_idx_existe');

select is(
  coalesce((select indexdef from pg_indexes where schemaname = 'public' and tablename = 'leads' and indexname = 'leads_agent_score_idx'), 'NONE'),
  'CREATE INDEX leads_agent_score_idx ON public.leads USING btree (agent_id, score DESC) WHERE (deleted_at IS NULL)',
  'IDX2_definicion_exacta_agent_id_score_desc_parcial_deleted_at_is_null'
);

select * from finish();
rollback;
