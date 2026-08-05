-- Tests pgTAP — agency_member_role a 4 niveles + matriz de permisos (subtarea 71.2)
-- Ejecutar con: supabase test db
-- Corre como superusuario dentro de una transacción revertida (no persiste).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SUT (aún NO existe — se crea en DOS migraciones GREEN, ver GOTCHA abajo):
-- ════════════════════════════════════════════════════════════════════════════
-- 1) public.agency_member_role pasa de ('owner','agent') a exactamente
--    ('owner','admin','agent','viewer') (4 valores).
-- 2) private.agency_role_of(p_agency_id uuid) returns agency_member_role
--    SECURITY DEFINER STABLE, schema private, EXECUTE solo a `authenticated`
--    (mismo patrón que private.manages_agency / private.is_premium) — el rol
--    ACTIVO del usuario actual ((select auth.uid())) en esa agencia, o NULL si
--    no es miembro activo. Es el SEAM mínimo que la matriz necesita; el resto
--    de la lógica puede vivir en policies que lo compongan con is_admin()/
--    manages_agency() existentes — eso es libertad de implementación de GREEN.
-- 3) Políticas RLS reescritas (agency_members, properties, agencies) para
--    aplicar la matriz PRD §4.10:
--      owner  → todo sobre su agencia (incl. properties de sus agentes — HOY
--               properties_update NO lo permite; ver caso DELTA #30).
--      admin  → INSERT/UPDATE/DELETE agency_members de su agencia EXCEPTO
--               tocar la fila cuyo member_role='owner' NI promover ninguna
--               fila (incl. la propia) a 'owner'; UPDATE de properties de
--               cualquier miembro de su agencia; NUNCA UPDATE/DELETE la fila
--               de `agencies`.
--      agent  → sin cambios: gestiona solo sus propias properties, no
--               agency_members.
--      viewer → SELECT de properties/agency_members de su agencia; CERO
--               escritura (INSERT/UPDATE/DELETE bloqueados en todo).
--
-- 🔒 GOTCHA (instrucción del orquestador): `ALTER TYPE ... ADD VALUE` no puede
-- convivir en la misma transacción con código que use los valores nuevos →
-- GREEN serán DOS migraciones (enum primero, políticas después). Estos tests
-- NO asumen ese detalle — corren igual sea 1 o 2 migraciones, siempre que al
-- final el enum tenga los 4 valores y las políticas estén activas.
--
-- ── Estrategia RED sin abortar la transacción ────────────────────────────────
-- Los valores 'admin'/'viewer' HOY no existen en el enum: castear texto a un
-- valor inexistente (`'admin'::agency_member_role`) lanza 22P02 y ABORTARÍA
-- toda la transacción si no se protege. Se protege así:
--   (a) pg_temp.try_add_member(...): INSERT envuelto en BEGIN/EXCEPTION que
--       atrapa invalid_text_representation y regresa boolean (no aborta).
--   (b) Las pruebas de VALOR de private.agency_role_of usan un wrapper que
--       atrapa undefined_function/invalid_schema_name y regresa el centinela
--       '__function_missing__' (NUNCA NULL real) — así "no soy miembro→NULL"
--       se distingue limpio de "la función todavía no existe" (si el wrapper
--       regresara NULL en ambos casos, el caso "no-miembro" pasaría por
--       casualidad HOY, sin ser un RED válido).
--   (c) INSERT/DELETE bloqueados por RLS (WITH CHECK/USING) NO abortan la
--       transacción salvo el caso INSERT-denegado, que sí lanza 42501 → se
--       prueba con throws_ok (protegido internamente, mismo patrón que
--       02_rls_test.sql #13-14 y 05_admin_create_agency_test.sql).
--
-- ── Convención DELTA vs INVARIANTE (para el guardian) ────────────────────────
-- DELTA      = hoy falla por assertion, tras GREEN completo pasa (discrimina).
-- INVARIANTE = ya se cumple hoy (el actor nuevo -admin/viewer- simplemente no
--              tiene membresía posible todavía, o la regla ya existía) Y debe
--              seguir cumpliéndose tras GREEN — red de seguridad explícita-
--              mente pedida en el matriz (p.ej. "admin no toca agencies"),
--              no un caso inventado.

begin;
select plan(37);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures
-- ════════════════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000712110', 'owner_a@test.local'),
  ('00000000-0000-0000-0000-000000712111', 'admin_a@test.local'),
  ('00000000-0000-0000-0000-000000712112', 'agent_a@test.local'),
  ('00000000-0000-0000-0000-000000712113', 'agent_a2@test.local'),
  ('00000000-0000-0000-0000-000000712114', 'agent_a3@test.local'),
  ('00000000-0000-0000-0000-000000712115', 'viewer_a@test.local'),
  ('00000000-0000-0000-0000-000000712116', 'agent_a4_nuevo@test.local'),
  ('00000000-0000-0000-0000-000000712117', 'agent_a5_sin_membresia@test.local'),
  ('00000000-0000-0000-0000-000000712120', 'owner_b@test.local'),
  ('00000000-0000-0000-0000-000000712121', 'admin_b@test.local'),
  ('00000000-0000-0000-0000-000000712122', 'agent_b@test.local'),
  ('00000000-0000-0000-0000-000000712123', 'viewer_b@test.local');

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000712100', 'Inmobiliaria Matriz A', 'inmo-matriz-a', 'active', '00000000-0000-0000-0000-000000712110'),
  ('00000000-0000-0000-0000-000000712101', 'Inmobiliaria Matriz B', 'inmo-matriz-b', 'active', '00000000-0000-0000-0000-000000712120');

-- Miembros con roles YA válidos en el enum de 2 valores (owner/agent): insert directo.
insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000712130', '00000000-0000-0000-0000-000000712100', '00000000-0000-0000-0000-000000712110', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000712132', '00000000-0000-0000-0000-000000712100', '00000000-0000-0000-0000-000000712112', 'agent', 'active'),
  ('00000000-0000-0000-0000-000000712133', '00000000-0000-0000-0000-000000712100', '00000000-0000-0000-0000-000000712113', 'agent', 'active'),
  ('00000000-0000-0000-0000-000000712134', '00000000-0000-0000-0000-000000712100', '00000000-0000-0000-0000-000000712114', 'agent', 'active'),
  ('00000000-0000-0000-0000-000000712140', '00000000-0000-0000-0000-000000712101', '00000000-0000-0000-0000-000000712120', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000712142', '00000000-0000-0000-0000-000000712101', '00000000-0000-0000-0000-000000712122', 'agent', 'active');

-- Wrapper: inserta un member_role que puede aún no existir en el enum sin abortar la transacción.
create or replace function pg_temp.try_add_member(p_id uuid, p_agency_id uuid, p_user_id uuid, p_role text)
returns boolean language plpgsql as $$
begin
  insert into public.agency_members (id, agency_id, user_id, member_role, status)
  values (p_id, p_agency_id, p_user_id, p_role::agency_member_role, 'active');
  return true;
exception when invalid_text_representation then
  return false;
end $$;

-- Miembros con roles NUEVOS ('admin','viewer') — hoy fallan silenciosamente (sin abortar).
select pg_temp.try_add_member('00000000-0000-0000-0000-000000712131', '00000000-0000-0000-0000-000000712100', '00000000-0000-0000-0000-000000712111', 'admin');
select pg_temp.try_add_member('00000000-0000-0000-0000-000000712135', '00000000-0000-0000-0000-000000712100', '00000000-0000-0000-0000-000000712115', 'viewer');
select pg_temp.try_add_member('00000000-0000-0000-0000-000000712141', '00000000-0000-0000-0000-000000712101', '00000000-0000-0000-0000-000000712121', 'admin');
select pg_temp.try_add_member('00000000-0000-0000-0000-000000712143', '00000000-0000-0000-0000-000000712101', '00000000-0000-0000-0000-000000712123', 'viewer');

-- Properties (todas 'draft' = privadas: fuerza a que la visibilidad dependa de la
-- matriz de roles de agencia, no de la regla pública "status=active" ya existente).
insert into public.properties (id, owner_user_id, agency_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000712150', '00000000-0000-0000-0000-000000712112', '00000000-0000-0000-0000-000000712100',
   'departamento', 'rent', 'Fixture matriz — property de agent_a', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 12000, 'draft'),
  ('00000000-0000-0000-0000-000000712151', '00000000-0000-0000-0000-000000712113', '00000000-0000-0000-0000-000000712100',
   'casa', 'sale', 'Fixture matriz — property de agent_a2', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.36, 20.68), 4326)::extensions.geography, 2500000, 'draft'),
  ('00000000-0000-0000-0000-000000712152', '00000000-0000-0000-0000-000000712122', '00000000-0000-0000-0000-000000712101',
   'local', 'rent', 'Fixture matriz — property de agent_b (agencia B)', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.34, 20.66), 4326)::extensions.geography, 8000, 'draft');

