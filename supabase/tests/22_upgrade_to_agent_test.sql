-- Tests pgTAP — RPC upgrade_to_agent_atomic (Camino A del wizard de upgrade, subtarea 71.3)
-- Ejecutar con: supabase test db
-- Corre como superusuario dentro de una transacción revertida (no persiste).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SUT (aún NO existe — se crea en la migración GREEN, fuera de esta subtarea de tests):
-- ════════════════════════════════════════════════════════════════════════════
-- public.upgrade_to_agent_atomic(p_user_id uuid, p_token text)
--   returns table (agency_id uuid, agency_member_id uuid)
--   language plpgsql, SECURITY DEFINER, set search_path fijo.
--
-- Contrato elegido en esta fase RED (decisión del subagente test-author — PLAN de
-- Abraham 2026-08-05 fija la firma `(p_user_id uuid, p_token text)`, ESPEJO de
-- redeem_invitation_atomic §0013 pero para un usuario YA EXISTENTE que sube de
-- role='user' a role='agent'; NO se refactoriza redeem_invitation_atomic):
--   • p_token es el CÓDIGO EN CLARO (mismo valor que recibe hoy la EF validate-invitation,
--     ver supabase/functions/_shared/invitation.ts) — la RPC lo hashea internamente con
--     extensions.digest(p_token, 'sha256') + encode(...,'hex') (mismo algoritmo que
--     _shared/crypto.ts:sha256_hex) para buscarlo por hash en
--     agency_invitation_tokens.token. Esto hace que Camino A sea un ESPEJO del flujo
--     COMPLETO validar+canjear en una sola transacción (a diferencia de
--     redeem_invitation_atomic, que ya recibe p_token_id resuelto porque la EF de
--     registro necesitaba crear el auth.user ENTRE validar y canjear — aquí el usuario
--     ya existe, no hay paso intermedio, así que no hace falta partirlo en dos).
--   • Errores (SQLSTATE P0001), uno por barrera, en el mismo espíritu que
--     redeem_invitation_atomic / validate_invitation_token:
--       TOKEN_NOT_FOUND, TOKEN_REVOKED, TOKEN_EXPIRED, TOKEN_MAX_USES_REACHED,
--       AGENCY_INACTIVE, ALREADY_AGENT (el usuario ya es 'agent' o 'admin'),
--       ALREADY_ACTIVE_MEMBER (barrera del índice único agency_members_one_active_per_user,
--       ej. estado inconsistente: ya tiene membresía activa pero users.role aún no se
--       había denormalizado), USER_NOT_FOUND.
--   • Efectos (happy path): consumo atómico de current_uses (mismo UPDATE condicional
--     que redeem_invitation_atomic — barrera anti-carrera), INSERT en agency_members
--     (member_role='agent', status='active', invitation_token_id), denormalización
--     users.role='agent' + users.agency_id. A diferencia de redeem_invitation_atomic,
--     NO inserta filas en user_consents — el usuario YA aceptó términos/privacidad al
--     registrarse (register_user_atomic, migración 20260729000001); volver a pedir
--     consentimiento en el upgrade no aplica aquí (fuera del alcance de esta subtarea;
--     si el PRD lo exige más adelante es un cambio de contrato explícito, no implícito).
--   • Grants: solo service_role (la llama la EF nueva `upgrade-to-agent`, fuera del
--     alcance pgTAP de esta subtarea — ver nota de scope en la bitácora de Taskmaster).
--   • Atomicidad: garantizada por Postgres (una función PL/pgSQL es un solo statement;
--     si RAISE EXCEPTION escapa sin ser atrapada, TODOS los efectos de la invocación se
--     revierten) — se verifica explícitamente para blindar contra un futuro cambio que
--     rompa esto (p.ej. dblink / autonomous transaction).
--
-- Patrón de impersonación: pg_temp.act_as (igual que 02/16/17/18/21_*).
-- No hace falta el wrapper "__function_missing__": lives_ok/throws_ok de pgTAP ya
-- atrapan la excepción 42883 (función inexistente) internamente sin abortar la
-- transacción — mismo patrón ya probado en 19_register_user_atomic_test.sql y
-- 05_admin_create_agency_test.sql (tests #1-3, #1 respectivamente).

begin;
select plan(29);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000713110', 'owner_upgrade@test.local'),          -- creador de las agencias
  ('00000000-0000-0000-0000-000000713111', 'u_happy@test.local'),                -- happy path
  ('00000000-0000-0000-0000-000000713112', 'u_notfound@test.local'),             -- TOKEN_NOT_FOUND
  ('00000000-0000-0000-0000-000000713113', 'u_expired@test.local'),              -- TOKEN_EXPIRED
  ('00000000-0000-0000-0000-000000713114', 'u_maxed@test.local'),                -- TOKEN_MAX_USES_REACHED
  ('00000000-0000-0000-0000-000000713115', 'u_revoked@test.local'),              -- TOKEN_REVOKED
  ('00000000-0000-0000-0000-000000713116', 'u_inactive_agency@test.local'),      -- AGENCY_INACTIVE
  ('00000000-0000-0000-0000-000000713117', 'u_already_agent@test.local'),        -- ALREADY_AGENT (agent)
  ('00000000-0000-0000-0000-000000713118', 'u_already_admin@test.local'),        -- ALREADY_AGENT (admin)
  ('00000000-0000-0000-0000-000000713119', 'u_inconsistent@test.local');         -- ALREADY_ACTIVE_MEMBER
  -- '...713199' NUNCA se inserta: p_user_id inexistente.

update public.users set role = 'agent' where id = '00000000-0000-0000-0000-000000713117';
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000713118';

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000713100', 'Inmobiliaria Upgrade Activa', 'inmo-upgrade-activa', 'active',
   '00000000-0000-0000-0000-000000713110'),
  ('00000000-0000-0000-0000-000000713101', 'Inmobiliaria Upgrade Pendiente', 'inmo-upgrade-pendiente', 'pending_approval',
   '00000000-0000-0000-0000-000000713110');

