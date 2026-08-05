-- Tests pgTAP — Camino B del wizard de upgrade (subtarea 71.3) REUSANDO
-- public.agent_applications (decisión de Abraham en checkpoint: NO se crea
-- agent_requests — la tabla hermana ya existente, migración 20260604000003, con
-- RLS en 20260604000008/20260604000010, cubre el caso "solicitud a admin").
-- Ejecutar con: supabase test db
-- Corre como superusuario dentro de una transacción revertida (no persiste).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Dos bloques con intención DISTINTA (convención de 21_agency_member_role_matrix):
-- ════════════════════════════════════════════════════════════════════════════
-- [NO-REGRESIÓN] — la tabla, columnas, RLS y políticas agent_app_* YA EXISTEN HOY.
--   Estos asserts deben pasar en verde YA, tal cual está el código: documentan el
--   comportamiento real (leído del texto de las políticas en
--   20260604000010_security_perf_hardening.sql, no inventado) para que un cambio
--   futuro que las debilite se note aquí. Incluye una corrección a la premisa
--   original de la subtarea: el índice único parcial anti-duplicados
--   (agent_app_one_pending_per_user, migración 0003) YA EXISTE — no es delta.
-- [DELTA] — lo único que GREEN debe agregar: la columna `reason` (motivo del
--   solicitante; nullable — "docs no obligatorios en beta" aplica también al
--   motivo mismo, no solo a los adjuntos). Falla hoy por aserción.
--
-- Contrato real de agent_app_update (verificado con \d y el texto de la migración
-- 20260604000010, NO inventado):
--   create policy agent_app_update on public.agent_applications for update
--     to authenticated using (private.is_admin()) with check (private.is_admin());
-- Es decir: el USING no compara user_id — un no-admin (incluido el dueño) NUNCA
-- pasa el USING, así que CUALQUIER UPDATE de un no-admin sobre CUALQUIER fila
-- (propia o ajena) afecta 0 filas. El "status-lock" pedido por el checkpoint YA
-- está cubierto -> es NO-REGRESIÓN, no delta (test #15-16 abajo).
--
-- Camino B usa exclusivamente application_type='independent' (agency_id NULL);
-- el constraint agent_app_agency_required (migración 0003) sigue exigiendo
-- agency_id NOT NULL para 'under_agency' — se verifica como no-regresión (#25)
-- porque comparte la tabla con el flujo bajo-inmobiliaria existente.
--
-- Patrón de impersonación: pg_temp.act_as (igual que 02/16/17/18/21/22_*).
-- La tabla YA existe: la mayoría de los statements son directos (sin wrapper).
-- Solo el delta de `reason` necesita wrapper (undefined_column, mismo espíritu
-- que el sentinel '__function_missing__'/'__table_missing__' de 21_*/22_*).

begin;
select plan(32);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- Wrapper SOLO para el delta de `reason` (columna aún no existe -> undefined_column
-- abortaría la transacción si no se protege).
create or replace function pg_temp.try_insert_reason(p_id uuid, p_user_id uuid, p_reason text)
returns text language plpgsql as $$
begin
  insert into public.agent_applications (id, user_id, application_type, reason)
  values (p_id, p_user_id, 'independent', p_reason);
  return 'ok';
exception
  when undefined_column then return '__reason_missing__';
  when insufficient_privilege then return '__insert_denied__';
  when unique_violation then return '__duplicate_pending__';
end $$;

create or replace function pg_temp.safe_reason_value(p_id uuid) returns text language plpgsql as $$
declare v text;
begin
  select reason into v from public.agent_applications where id = p_id;
  return coalesce(v, '__null_or_no_visible__');
exception when undefined_column then return '__reason_missing__';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000714310', 'appb_usuario_a@test.local'),
  ('00000000-0000-0000-0000-000000714311', 'appb_usuario_b@test.local'),
  ('00000000-0000-0000-0000-000000714312', 'appb_admin@test.local'),
  ('00000000-0000-0000-0000-000000714313', 'appb_usuario_c@test.local'),
  ('00000000-0000-0000-0000-000000714314', 'appb_usuario_d@test.local'),
  ('00000000-0000-0000-0000-000000714315', 'appb_usuario_e@test.local');

update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000714312';

-- ════════════════════════════════════════════════════════════════════════════
-- [NO-REGRESIÓN] 1-7) Schema + RLS habilitada (ya existen)
-- ════════════════════════════════════════════════════════════════════════════

select has_table('public', 'agent_applications', 'tabla public.agent_applications existe');
select has_column('public', 'agent_applications', 'user_id', 'agent_applications.user_id existe');
select has_column('public', 'agent_applications', 'application_type', 'agent_applications.application_type existe');
select has_column('public', 'agent_applications', 'status', 'agent_applications.status existe');
select has_column('public', 'agent_applications', 'agency_id', 'agent_applications.agency_id existe');
select has_column('public', 'agent_applications', 'invitation_token_id', 'agent_applications.invitation_token_id existe');
select ok(
  coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = 'agent_applications'), false),
  'RLS habilitada en public.agent_applications'
);