-- Helper de impersonación inline (patrón de 02_rls_test.sql).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- Wrapper de valor para private.agency_role_of — centinela para distinguir
-- "función no existe todavía" de un NULL real de negocio (no-miembro).
create or replace function pg_temp.role_of_or_sentinel(p_agency_id uuid)
returns text language plpgsql as $$
begin
  return private.agency_role_of(p_agency_id)::text;
exception when undefined_function or invalid_schema_name then
  return '__function_missing__';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1-3) Enum agency_member_role tiene exactamente 4 valores [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select ok(
  exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'agency_member_role' and e.enumlabel = 'admin'),
  'agency_member_role_incluye_admin'
);

select ok(
  exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'agency_member_role' and e.enumlabel = 'viewer'),
  'agency_member_role_incluye_viewer'
);

select is(
  (select array_agg(e.enumlabel::text order by e.enumlabel) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'agency_member_role'),
  ARRAY['admin', 'agent', 'owner', 'viewer'],
  'agency_member_role_tiene_exactamente_4_valores_admin_agent_owner_viewer'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4-6) Contrato del helper private.agency_role_of(uuid) [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select has_function(
  'private',
  'agency_role_of',
  ARRAY['uuid'],
  'private.agency_role_of(uuid) debe existir en el schema private'
);

select ok(
  exists (
    select 1 from information_schema.routine_privileges
    where routine_schema = 'private' and routine_name = 'agency_role_of'
      and grantee = 'authenticated' and privilege_type = 'EXECUTE'
  ),
  'authenticated_tiene_execute_sobre_agency_role_of'
);

select ok(
  not exists (
    select 1 from information_schema.routine_privileges
    where routine_schema = 'private' and routine_name = 'agency_role_of'
      and grantee = 'anon' and privilege_type = 'EXECUTE'
  ),
  'anon_no_tiene_execute_sobre_agency_role_of'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7-11) Valor de retorno de agency_role_of (wrapper centinela) [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000712110');
select is(pg_temp.role_of_or_sentinel('00000000-0000-0000-0000-000000712100'), 'owner', 'agency_role_of_owner_devuelve_owner');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000712112');
select is(pg_temp.role_of_or_sentinel('00000000-0000-0000-0000-000000712100'), 'agent', 'agency_role_of_agent_devuelve_agent');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000712111');
select is(pg_temp.role_of_or_sentinel('00000000-0000-0000-0000-000000712100'), 'admin', 'agency_role_of_admin_devuelve_admin');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000712115');
select is(pg_temp.role_of_or_sentinel('00000000-0000-0000-0000-000000712100'), 'viewer', 'agency_role_of_viewer_devuelve_viewer');
reset role;

-- agent_b (miembro de la agencia B) NO es miembro de la agencia A → NULL real.
select pg_temp.act_as('00000000-0000-0000-0000-000000712122');
select is(pg_temp.role_of_or_sentinel('00000000-0000-0000-0000-000000712100'), null, 'agency_role_of_no_miembro_devuelve_null');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 12-16) Admin de agencia: gestión de agency_members [DELTA + INVARIANTE]
-- ════════════════════════════════════════════════════════════════════════════

-- 12) [DELTA] admin_a inserta un nuevo agente en SU agencia.
select pg_temp.act_as('00000000-0000-0000-0000-000000712111');
select lives_ok(
  $$ insert into public.agency_members (id, agency_id, user_id, member_role, status)
     values ('00000000-0000-0000-0000-000000712136', '00000000-0000-0000-0000-000000712100',
             '00000000-0000-0000-0000-000000712116', 'agent', 'active') $$,
  'admin_de_agencia_inserta_nuevo_agente_en_su_agencia'
);
reset role;