-- 713119 ya tiene una membresía ACTIVA (estado inconsistente a propósito: users.role
-- se quedó en 'user' — simula que la denormalización nunca corrió — para forzar la
-- barrera del índice único agency_members_one_active_per_user en vez de la barrera
-- ALREADY_AGENT basada en users.role).
insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000713100', '00000000-0000-0000-0000-000000713119', 'agent', 'active');

-- Tokens (token = hash sha256-hex del código en claro correspondiente).
insert into public.agency_invitation_tokens
  (id, agency_id, token, max_uses, current_uses, expires_at, revoked_at, created_by_user_id) values
  ('00000000-0000-0000-0000-000000713200', '00000000-0000-0000-0000-000000713100',
   encode(extensions.digest('CODE-HAPPY-001', 'sha256'), 'hex'), 5, 0, null, null,
   '00000000-0000-0000-0000-000000713110'),
  ('00000000-0000-0000-0000-000000713201', '00000000-0000-0000-0000-000000713100',
   encode(extensions.digest('CODE-EXPIRED-001', 'sha256'), 'hex'), null, 0,
   now() - interval '1 day', null, '00000000-0000-0000-0000-000000713110'),
  ('00000000-0000-0000-0000-000000713202', '00000000-0000-0000-0000-000000713100',
   encode(extensions.digest('CODE-MAXED-001', 'sha256'), 'hex'), 1, 1, null, null,
   '00000000-0000-0000-0000-000000713110'),
  ('00000000-0000-0000-0000-000000713203', '00000000-0000-0000-0000-000000713100',
   encode(extensions.digest('CODE-REVOKED-001', 'sha256'), 'hex'), null, 0, null, now(),
   '00000000-0000-0000-0000-000000713110'),
  ('00000000-0000-0000-0000-000000713204', '00000000-0000-0000-0000-000000713101',
   encode(extensions.digest('CODE-INACTIVE-001', 'sha256'), 'hex'), null, 0, null, null,
   '00000000-0000-0000-0000-000000713110'),
  ('00000000-0000-0000-0000-000000713205', '00000000-0000-0000-0000-000000713100',
   encode(extensions.digest('CODE-ALREADY-AGENT-001', 'sha256'), 'hex'), null, 0, null, null,
   '00000000-0000-0000-0000-000000713110'),
  ('00000000-0000-0000-0000-000000713206', '00000000-0000-0000-0000-000000713100',
   encode(extensions.digest('CODE-ALREADY-ADMIN-001', 'sha256'), 'hex'), null, 0, null, null,
   '00000000-0000-0000-0000-000000713110'),
  ('00000000-0000-0000-0000-000000713207', '00000000-0000-0000-0000-000000713100',
   encode(extensions.digest('CODE-INCONSISTENT-001', 'sha256'), 'hex'), null, 0, null, null,
   '00000000-0000-0000-0000-000000713110'),
  ('00000000-0000-0000-0000-000000713208', '00000000-0000-0000-0000-000000713100',
   encode(extensions.digest('CODE-NOUSER-001', 'sha256'), 'hex'), null, 0, null, null,
   '00000000-0000-0000-0000-000000713110');