-- ════════════════════════════════════════════════════════════════════════════
-- [NO-REGRESIÓN] 8-9) Insert propio (Camino B = application_type='independent')
--                     + status default 'pending'
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000714310');
select lives_ok(
  $$ insert into public.agent_applications (id, user_id, application_type)
     values ('00000000-0000-0000-0000-000000714320'::uuid, '00000000-0000-0000-0000-000000714310'::uuid, 'independent') $$,
  'usuario_a crea su propia solicitud independiente (Camino B)'
);
select is(
  (select status::text from public.agent_applications where id = '00000000-0000-0000-0000-000000714320'),
  'pending',
  'status por default queda en pending'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- [NO-REGRESIÓN] 10-11) No puede insertar a nombre de OTRO usuario
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000714310');
select throws_ok(
  $$ insert into public.agent_applications (id, user_id, application_type)
     values ('00000000-0000-0000-0000-000000714321'::uuid, '00000000-0000-0000-0000-000000714311'::uuid, 'independent') $$,
  '42501', null,
  'usuario_a NO puede insertar una solicitud con user_id de usuario_b'
);
reset role;

select is(
  (select count(*)::int from public.agent_applications where id = '00000000-0000-0000-0000-000000714321'),
  0,
  'la fila del intento de insert a nombre de otro usuario nunca se creó'
);