-- 13) [DELTA] admin_a puede UPDATE las filas NO-owner de su agencia, pero jamás la del owner
--     (se compara el set exacto de ids afectados; se acota a los 6 ids originales del fixture
--     para no mezclar con la fila insertada por el test #12).
select pg_temp.act_as('00000000-0000-0000-0000-000000712111');
with u as (
  update public.agency_members
     set updated_at = now()
   where agency_id = '00000000-0000-0000-0000-000000712100'
     and user_id in (
       '00000000-0000-0000-0000-000000712110', '00000000-0000-0000-0000-000000712111',
       '00000000-0000-0000-0000-000000712112', '00000000-0000-0000-0000-000000712113',
       '00000000-0000-0000-0000-000000712114', '00000000-0000-0000-0000-000000712115'
     )
   returning id
)
select is(
  array_agg(id order by id),
  ARRAY[
    '00000000-0000-0000-0000-000000712131', '00000000-0000-0000-0000-000000712132',
    '00000000-0000-0000-0000-000000712133', '00000000-0000-0000-0000-000000712134',
    '00000000-0000-0000-0000-000000712135'
  ]::uuid[],
  'admin_actualiza_todos_los_no_owner_de_su_agencia_pero_nunca_la_fila_owner'
) from u;
reset role;

-- 13a) [INVARIANTE] admin_a NO puede promover a otro agente (agent_a, fila 712132) a owner.
-- Guardian V1: sin este assert, debilitar el WITH CHECK de members_update a
-- can_manage_agency_member(agency_id,'agent') (permitiendo cualquier member_role nuevo)
-- deja la suite en verde por mutación -- §13 solo tocaba updated_at, nunca member_role.
select pg_temp.act_as('00000000-0000-0000-0000-000000712111');
select throws_ok(
  $$ update public.agency_members set member_role = 'owner'
      where id = '00000000-0000-0000-0000-000000712132' $$,
  '42501', null,
  'admin_no_puede_promover_a_otro_agente_a_owner'
);
reset role;

