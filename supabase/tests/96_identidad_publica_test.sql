-- Tests pgTAP — identidad pública del publicador para TODOS los roles (#250 + #254)
-- Ejecutar con: supabase test db (CLI global de brew, NUNCA npx supabase)
-- Corre como superusuario dentro de una transacción revertida.
--
-- ════════════════════════════════════════════════════════════════════════════
-- SUT
--   (a) vista public.agent_public_profiles — deja de filtrar por
--       role in ('agent','admin') y gana la columna derivada has_phone.
--   (b) private.seed_public_full_name(uuid) — siembra
--       user_preferences.full_name a partir de users.first_name/last_name.
--   (c) register_user_atomic / redeem_invitation_atomic — la llaman.
--
-- EL HUECO (smoke de producción #222, 2026-09-03)
--   Vladimir es role='admin' y dueño de las 8 propiedades activas. Para
--   cualquier no-admin su fila de public.users es INVISIBLE (users_select solo
--   abre la rama pública a role='agent' verificado), y el feed leía el teléfono
--   de users.phone y la identidad ANIDADA bajo el embed de users → ni nombre,
--   ni foto, ni botón de WhatsApp para los dos buscadores reales. Y Andrea
--   (role='user') salía como «Agente Urbea» porque la vista excluía su rol.
--
-- DECISIÓN (justificada en el PR): NO se abre users_select. Esa policy expone
-- la fila COMPLETA de users (date_of_birth, phone, email…) y abrirla a más
-- gente sería exponer mucho más de lo que la pantalla necesita (#116,
-- «registrar ≠ exponer»). La vista sigue siendo la ÚNICA puerta de la
-- identidad pública y ahora cubre a todos los roles + un has_phone DERIVADO:
-- el número crudo deja de viajar al cliente (lo resuelve la EF contact-agent).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(16);

-- ── Impersonación (mismo patrón que 02/08/41_*) ─────────────────────────────
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- SELECT protegido para el caso anon. Helper PROPIO y usado UNA sola vez:
-- el EXECUTE de un helper se comprueba al planificar y el plan se cachea, así
-- que reusar uno ya invocado por 'authenticated' haría pasar el assert de anon
-- en falso (hallazgo 203.1, memoria pgtap_execute_acl_plancache).
create or replace function pg_temp.try_select_view_as_anon()
returns boolean language plpgsql as $$
begin
  perform * from public.agent_public_profiles limit 1;
  return true;
exception when others then
  return false;
end $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0250-000000000001', 'publicador_admin@test.local'),  -- Vladimir en producción
  ('00000000-0000-0000-0250-000000000002', 'buscadora@test.local'),         -- Andrea: role='user', SIN leads
  ('00000000-0000-0000-0250-000000000003', 'agente_sin_tel@test.local'),    -- has_phone = false (NULL)
  ('00000000-0000-0000-0250-000000000004', 'sin_preferencias@test.local'),  -- no aparece en la vista
  ('00000000-0000-0000-0250-000000000005', 'registro_nuevo@test.local'),    -- register_user_atomic
  ('00000000-0000-0000-0250-000000000006', 'registro_con_nombre@test.local'), -- ya eligió su nombre
  ('00000000-0000-0000-0250-000000000007', 'backfill_prefs@test.local'),    -- fila vieja con full_name NULL
  ('00000000-0000-0000-0250-000000000008', 'sin_first_name@test.local'),    -- nada que sembrar
  ('00000000-0000-0000-0250-000000000009', 'owner_agencia@test.local'),     -- owner para el token de canje
  ('00000000-0000-0000-0250-00000000000a', 'canjea_invitacion@test.local'); -- redeem_invitation_atomic

update public.users
   set role = 'admin', is_verified_agent = true, phone = '+523311122233',
       first_name = 'Vladimir', last_name = 'YEH'
 where id = '00000000-0000-0000-0250-000000000001';

update public.users
   set phone = '+523344455566', first_name = 'Andrea', last_name = 'Landeros'
 where id = '00000000-0000-0000-0250-000000000002';  -- conserva role='user'

update public.users set role = 'agent', is_verified_agent = true, phone = null
 where id = '00000000-0000-0000-0250-000000000003';
-- ...004 se queda con role='agent' y SIN fila en user_preferences: es el caso
-- fail-open que el cliente maneja (sin identidad → iniciales de placeholder).
update public.users set role = 'agent', is_verified_agent = true, phone = '+523322233344'
 where id = '00000000-0000-0000-0250-000000000004';

-- Perfiles completos para las dos RPCs (§5.1 exige los 4 campos).
update public.users
   set phone = '+525511110005', date_of_birth = '1990-01-01', state_id = '14',
       municipality_id = '14039', first_name = 'Rodrigo', last_name = 'Nuevo'
 where id = '00000000-0000-0000-0250-000000000005';
update public.users
   set phone = '+525511110006', date_of_birth = '1990-01-01', state_id = '14',
       municipality_id = '14039', first_name = 'Ignorado', last_name = 'Porelrpc'
 where id = '00000000-0000-0000-0250-000000000006';
update public.users
   set first_name = 'Vieja', last_name = 'Fila'
 where id = '00000000-0000-0000-0250-000000000007';
update public.users set first_name = null, last_name = null
 where id = '00000000-0000-0000-0250-000000000008';
update public.users
   set phone = '+525511110010', date_of_birth = '1990-01-01', state_id = '14',
       municipality_id = '14039', first_name = 'Cinthia', last_name = 'Canje'
 where id = '00000000-0000-0000-0250-00000000000a';

insert into public.user_preferences (user_id, full_name, profile_photo_url, budget_min) values
  ('00000000-0000-0000-0250-000000000001', 'Vladimir YEH', 'avatars/vlad.jpg', null),
  ('00000000-0000-0000-0250-000000000002', 'Andrea Landeros', 'avatars/andrea.jpg', 8000),
  ('00000000-0000-0000-0250-000000000003', 'Agente Sin Tel', null, null),
  ('00000000-0000-0000-0250-000000000006', 'Nombre Que Yo Elegí', null, null),
  ('00000000-0000-0000-0250-000000000007', null, null, 12000),
  ('00000000-0000-0000-0250-000000000008', null, null, null);

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0250-0000000000e1', 'Inmobiliaria 250', 'inmo-250', 'active',
   '00000000-0000-0000-0250-000000000009');
insert into public.agency_invitation_tokens (id, agency_id, token, max_uses, current_uses, created_by_user_id) values
  ('00000000-0000-0000-0250-0000000000a1', '00000000-0000-0000-0250-0000000000e1',
   'hash_token_250', 1, 0, '00000000-0000-0000-0250-000000000009');

-- ════════════════════════════════════════════════════════════════════════════
-- (a) La vista: identidad pública de quien publica, sea cual sea su rol
-- ════════════════════════════════════════════════════════════════════════════

-- 1) El caso exacto del smoke: buscadora role='user' SIN leads ve al admin.
select pg_temp.act_as('00000000-0000-0000-0250-000000000002');
select results_eq(
  $$ select full_name, profile_photo_url, has_phone from public.agent_public_profiles
      where user_id = '00000000-0000-0000-0250-000000000001' $$,
  $$ values ('Vladimir YEH'::text, 'avatars/vlad.jpg'::text, true) $$,
  '1) un role=user sin leads lee nombre, foto y has_phone del PUBLICADOR admin'
);