-- ════════════════════════════════════════════════════════════════════════════
-- 1-2) La función existe con la firma esperada, SECURITY DEFINER
-- ════════════════════════════════════════════════════════════════════════════

select has_function(
  'public',
  'upgrade_to_agent_atomic',
  ARRAY['uuid', 'text'],
  'upgrade_to_agent_atomic(uuid, text) debe existir en el schema public'
);
select is(
  (select prosecdef from pg_proc join pg_namespace ns on pg_proc.pronamespace = ns.oid
    where ns.nspname = 'public' and pg_proc.proname = 'upgrade_to_agent_atomic' limit 1),
  true,
  'upgrade_to_agent_atomic debe ser SECURITY DEFINER'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3-4) Grants defensivos: solo service_role puede ejecutar
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select public.upgrade_to_agent_atomic('00000000-0000-0000-0000-000000713111'::uuid, 'CODE-HAPPY-001') $$,
  '42501', null,
  'anon no puede ejecutar upgrade_to_agent_atomic'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000713111', 'authenticated');
select throws_ok(
  $$ select public.upgrade_to_agent_atomic('00000000-0000-0000-0000-000000713111'::uuid, 'CODE-HAPPY-001') $$,
  '42501', null,
  'authenticated no puede ejecutar upgrade_to_agent_atomic (ni siquiera para su propio user_id)'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5-11) Happy path (ejecutado como service_role): token válido + user role='user'
--       -> role sube a agent, agency_id seteado, agency_members creado, token
--       consumido, SIN consentimientos nuevos
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select lives_ok(
  $$ select public.upgrade_to_agent_atomic('00000000-0000-0000-0000-000000713111'::uuid, 'CODE-HAPPY-001') $$,
  'upgrade_to_agent_atomic: token válido + usuario role=user se ejecuta sin error'
);
reset role;

select is(
  (select count(*)::int from public.agency_members
    where user_id = '00000000-0000-0000-0000-000000713111'
      and agency_id = '00000000-0000-0000-0000-000000713100'
      and member_role = 'agent' and status = 'active'
      and invitation_token_id = '00000000-0000-0000-0000-000000713200'),
  1,
  'agency_members: 1 membresía agente activa ligada al token consumido'
);
select is(
  (select role::text from public.users where id = '00000000-0000-0000-0000-000000713111'),
  'agent',
  'users.role denormalizado a agent tras el upgrade'
);
select is(
  (select agency_id from public.users where id = '00000000-0000-0000-0000-000000713111'),
  '00000000-0000-0000-0000-000000713100'::uuid,
  'users.agency_id denormalizado a la agencia del token'
);
select is(
  (select current_uses from public.agency_invitation_tokens
    where id = '00000000-0000-0000-0000-000000713200'),
  1,
  'la invitación queda marcada como canjeada: current_uses pasa de 0 a 1'
);
select is(
  (select count(*)::int from public.user_consents where user_id = '00000000-0000-0000-0000-000000713111'),
  0,
  'upgrade_to_agent_atomic NO inserta consentimientos (el usuario ya consintió al registrarse)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 12-13) Token inexistente/inválido -> TOKEN_NOT_FOUND, cero cambios
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.upgrade_to_agent_atomic('00000000-0000-0000-0000-000000713112'::uuid, 'CODIGO-QUE-NUNCA-EXISTIO') $$,
  'P0001', 'TOKEN_NOT_FOUND',
  'código sin match de hash -> P0001 TOKEN_NOT_FOUND'
);
reset role;

select is(
  (select role::text from public.users where id = '00000000-0000-0000-0000-000000713112'),
  'user',
  'atomicidad: users.role sigue user tras TOKEN_NOT_FOUND'
);
select is(
  (select count(*)::int from public.agency_members where user_id = '00000000-0000-0000-0000-000000713112'),
  0,
  'atomicidad: cero filas de agency_members tras TOKEN_NOT_FOUND'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 14-15) Token expirado -> TOKEN_EXPIRED, cero cambios
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.upgrade_to_agent_atomic('00000000-0000-0000-0000-000000713113'::uuid, 'CODE-EXPIRED-001') $$,
  'P0001', 'TOKEN_EXPIRED',
  'token con expires_at en el pasado -> P0001 TOKEN_EXPIRED'
);
reset role;