-- 13b) [INVARIANTE] admin_a NO puede auto-promoverse a owner (vector realista de escalación:
-- su propia fila 712131, ya admin, intenta subir a member_role='owner').
select pg_temp.act_as('00000000-0000-0000-0000-000000712111');
select throws_ok(
  $$ update public.agency_members set member_role = 'owner'
      where id = '00000000-0000-0000-0000-000000712131' $$,
  '42501', null,
  'admin_no_puede_auto_promoverse_a_owner'
);
reset role;

-- 13c) [INVARIANTE] admin_a NO puede INSERTAR una fila nueva con member_role='owner' en su
-- agencia (mismo WITH CHECK que 13a/13b, ahora por el lado INSERT). Usuario sin membresía
-- activa previa (agency_members_one_active_per_user) para no chocar con el índice único.
select pg_temp.act_as('00000000-0000-0000-0000-000000712111');
select throws_ok(
  $$ insert into public.agency_members (agency_id, user_id, member_role, status)
     values ('00000000-0000-0000-0000-000000712100', '00000000-0000-0000-0000-000000712117',
             'owner', 'active') $$,
  '42501', null,
  'admin_no_puede_insertar_una_fila_nueva_como_owner'
);
reset role;

-- 14) [DELTA] admin_a elimina a agent_a3 (fila NO-owner) de su agencia.
select pg_temp.act_as('00000000-0000-0000-0000-000000712111');
with d as (
  delete from public.agency_members
   where id = '00000000-0000-0000-0000-000000712134'
   returning id
)
select is(count(*)::int, 1, 'admin_elimina_una_fila_no_owner_de_su_agencia') from d;
reset role;