-- ════════════════════════════════════════════════════════════════════════════
-- [NO-REGRESIÓN] 12-14) Visibilidad: dueño ve la suya, otro usuario no, admin ve todas
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000714310');
select is(
  (select count(*)::int from public.agent_applications where id = '00000000-0000-0000-0000-000000714320'),
  1,
  'usuario_a ve su propia solicitud'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000714311');
select is(
  (select count(*)::int from public.agent_applications where id = '00000000-0000-0000-0000-000000714320'),
  0,
  'usuario_b NO ve la solicitud de usuario_a'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000714312');
select is(
  (select count(*)::int from public.agent_applications where id = '00000000-0000-0000-0000-000000714320'),
  1,
  'admin ve la solicitud de usuario_a (cola completa para revisión, 71.5)'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- [NO-REGRESIÓN] 15-18) El dueño NO puede cambiar su propio status (status-lock
-- YA cubierto por agent_app_update: using (private.is_admin())); el admin SÍ puede
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000714310');
with u as (
  update public.agent_applications set status = 'approved'
   where id = '00000000-0000-0000-0000-000000714320'
   returning id
)
select is(count(*)::int, 0, 'usuario_a (dueño, no-admin) no puede aprobar su propia solicitud') from u;
reset role;

select is(
  (select status::text from public.agent_applications where id = '00000000-0000-0000-0000-000000714320'),
  'pending',
  'tras el intento del dueño, el status sigue en pending'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000714312');
with u as (
  update public.agent_applications set status = 'approved'
   where id = '00000000-0000-0000-0000-000000714320'
   returning id
)
select is(count(*)::int, 1, 'admin SÍ puede aprobar la solicitud (agent_app_update using is_admin())') from u;
reset role;

select is(
  (select status::text from public.agent_applications where id = '00000000-0000-0000-0000-000000714320'),
  'approved',
  'tras la actualización del admin, el status queda en approved'
);

-- ════════════════════════════════════════════════════════════════════════════
-- [NO-REGRESIÓN] 19-22) Delete: el dueño no puede, el admin sí
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000714315');
select lives_ok(
  $$ insert into public.agent_applications (id, user_id, application_type)
     values ('00000000-0000-0000-0000-000000714330'::uuid, '00000000-0000-0000-0000-000000714315'::uuid, 'independent') $$,
  'usuario_e crea su propia solicitud (fixture para el bloque de delete)'
);
with d as (
  delete from public.agent_applications where id = '00000000-0000-0000-0000-000000714330' returning id
)
select is(count(*)::int, 0, 'usuario_e (dueño) no puede eliminar su propia solicitud') from d;
reset role;

select ok(
  exists (select 1 from public.agent_applications where id = '00000000-0000-0000-0000-000000714330'),
  'la solicitud de usuario_e sigue existiendo tras el intento de borrado por el dueño'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000714312');
with d as (
  delete from public.agent_applications where id = '00000000-0000-0000-0000-000000714330' returning id
)
select is(count(*)::int, 1, 'admin sí puede eliminar la solicitud de usuario_e') from d;
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- [NO-REGRESIÓN] 23-24) anon: cero acceso
-- ════════════════════════════════════════════════════════════════════════════

-- anon carece incluso del GRANT de tabla (no es solo RLS): un SELECT directo lanza
-- 42501 "permission denied for table" antes de que la política se evalúe siquiera
-- (confirmado contra information_schema.role_table_grants: anon no tiene SELECT/
-- INSERT en agent_applications) -- se prueba con throws_ok, no con un count directo.
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select count(*) from public.agent_applications $$,
  '42501', null,
  'anon no puede ni siquiera leer agent_applications (sin GRANT de tabla)'
);
select throws_ok(
  $$ insert into public.agent_applications (id, user_id, application_type)
     values ('00000000-0000-0000-0000-000000714331'::uuid, '00000000-0000-0000-0000-000000714310'::uuid, 'independent') $$,
  '42501', null,
  'anon no puede insertar una solicitud'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- [NO-REGRESIÓN] 25) El constraint agent_app_agency_required sigue vigente:
-- 'under_agency' sin agency_id sigue bloqueado (comparte tabla con Camino A/bajo
-- inmobiliaria; reusar la tabla para Camino B no debe aflojar esta regla).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000714310');
select throws_ok(
  $$ insert into public.agent_applications (id, user_id, application_type, agency_id)
     values ('00000000-0000-0000-0000-000000714332'::uuid, '00000000-0000-0000-0000-000000714310'::uuid, 'under_agency', null) $$,
  '23514', null,
  'under_agency sin agency_id sigue bloqueado por agent_app_agency_required'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- [NO-REGRESIÓN] 26-28) Duplicados: el índice único parcial
-- agent_app_one_pending_per_user (migración 0003) YA EXISTE -- corrección a la
-- premisa original de la subtarea, no es delta.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000714313');
select lives_ok(
  $$ insert into public.agent_applications (id, user_id, application_type)
     values ('00000000-0000-0000-0000-000000714340'::uuid, '00000000-0000-0000-0000-000000714313'::uuid, 'independent') $$,
  'usuario_c inserta su primera solicitud pending'
);
select throws_ok(
  $$ insert into public.agent_applications (id, user_id, application_type)
     values ('00000000-0000-0000-0000-000000714341'::uuid, '00000000-0000-0000-0000-000000714313'::uuid, 'independent') $$,
  '23505', null,
  'usuario_c NO puede insertar una segunda solicitud mientras la primera sigue pending (agent_app_one_pending_per_user)'
);
reset role;

select is(
  (select count(*)::int from public.agent_applications
    where user_id = '00000000-0000-0000-0000-000000714313' and status::text = 'pending'),
  1,
  'usuario_c tiene exactamente 1 solicitud pending tras el intento de duplicado'
);

-- ════════════════════════════════════════════════════════════════════════════
-- [DELTA] 29-32) Columna reason (motivo del solicitante, nullable) -- ÚNICO delta
-- real de este checkpoint; aún NO existe en agent_applications.
-- ════════════════════════════════════════════════════════════════════════════

select has_column('public', 'agent_applications', 'reason', 'agent_applications.reason existe (delta GREEN)');
select col_is_null('public', 'agent_applications', 'reason', 'agent_applications.reason es nullable (docs/motivo no obligatorio en beta)');

select pg_temp.act_as('00000000-0000-0000-0000-000000714314');
select is(
  pg_temp.try_insert_reason('00000000-0000-0000-0000-000000714350', '00000000-0000-0000-0000-000000714314', 'Quiero atender más zonas de la ciudad'),
  'ok',
  'usuario_d inserta su solicitud incluyendo reason'
);
select is(
  pg_temp.safe_reason_value('00000000-0000-0000-0000-000000714350'),
  'Quiero atender más zonas de la ciudad',
  'el reason insertado se persiste tal cual'
);
reset role;

select * from finish();
rollback;
