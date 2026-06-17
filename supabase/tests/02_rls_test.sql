-- Tests pgTAP — Row Level Security (Urbea MVP)
-- Ejecutar con: supabase test db
-- Patrón: se crean fixtures como superusuario y luego se impersona cada rol con
--   set local role <anon|authenticated> + request.jwt.claims (sub = id del usuario).
-- Recomendado para CI: instalar supabase_test_helpers (tests.authenticate_as) si se desea
-- una API más robusta de impersonación. Aquí se usa el patrón nativo.

begin;
select plan(15);

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'b@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'g1@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'g2@test.local'),
  ('00000000-0000-0000-0000-0000000000b3', 'g3@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'o@test.local'),
  ('00000000-0000-0000-0000-0000000000d1', 'ad@test.local');

update public.users set role = 'agent', is_verified_agent = true
  where id in ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2',
               '00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000c1');
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-0000000000d1';

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-0000000000e1', 'Inmobiliaria X', 'inmo-x', 'active', '00000000-0000-0000-0000-0000000000c1');
insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', 'owner', 'active'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 'agent', 'active'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b2', 'agent', 'active');
update public.users set agency_id = '00000000-0000-0000-0000-0000000000e1'
  where id in ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2');

insert into public.properties (id, owner_user_id, agency_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1',
   'departamento', 'rent', 'Av. Chapultepec 100', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 12000, 'active'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1',
   'casa', 'sale', 'Calle Falsa 123', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.36, 20.68), 4326)::extensions.geography, 2500000, 'draft'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000b3', null,
   'local', 'rent', 'Indep 5', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.34, 20.66), 4326)::extensions.geography, 8000, 'active'),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000b3', null,
   'casa', 'sale', 'Indep draft', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.33, 20.65), 4326)::extensions.geography, 999000, 'draft');

insert into public.property_videos (property_id, status, position) values
  ('00000000-0000-0000-0000-0000000000f1', 'ready', 1),
  ('00000000-0000-0000-0000-0000000000f1', 'processing', 2);

insert into public.leads (agent_id, user_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a1');

insert into public.user_preferences (user_id, location_radius_km) values
  ('00000000-0000-0000-0000-0000000000a1', 5);
insert into public.notifications (user_id, type, title) values
  ('00000000-0000-0000-0000-0000000000a1', 'new_lead', 'Tienes un nuevo contacto');

-- Helper de impersonación inline
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ── Asserts ─────────────────────────────────────────────────────────────────

-- 1) El buscador A NO ve ningún lead (los leads son del agente).
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select is((select count(*) from public.leads)::int, 0, 'A (buscador) no ve ningún lead');
reset role;

-- 2) El agente G1 ve solo su lead.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.leads)::int, 1, 'G1 ve solo su lead');
-- 3) ...y no ve leads de G2.
select is((select count(*) from public.leads where agent_id = '00000000-0000-0000-0000-0000000000b2')::int, 0, 'G1 no ve leads de G2');
reset role;

-- 4) El owner O ve los leads de sus agentes (G1+G2)=2, pero no los del independiente G3.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select is((select count(*) from public.leads)::int, 2, 'Owner O ve leads de sus agentes (G1+G2)');
select is((select count(*) from public.leads where agent_id = '00000000-0000-0000-0000-0000000000b3')::int, 0, 'Owner O no ve leads del agente independiente G3');
reset role;

-- 5) El admin ve todos los leads.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select is((select count(*) from public.leads)::int, 3, 'Admin ve todos los leads');
reset role;

-- 6) Público (anon) ve solo propiedades activas (2), no el draft.
select pg_temp.act_as(null, 'anon');
select is((select count(*) from public.properties)::int, 2, 'anon ve solo propiedades activas');
-- 7) ...y ninguna en draft.
select is((select count(*) from public.properties where status = 'draft')::int, 0, 'anon no ve drafts');
-- 10) anon ve solo videos ready de propiedades activas (1 de 2).
select is((select count(*) from public.property_videos)::int, 1, 'anon ve solo videos ready de propiedades activas');
reset role;

-- 8) El dueño G1 ve su propia propiedad en draft.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.properties where id = '00000000-0000-0000-0000-0000000000f2')::int, 1, 'G1 ve su propio draft');
reset role;

-- 9) El owner O ve las propiedades de su agente G1 (incluido draft = 2), no las de G3.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select is((select count(*) from public.properties where owner_user_id = '00000000-0000-0000-0000-0000000000b1')::int, 2, 'Owner O ve propiedades de su agente G1 (incl. draft)');
select is((select count(*) from public.properties where owner_user_id = '00000000-0000-0000-0000-0000000000b3' and status = 'draft')::int, 0, 'Owner O no ve el draft (privado) del agente independiente G3');
reset role;

-- 11) B no ve las preferencias de A.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
select is((select count(*) from public.user_preferences)::int, 0, 'B no ve preferencias de A');
-- 12) B no puede actualizar el perfil de A (0 filas afectadas por RLS).
select is(
  (with u as (update public.users set bio = 'hack' where id = '00000000-0000-0000-0000-0000000000a1' returning 1)
   select count(*)::int from u),
  0, 'B no puede actualizar el perfil de A');
-- 15) B no ve las notificaciones de A.
select is((select count(*) from public.notifications)::int, 0, 'B no ve notificaciones de A');
reset role;

-- 13) Un usuario autenticado NO puede leer events_raw (sin grant ni policy).
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select 1 from public.events_raw $$, null, 'authenticated no puede leer events_raw');
-- 14) Un no-admin NO puede insertar en admin_actions.
select throws_ok(
  $$ insert into public.admin_actions (admin_id, action_type, entity_type, entity_id)
     values ('00000000-0000-0000-0000-0000000000a1', 'x', 'user', '00000000-0000-0000-0000-0000000000a2') $$,
  null, 'no-admin no puede insertar en admin_actions');
reset role;

select * from finish();
rollback;