-- 2) #254: la identidad de un role='user' también es pública (la elige en «Editar perfil»).
select pg_temp.act_as('00000000-0000-0000-0250-000000000001');
select results_eq(
  $$ select full_name, profile_photo_url from public.agent_public_profiles
      where user_id = '00000000-0000-0000-0250-000000000002' $$,
  $$ values ('Andrea Landeros'::text, 'avatars/andrea.jpg'::text) $$,
  '2) la identidad de un role=user aparece en la vista (#254)'
);

-- 3) has_phone = false cuando users.phone es NULL.
select is(
  (select has_phone from public.agent_public_profiles
    where user_id = '00000000-0000-0000-0250-000000000003'),
  false,
  '3) has_phone es false cuando el publicador no tiene teléfono'
);

-- 4) Fail-open: sin fila en user_preferences no hay fila en la vista (el
--    cliente cae a las iniciales de placeholder, la propiedad sigue en el feed).
select is(
  (select count(*) from public.agent_public_profiles
    where user_id = '00000000-0000-0000-0250-000000000004')::int,
  0,
  '4) un publicador sin fila en user_preferences no aparece en la vista (fail-open del cliente)'
);

-- 5) Privacidad (#116): la vista NO gana el teléfono crudo ni la fecha de nacimiento.
reset role;
select columns_are(
  'public', 'agent_public_profiles',
  array['user_id', 'full_name', 'profile_photo_url', 'has_phone'],
  '5) la vista expone EXACTAMENTE user_id/full_name/profile_photo_url/has_phone — sin phone crudo, sin date_of_birth, sin presupuesto'
);

-- 6) La RLS de users NO se abrió: la fila del admin sigue invisible para la buscadora.
select pg_temp.act_as('00000000-0000-0000-0250-000000000002');
select is(
  (select count(*) from public.users
    where id = '00000000-0000-0000-0250-000000000001')::int,
  0,
  '6) users_select sigue cerrada: el role=user NO lee la fila de users del admin'
);