select is(
  (select count(*)::int from public.agency_members where user_id = '00000000-0000-0000-0000-000000713113'),
  0,
  'atomicidad: cero filas de agency_members tras TOKEN_EXPIRED'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 16-17) Token ya agotado (current_uses = max_uses) -> TOKEN_MAX_USES_REACHED
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.upgrade_to_agent_atomic('00000000-0000-0000-0000-000000713114'::uuid, 'CODE-MAXED-001') $$,
  'P0001', 'TOKEN_MAX_USES_REACHED',
  'token con current_uses = max_uses -> P0001 TOKEN_MAX_USES_REACHED'
);
reset role;

select is(
  (select current_uses from public.agency_invitation_tokens where id = '00000000-0000-0000-0000-000000713202'),
  1,
  'atomicidad: current_uses del token agotado NO se incrementa más allá de max_uses'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 18) Token revocado -> TOKEN_REVOKED
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.upgrade_to_agent_atomic('00000000-0000-0000-0000-000000713115'::uuid, 'CODE-REVOKED-001') $$,
  'P0001', 'TOKEN_REVOKED',
  'token con revoked_at seteado -> P0001 TOKEN_REVOKED'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 19) Agencia inactiva (status != active) -> AGENCY_INACTIVE
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.upgrade_to_agent_atomic('00000000-0000-0000-0000-000000713116'::uuid, 'CODE-INACTIVE-001') $$,
  'P0001', 'AGENCY_INACTIVE',
  'token de una agencia pending_approval -> P0001 AGENCY_INACTIVE'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 20-22) Usuario ya es agent -> ALREADY_AGENT, sin duplicar agency_members,
--        sin consumir el token
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.upgrade_to_agent_atomic('00000000-0000-0000-0000-000000713117'::uuid, 'CODE-ALREADY-AGENT-001') $$,
  'P0001', 'ALREADY_AGENT',
  'usuario con role=agent -> P0001 ALREADY_AGENT'
);
reset role;

select is(
  (select count(*)::int from public.agency_members where user_id = '00000000-0000-0000-0000-000000713117'),
  0,
  'atomicidad: no se crea agency_members para un usuario ya agent (ALREADY_AGENT)'
);
select is(
  (select current_uses from public.agency_invitation_tokens where id = '00000000-0000-0000-0000-000000713205'),
  0,
  'atomicidad: el token de un intento ALREADY_AGENT no se consume'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 23-24) Usuario ya es admin -> también ALREADY_AGENT (no tiene sentido "subir"
--        a un rol inferior), sin consumir el token
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.upgrade_to_agent_atomic('00000000-0000-0000-0000-000000713118'::uuid, 'CODE-ALREADY-ADMIN-001') $$,
  'P0001', 'ALREADY_AGENT',
  'usuario con role=admin -> P0001 ALREADY_AGENT (mismo código que agent)'
);
reset role;

select is(
  (select current_uses from public.agency_invitation_tokens where id = '00000000-0000-0000-0000-000000713206'),
  0,
  'atomicidad: el token de un intento ALREADY_AGENT (admin) no se consume'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 25-26) p_user_id inexistente -> USER_NOT_FOUND, token no consumido
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.upgrade_to_agent_atomic('00000000-0000-0000-0000-000000713199'::uuid, 'CODE-NOUSER-001') $$,
  'P0001', 'USER_NOT_FOUND',
  'p_user_id inexistente (ni en auth.users ni en public.users) -> P0001 USER_NOT_FOUND'
);
reset role;

select is(
  (select current_uses from public.agency_invitation_tokens where id = '00000000-0000-0000-0000-000000713208'),
  0,
  'atomicidad: el token de un intento USER_NOT_FOUND no se consume'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 27-29) Barrera de doble membresía (índice único agency_members_one_active_per_user):
--        usuario con membresía activa preexistente aunque users.role diga 'user'
--        -> ALREADY_ACTIVE_MEMBER (unique_violation), atómico
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.upgrade_to_agent_atomic('00000000-0000-0000-0000-000000713119'::uuid, 'CODE-INCONSISTENT-001') $$,
  'P0001', 'ALREADY_ACTIVE_MEMBER',
  'usuario con membresía activa preexistente (aunque role=user) -> P0001 ALREADY_ACTIVE_MEMBER'
);
reset role;

select is(
  (select current_uses from public.agency_invitation_tokens where id = '00000000-0000-0000-0000-000000713207'),
  0,
  'atomicidad: el token de un intento ALREADY_ACTIVE_MEMBER no se consume'
);
select is(
  (select role::text from public.users where id = '00000000-0000-0000-0000-000000713119'),
  'user',
  'atomicidad: users.role NO se denormaliza a agent cuando falla por ALREADY_ACTIVE_MEMBER'
);

select * from finish();
rollback;
