-- Tests pgTAP — RPC atómica de canje de invitación (redeem_invitation_atomic, migración 0013)
-- Ejecutar con: supabase test db   (instala pgtap y corre los archivos de supabase/tests/)
-- Corre como superusuario; validamos la transacción atómica completa y sus barreras.

begin;
select plan(12);

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005c1', 'owner@test.local'),  -- owner de la agencia
  ('00000000-0000-0000-0000-0000000005b1', 'nuevo1@test.local'), -- agente que canjea (happy path)
  ('00000000-0000-0000-0000-0000000005b2', 'nuevo2@test.local'), -- agente para test de agotamiento
  ('00000000-0000-0000-0000-0000000005b3', 'yamiembro@test.local'); -- ya tiene membresía activa

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-0000000005e1', 'Inmobiliaria Z', 'inmo-z', 'active',
   '00000000-0000-0000-0000-0000000005c1');

-- Token con un solo uso (happy path + agotamiento).
insert into public.agency_invitation_tokens (id, agency_id, token, max_uses, current_uses, created_by_user_id) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005e1',
   'hash_token_un_uso', 1, 0, '00000000-0000-0000-0000-0000000005c1');
-- Token ilimitado (test de doble membresía).
insert into public.agency_invitation_tokens (id, agency_id, token, max_uses, current_uses, created_by_user_id) values
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000005e1',
   'hash_token_ilimitado', null, 0, '00000000-0000-0000-0000-0000000005c1');

-- b3 ya pertenece activamente a la agencia.
insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000005b3', 'agent', 'active');

-- ── Asserts ─────────────────────────────────────────────────────────────────

-- 1) Happy path: el canje se ejecuta sin error (y aplica sus efectos para los asserts siguientes).
select lives_ok(
  $$ select public.redeem_invitation_atomic(
       '00000000-0000-0000-0000-0000000005a1'::uuid,
       '00000000-0000-0000-0000-0000000005b1'::uuid) $$,
  'redeem_invitation_atomic: canje válido se ejecuta sin error'
);

-- 2) Token consumido atómicamente: current_uses pasa de 0 a 1.
select is(
  (select current_uses from public.agency_invitation_tokens
    where id = '00000000-0000-0000-0000-0000000005a1'),
  1,
  'current_uses del token incrementa a 1'
);

-- 3) Membresía creada como agente activo, ligada al token.
select is(
  (select count(*)::int from public.agency_members
    where user_id = '00000000-0000-0000-0000-0000000005b1'
      and agency_id = '00000000-0000-0000-0000-0000000005e1'
      and member_role = 'agent' and status = 'active'
      and invitation_token_id = '00000000-0000-0000-0000-0000000005a1'),
  1,
  'agency_members: 1 membresía agente activa ligada al token'
);

-- 4) Denormalización: users.role = 'agent'.
select is(
  (select role::text from public.users where id = '00000000-0000-0000-0000-0000000005b1'),
  'agent',
  'users.role denormalizado a agent'
);

-- 5) Denormalización: users.agency_id = agencia del token.
select is(
  (select agency_id from public.users where id = '00000000-0000-0000-0000-0000000005b1'),
  '00000000-0000-0000-0000-0000000005e1'::uuid,
  'users.agency_id denormalizado a la agencia del token'
);

-- 6) Se registran exactamente 4 consentimientos.
select is(
  (select count(*)::int from public.user_consents
    where user_id = '00000000-0000-0000-0000-0000000005b1'),
  4,
  'user_consents: 4 registros (terms, privacy, age, whatsapp)'
);

-- 7) Consentimiento 'terms' apunta a la versión vigente de términos.
select is(
  (select terms_version_id from public.user_consents
    where user_id = '00000000-0000-0000-0000-0000000005b1' and consent_type = 'terms'),
  (select id from public.terms_versions where doc_type = 'terms' and is_current),
  'consent terms → terms_version_id vigente'
);

-- 8) Consentimiento 'privacy' apunta a la versión vigente de privacidad.
select is(
  (select terms_version_id from public.user_consents
    where user_id = '00000000-0000-0000-0000-0000000005b1' and consent_type = 'privacy'),
  (select id from public.terms_versions where doc_type = 'privacy' and is_current),
  'consent privacy → privacy_version_id vigente'
);

-- 9) Consentimiento 'age' va sin versión (terms_version_id NULL).
select ok(
  (select terms_version_id is null from public.user_consents
    where user_id = '00000000-0000-0000-0000-0000000005b1' and consent_type = 'age'),
  'consent age → terms_version_id NULL'
);

-- 10) Consentimiento 'whatsapp' va sin versión (terms_version_id NULL).
select ok(
  (select terms_version_id is null from public.user_consents
    where user_id = '00000000-0000-0000-0000-0000000005b1' and consent_type = 'whatsapp'),
  'consent whatsapp → terms_version_id NULL'
);

-- 11) Agotamiento: el token de un uso ya está en 1/1 → un segundo canje falla atómicamente.
select throws_ok(
  $$ select public.redeem_invitation_atomic(
       '00000000-0000-0000-0000-0000000005a1'::uuid,
       '00000000-0000-0000-0000-0000000005b2'::uuid) $$,
  'P0001', 'TOKEN_MAX_USES_REACHED',
  'token agotado (current_uses = max_uses) → TOKEN_MAX_USES_REACHED'
);

-- 12) Doble membresía: b3 ya es agente activo → canjear (token ilimitado) falla.
select throws_ok(
  $$ select public.redeem_invitation_atomic(
       '00000000-0000-0000-0000-0000000005a2'::uuid,
       '00000000-0000-0000-0000-0000000005b3'::uuid) $$,
  'P0001', 'ALREADY_ACTIVE_MEMBER',
  'usuario con membresía activa → ALREADY_ACTIVE_MEMBER'
);

select * from finish();
rollback;
