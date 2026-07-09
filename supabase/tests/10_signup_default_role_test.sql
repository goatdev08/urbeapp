-- Tests pgTAP — rol por defecto del registro libre (handle_new_user, migración 0011)
-- Ejecutar con: supabase test db   (instala pgtap y corre los archivos de supabase/tests/)
--
-- Bug: 20260707000001_signup_default_agent.sql redefinió handle_new_user() para
-- insertar role='agent' en TODO alta nueva de auth.users. El registro libre debe
-- crear buscadores (role='user'); solo redeem_invitation_atomic sube a 'agent'.
-- (a) documenta el RED esperado mientras esa migración siga vigente.
-- (b) es no-regresión: el flujo de invitación debe seguir intacto.

begin;
select plan(4);

-- ── Test (a): signup_default_role_is_user ────────────────────────────────────
-- Fixture propio, prefijo 0000000010xx para no colisionar con 03_redeem_invitation_test
-- (prefijo ...05xx) ni con el seed de demo.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001001', 'signup_libre@test.local');
-- El trigger AFTER INSERT handle_new_user() dispara automáticamente aquí.

select is(
  (select role::text from public.users where id = '00000000-0000-0000-0000-000000001001'),
  'user',
  'signup_default_role_is_user: registro libre crea buscador (role=user), no agente'
);

-- ── Test (b): invitation_flow_still_creates_agent (no-regresión) ────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001002', 'owner_invita@test.local'),  -- owner de la agencia
  ('00000000-0000-0000-0000-000000001003', 'agente_invitado@test.local'); -- agente que canjea

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000001004', 'Inmobiliaria Signup Test', 'inmo-signup-test',
   'active', '00000000-0000-0000-0000-000000001002');

insert into public.agency_invitation_tokens (id, agency_id, token, max_uses, current_uses, created_by_user_id) values
  ('00000000-0000-0000-0000-000000001005', '00000000-0000-0000-0000-000000001004',
   'hash_token_signup_test', 1, 0, '00000000-0000-0000-0000-000000001002');

select lives_ok(
  $$ select public.redeem_invitation_atomic(
       '00000000-0000-0000-0000-000000001005'::uuid,
       '00000000-0000-0000-0000-000000001003'::uuid) $$,
  'invitation_flow_still_creates_agent: redeem_invitation_atomic se ejecuta sin error'
);

select is(
  (select role::text from public.users where id = '00000000-0000-0000-0000-000000001003'),
  'agent',
  'invitation_flow_still_creates_agent: users.role del agente invitado queda en agent'
);

select ok(
  (select agency_id is not null from public.users where id = '00000000-0000-0000-0000-000000001003'),
  'invitation_flow_still_creates_agent: users.agency_id queda asignado a la agencia'
);

select * from finish();
rollback;