-- 7) La tabla user_preferences ajena sigue bloqueada (la vista no abre la tabla).
select is(
  (select count(*) from public.user_preferences
    where user_id = '00000000-0000-0000-0250-000000000001')::int,
  0,
  '7) user_preferences ajeno sigue devolviendo 0 filas — la vista no abre la tabla'
);

-- 8) anon sigue fuera (grant solo a authenticated).
select pg_temp.act_as('00000000-0000-0000-0250-000000000002', 'anon');
select is(
  pg_temp.try_select_view_as_anon(),
  false,
  '8) el rol anon no puede consultar la vista (grant solo a authenticated)'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- (b) private.seed_public_full_name — siembra y backfill
-- ════════════════════════════════════════════════════════════════════════════

-- 9) El helper vive en el schema private (no expuesto por PostgREST).
select has_function(
  'private', 'seed_public_full_name', array['uuid'],
  '9) private.seed_public_full_name(uuid) existe'
);

-- 10) Backfill: fila vieja con full_name NULL y first_name presente → se llena.
select private.seed_public_full_name('00000000-0000-0000-0250-000000000007');
select is(
  (select full_name from public.user_preferences
    where user_id = '00000000-0000-0000-0250-000000000007'),
  'Vieja Fila',
  '10) el helper llena una fila existente con full_name NULL (backfill)'
);

-- 11) El backfill NO destruye el resto de la fila (budget_min intacto).
select is(
  (select budget_min from public.user_preferences
    where user_id = '00000000-0000-0000-0250-000000000007'),
  12000::numeric,
  '11) el backfill no toca las demás columnas de user_preferences'
);

-- 12) Sin first_name no se inventa nombre ni se ensucia la fila.
select private.seed_public_full_name('00000000-0000-0000-0250-000000000008');
select is(
  (select full_name from public.user_preferences
    where user_id = '00000000-0000-0000-0250-000000000008'),
  null,
  '12) sin first_name el helper deja full_name en NULL (no inventa nombre)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- (c) Las dos puertas de alta llaman al helper
-- ════════════════════════════════════════════════════════════════════════════

-- 13) register_user_atomic siembra el nombre público (antes: NULL para siempre).
select public.register_user_atomic('00000000-0000-0000-0250-000000000005'::uuid);
select is(
  (select full_name from public.user_preferences
    where user_id = '00000000-0000-0000-0250-000000000005'),
  'Rodrigo Nuevo',
  '13) register_user_atomic crea user_preferences.full_name con el nombre del registro'
);

-- 14) Y NUNCA pisa el nombre que el usuario ya eligió en «Editar perfil».
select public.register_user_atomic('00000000-0000-0000-0250-000000000006'::uuid);
select is(
  (select full_name from public.user_preferences
    where user_id = '00000000-0000-0000-0250-000000000006'),
  'Nombre Que Yo Elegí',
  '14) la siembra NO pisa un full_name ya elegido por el usuario'
);

-- 15) Idempotencia: repetir la siembra no duplica la fila 1:1 de preferencias.
select private.seed_public_full_name('00000000-0000-0000-0250-000000000005');
select is(
  (select count(*) from public.user_preferences
    where user_id = '00000000-0000-0000-0250-000000000005')::int,
  1,
  '15) repetir la siembra no duplica la fila de user_preferences'
);

-- 16) redeem_invitation_atomic (alta por invitación) también siembra el nombre.
select public.redeem_invitation_atomic(
  '00000000-0000-0000-0250-0000000000a1'::uuid,
  '00000000-0000-0000-0250-00000000000a'::uuid);
select is(
  (select full_name from public.user_preferences
    where user_id = '00000000-0000-0000-0250-00000000000a'),
  'Cinthia Canje',
  '16) redeem_invitation_atomic crea user_preferences.full_name del agente invitado'
);

select * from finish();
rollback;