-- 15) [INVARIANTE] admin_a intenta eliminar la fila del owner → bloqueado (sigue existiendo).
select pg_temp.act_as('00000000-0000-0000-0000-000000712111');
with d as (
  delete from public.agency_members
   where id = '00000000-0000-0000-0000-000000712130'
   returning id
)
select is(count(*)::int, 0, 'admin_no_puede_eliminar_la_fila_del_owner') from d;
reset role;
select ok(
  exists (select 1 from public.agency_members where id = '00000000-0000-0000-0000-000000712130'),
  'la_fila_del_owner_sigue_existiendo_tras_el_intento_de_borrado_por_admin'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 17-18) Admin de agencia: UPDATE properties de la agencia [DELTA + INVARIANTE]
-- ════════════════════════════════════════════════════════════════════════════

-- 17) [DELTA] admin_a actualiza el price de la property de agent_a2 (misma agencia).
select pg_temp.act_as('00000000-0000-0000-0000-000000712111');
with u as (
  update public.properties set price = 2600000
   where id = '00000000-0000-0000-0000-000000712151'
   returning id
)
select is(count(*)::int, 1, 'admin_actualiza_property_de_un_agente_de_su_agencia') from u;
reset role;

-- 18) [INVARIANTE] admin_a NO puede actualizar una property de la agencia B (cross-agency).
select pg_temp.act_as('00000000-0000-0000-0000-000000712111');
with u as (
  update public.properties set price = 1
   where id = '00000000-0000-0000-0000-000000712152'
   returning id
)
select is(count(*)::int, 0, 'admin_no_puede_actualizar_property_de_otra_agencia') from u;
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 19-20) Admin de agencia: NUNCA toca la fila de `agencies` [INVARIANTE]
-- ════════════════════════════════════════════════════════════════════════════

-- 19) admin_a no puede renombrar su propia agencia.
select pg_temp.act_as('00000000-0000-0000-0000-000000712111');
with u as (
  update public.agencies set name = 'Nombre Hackeado'
   where id = '00000000-0000-0000-0000-000000712100'
   returning id
)
select is(count(*)::int, 0, 'admin_no_puede_actualizar_la_fila_de_agencies') from u;
reset role;

-- 20) admin_a no puede eliminar su propia agencia (DELETE con RLS filtra, no lanza:
--     0 filas afectadas, misma fila sigue existiendo — no es throws_ok).
select pg_temp.act_as('00000000-0000-0000-0000-000000712111');
with d as (
  delete from public.agencies where id = '00000000-0000-0000-0000-000000712100'
  returning id
)
select is(count(*)::int, 0, 'admin_no_puede_eliminar_la_fila_de_agencies') from d;
reset role;
select ok(
  exists (select 1 from public.agencies where id = '00000000-0000-0000-0000-000000712100'),
  'la_agencia_a_sigue_existiendo_tras_el_intento_de_borrado_por_admin'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 22-23) Viewer: SELECT de properties/miembros de su agencia [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000712115');
select ok(
  exists (select 1 from public.properties where id = '00000000-0000-0000-0000-000000712151'),
  'viewer_ve_una_property_draft_de_su_propia_agencia'
);
select ok(
  exists (select 1 from public.agency_members where id = '00000000-0000-0000-0000-000000712132'),
  'viewer_ve_los_miembros_de_su_propia_agencia'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 24-27) Viewer: CERO escritura [INVARIANTE]
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000712115');

select throws_ok(
  $$ insert into public.agency_members (agency_id, user_id, member_role, status)
     values ('00000000-0000-0000-0000-000000712100', '00000000-0000-0000-0000-000000712116', 'agent', 'active') $$,
  '42501', null,
  'viewer_no_puede_insertar_agency_members'
);

select throws_ok(
  $$ insert into public.properties (owner_user_id, agency_id, property_type, operation_type, address, location, price, status)
     values ('00000000-0000-0000-0000-000000712115', '00000000-0000-0000-0000-000000712100', 'casa', 'sale',
             'Intento de viewer', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 100, 'draft') $$,
  '42501', null,
  'viewer_no_puede_insertar_properties'
);

with u as (
  update public.properties set price = 1
   where id = '00000000-0000-0000-0000-000000712151'
   returning id
)
select is(count(*)::int, 0, 'viewer_no_puede_actualizar_properties') from u;

with d as (
  delete from public.agency_members
   where id = '00000000-0000-0000-0000-000000712132'
   returning id
)
select is(count(*)::int, 0, 'viewer_no_puede_eliminar_agency_members') from d;

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 28-30) Agent: sin cambios respecto a hoy [INVARIANTE]
-- ════════════════════════════════════════════════════════════════════════════

-- 28) agent_a sigue pudiendo actualizar SU PROPIA property.
select pg_temp.act_as('00000000-0000-0000-0000-000000712112');
with u as (
  update public.properties set price = 13000
   where id = '00000000-0000-0000-0000-000000712150'
   returning id
)
select is(count(*)::int, 1, 'agent_actualiza_su_propia_property') from u;
reset role;

-- 29) agent_a NO puede actualizar la property de un colega (agent_a2) de la misma agencia.
select pg_temp.act_as('00000000-0000-0000-0000-000000712112');
with u as (
  update public.properties set price = 1
   where id = '00000000-0000-0000-0000-000000712151'
   returning id
)
select is(count(*)::int, 0, 'agent_no_puede_actualizar_property_de_un_colega') from u;
reset role;

-- 30) agent_a NO gestiona agency_members (no puede tocar la fila de viewer_a).
select pg_temp.act_as('00000000-0000-0000-0000-000000712112');
with u as (
  update public.agency_members set status = 'removed'
   where id = '00000000-0000-0000-0000-000000712135'
   returning id
)
select is(count(*)::int, 0, 'agent_no_puede_actualizar_agency_members') from u;
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 31) Owner: todo sobre su agencia — incluye properties de sus agentes [DELTA]
-- ════════════════════════════════════════════════════════════════════════════
-- HOY properties_update solo permite owner_user_id=self o is_admin() (super-admin
-- global): el owner de agencia NO puede editar la property de su agente. La
-- matriz PRD §4.10 ("owner=todo sobre su agencia") exige que esto cambie.
select pg_temp.act_as('00000000-0000-0000-0000-000000712110');
with u as (
  update public.properties set price = 2700000
   where id = '00000000-0000-0000-0000-000000712151'
   returning id
)
select is(count(*)::int, 1, 'owner_actualiza_property_de_un_agente_de_su_agencia') from u;
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 32-34) Aislamiento cross-agency [INVARIANTE]
-- ════════════════════════════════════════════════════════════════════════════

-- 32) admin_b (agencia B) no ve la fila de agent_a (agencia A).
select pg_temp.act_as('00000000-0000-0000-0000-000000712121');
select ok(
  not exists (select 1 from public.agency_members where id = '00000000-0000-0000-0000-000000712132'),
  'admin_de_agencia_b_no_ve_miembros_de_agencia_a'
);
reset role;

-- 33) viewer_a (agencia A) no ve la property de agent_b (agencia B).
select pg_temp.act_as('00000000-0000-0000-0000-000000712115');
select ok(
  not exists (select 1 from public.properties where id = '00000000-0000-0000-0000-000000712152'),
  'viewer_de_agencia_a_no_ve_properties_de_agencia_b'
);
reset role;

-- 34) admin_b no puede actualizar una property de la agencia A (simétrico al #18).
select pg_temp.act_as('00000000-0000-0000-0000-000000712121');
with u as (
  update public.properties set price = 1
   where id = '00000000-0000-0000-0000-000000712150'
   returning id
)
select is(count(*)::int, 0, 'admin_de_agencia_b_no_puede_actualizar_property_de_agencia_a') from u;
reset role;

select * from finish();
rollback;
