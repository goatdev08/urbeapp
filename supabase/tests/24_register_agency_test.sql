-- Tests pgTAP — RPC register_agency_atomic + RLS agencies (subtarea 71.4, §4.7)
-- Ejecutar con: supabase test db
-- Corre como superusuario dentro de una transacción revertida. Impersonamos roles
-- con pg_temp.act_as(uid, role) (mismo patrón que 02_rls_test.sql / 19_register_user_atomic_test.sql
-- / 22_upgrade_to_agent_test.sql).
--
-- RED (2026-08-05): public.register_agency_atomic AÚN NO EXISTE. La migración GREEN
-- (fuera de esta subtarea de tests) debe crear:
--   register_agency_atomic(p_name text, p_slug text, p_contact_name text,
--     p_contact_phone text, p_contact_email text, p_created_by_user_id uuid,
--     p_logo_url text DEFAULT NULL) RETURNS uuid
--   SECURITY DEFINER, set search_path fijo, revoke all from public/anon/authenticated,
--   grant execute a service_role (mismo endurecimiento que register_user_atomic
--   20260729000001 y upgrade_to_agent_atomic 20260805000004 — NO el patrón viejo de
--   admin_create_agency_atomic, que deja el grant PUBLIC default sin revocar).
--
-- ── ARQUITECTURA (decisión ya tomada en el plan, NO se reabre aquí) ─────────────
-- EF NUEVA register-agency: caller = prospecto autenticado (cualquier rol), la
-- agencia nace con status='pending_approval'. NO se extiende admin_create_agency_atomic
-- (ese asume caller=admin + status='active' inmediato — flujo inverso).
--
-- ── SEAM 1: retorno de la RPC ────────────────────────────────────────────────────
-- register_agency_atomic RETURNS uuid (solo agency_id) — a diferencia de
-- admin_create_agency_atomic/upgrade_to_agent_atomic (returns table con varias
-- columnas), aquí no hay agency_member_id ni token_id que devolver (ver SEAM 2),
-- así que una tabla de 1 columna sería ceremonia sin propósito.
--
-- ── SEAM 2: NO se crea membresía (agency_members) al registrar ──────────────────
-- admin_create_agency_atomic siembra el owner en la MISMA transacción porque el
-- admin aprueba al crear (status='active' de inmediato). Aquí la agencia queda
-- 'pending_approval' — el PRD (§4.7: "El admin de Urbea revisa y aprueba la
-- solicitud antes de que la inmobiliaria pueda operar") y la subtarea 71.5
-- ("aprobar HABILITA al agente/agencia" vía triggers de state machine sobre
-- UPDATE sin EFs approve/reject en beta) dejan claro que la activación —incluida
-- la membresía owner del creador— es responsabilidad de 71.5, no de este RPC.
-- Verificado abajo (#11/#12): cero filas en agency_members, users.role sin tocar.
--
-- ── SEAM 3: contact_name/contact_phone/contact_email son OBLIGATORIOS aquí ──────
-- Las columnas de public.agencies NO tienen NOT NULL en contact_* (migración
-- 20260604000003) porque admin_create_agency_atomic los deja opcionales (un admin
-- puede dar de alta sin datos de contacto completos). El registro self-service SÍ
-- los requiere (PRD §4.7: "se capturan datos de empresa: razón social, contacto,
-- logotipo") — la RPC los valida con guard clauses propias (P0001 FIELDS_INCOMPLETE),
-- documentado y verificado en #17-19/#21 abajo.
--
-- ── SEAM 4: duplicados por usuario ────────────────────────────────────────────────
-- El PRD no impone límite de agencias pending por usuario. Se PERMITE en beta
-- (test #23): la única barrera anti-duplicados es el unique parcial existente de
-- slug/name sobre agencias no borradas (agencies_slug_unique_active /
-- agencies_name_unique_active, migración 20260604000003 — NO filtra por status,
-- así que una agencia 'pending_approval' YA bloquea un slug/name repetido; #22
-- lo verifica explícitamente).
--
-- ── SEAM 5: RLS de agencies — hallazgo del schema real ───────────────────────────
-- La política agencies_insert vigente (migración 20260604000010) es:
--   for insert to authenticated with check (created_by_user_id = (select auth.uid()))
-- Es decir: HOY cualquier usuario autenticado YA PUEDE insertar directo en
-- agencies (no solo vía RPC/service_role) siempre que created_by_user_id sea su
-- propio uid — la policy NO restringe status, por lo que un insert directo podría
-- colar status='active' sin aprobación (gap preexistente, fuera de alcance de
-- esta subtarea: no se toca RLS aquí). Los tests #24-28 documentan la REALIDAD
-- vigente como no-regresión (no lo que el plan asumía) — spoofear
-- created_by_user_id de otro usuario SÍ sigue bloqueado, y la visibilidad SELECT
-- de una agencia pending sigue acotada a su creador/admin/manager.

begin;
select plan(31);

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
  ('00000000-0000-0000-0000-000000007101', 'prospecto1@test.local'),   -- happy path (creador)
  ('00000000-0000-0000-0000-000000007102', 'prospecto2@test.local'),   -- spoofing / segundo usuario
  ('00000000-0000-0000-0000-000000007103', 'admin_71x@test.local');    -- admin (visibilidad RLS)
-- '...7199' NUNCA se inserta en auth.users ni public.users: caso "usuario inexistente".

update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000007103';

-- Agencia activa preexistente, para probar duplicado contra una agencia YA aprobada.
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-0000000071aa',
   'Agencia Activa Previa MX',
   'agencia-activa-previa-mx',
   'active',
   '00000000-0000-0000-0000-000000007103');

-- ════════════════════════════════════════════════════════════════════════════
-- 1-2) La RPC existe con la firma esperada, SECURITY DEFINER
-- ════════════════════════════════════════════════════════════════════════════

select has_function(
  'public',
  'register_agency_atomic',
  ARRAY['text', 'text', 'text', 'text', 'text', 'uuid', 'text'],
  'register_agency_atomic(name, slug, contact_name, contact_phone, contact_email, created_by_user_id, logo_url) debe existir'
);
select is(
  (select prosecdef from pg_proc join pg_namespace ns on pg_proc.pronamespace = ns.oid
    where ns.nspname = 'public' and pg_proc.proname = 'register_agency_atomic' limit 1),
  true,
  'register_agency_atomic debe ser SECURITY DEFINER'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3-4) Grants defensivos: solo service_role puede ejecutar
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select public.register_agency_atomic(
       'Inmobiliaria Anon MX'::text, 'inmobiliaria-anon-mx'::text,
       'Contacto'::text, '+525500000000'::text, 'contacto@anon.mx'::text,
       '00000000-0000-0000-0000-000000007101'::uuid) $$,
  '42501', null,
  'anon no puede ejecutar register_agency_atomic'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000007101', 'authenticated');
select throws_ok(
  $$ select public.register_agency_atomic(
       'Inmobiliaria Auth MX'::text, 'inmobiliaria-auth-mx'::text,
       'Contacto'::text, '+525500000000'::text, 'contacto@auth.mx'::text,
       '00000000-0000-0000-0000-000000007101'::uuid) $$,
  '42501', null,
  'authenticated no puede ejecutar register_agency_atomic directo (ni para sí mismo) -- pasa por la EF con service_role'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5-12) Happy path (ejecutado como service_role, que es como la EF real la llama)
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select lives_ok(
  $$ select public.register_agency_atomic(
       'Inmobiliaria Bosques SA de CV'::text,
       'inmobiliaria-bosques'::text,
       'Ana Torres'::text,
       '+525511119301'::text,
       'ana@inmobiliariabosques.mx'::text,
       '00000000-0000-0000-0000-000000007101'::uuid) $$,
  'register_agency_atomic: alta con datos completos (sin logo) se ejecuta sin error'
);
reset role;

select is(
  (select status::text from public.agencies where slug = 'inmobiliaria-bosques'),
  'pending_approval',
  'agencia autoregistrada nace con status = pending_approval (nunca active)'
);
select is(
  (select created_by_user_id from public.agencies where slug = 'inmobiliaria-bosques'),
  '00000000-0000-0000-0000-000000007101'::uuid,
  'agencia autoregistrada con created_by_user_id correcto'
);
select is(
  (select contact_email from public.agencies where slug = 'inmobiliaria-bosques'),
  'ana@inmobiliariabosques.mx',
  'agencia autoregistrada persiste contact_email'
);
select ok(
  (select logo_url is null from public.agencies where slug = 'inmobiliaria-bosques'),
  'agencia autoregistrada sin logo_url en el payload -> persiste NULL (opcional)'
);
select is(
  (select count(*)::int from public.agency_members
    where agency_id = (select id from public.agencies where slug = 'inmobiliaria-bosques')),
  0,
  'SEAM 2: NO se crea agency_members para el creador al autoregistrar (activación queda para 71.5)'
);
select is(
  (select role::text from public.users where id = '00000000-0000-0000-0000-000000007101'),
  'user',
  'SEAM 2: public.users.role del creador NO se toca (sigue user, no se promueve a agent)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 13) logo_url presente en el payload -> se persiste tal cual
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select lives_ok(
  $$ select public.register_agency_atomic(
       'Inmobiliaria Con Logo MX'::text,
       'inmobiliaria-con-logo-mx'::text,
       'Beto Ramírez'::text,
       '+525511119302'::text,
       'beto@conlogo.mx'::text,
       '00000000-0000-0000-0000-000000007102'::uuid,
       'https://r2.urbea.mx/agencies/logo-con-logo.png'::text) $$,
  'register_agency_atomic: alta con logo_url se ejecuta sin error'
);
reset role;

select is(
  (select logo_url from public.agencies where slug = 'inmobiliaria-con-logo-mx'),
  'https://r2.urbea.mx/agencies/logo-con-logo.png',
  'logo_url presente en el payload se persiste tal cual'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 14-16) Duplicados: slug/name (contra agencia YA activa) -> error tipado, atómico
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.agencies),
  3,
  'pre-condición: 3 agencias existen antes de los intentos de duplicado (fixture + 2 happy path)'
);

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.register_agency_atomic(
       'Otra Con Slug Duplicado'::text,
       'agencia-activa-previa-mx'::text,
       'Contacto'::text, '+525500000001'::text, 'c1@dup.mx'::text,
       '00000000-0000-0000-0000-000000007101'::uuid) $$,
  'P0001', 'SLUG_DUPLICATE',
  'slug duplicado contra agencia activa existente -> P0001 SLUG_DUPLICATE'
);
reset role;

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.register_agency_atomic(
       'Agencia Activa Previa MX'::text,
       'slug-diferente-name-igual'::text,
       'Contacto'::text, '+525500000002'::text, 'c2@dup.mx'::text,
       '00000000-0000-0000-0000-000000007101'::uuid) $$,
  'P0001', 'NAME_DUPLICATE',
  'name duplicado contra agencia activa existente -> P0001 NAME_DUPLICATE'
);
reset role;

select is(
  (select count(*)::int from public.agencies),
  3,
  'atomicidad: los intentos de duplicado NO agregan filas (siguen siendo 3)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 17-19) Campos de contacto obligatorios (SEAM 3) -> P0001 FIELDS_INCOMPLETE
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.register_agency_atomic(
       'Inmobiliaria Sin Contact Name'::text,
       'inmobiliaria-sin-contact-name'::text,
       null::text,
       '+525500000003'::text,
       'c3@sincontacto.mx'::text,
       '00000000-0000-0000-0000-000000007101'::uuid) $$,
  'P0001', 'FIELDS_INCOMPLETE',
  'contact_name NULL (resto completo) -> P0001 FIELDS_INCOMPLETE'
);
reset role;

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.register_agency_atomic(
       'Inmobiliaria Sin Contact Phone'::text,
       'inmobiliaria-sin-contact-phone'::text,
       'Contacto'::text,
       null::text,
       'c4@sincontacto.mx'::text,
       '00000000-0000-0000-0000-000000007101'::uuid) $$,
  'P0001', 'FIELDS_INCOMPLETE',
  'contact_phone NULL (resto completo) -> P0001 FIELDS_INCOMPLETE'
);
reset role;

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.register_agency_atomic(
       'Inmobiliaria Sin Contact Email'::text,
       'inmobiliaria-sin-contact-email'::text,
       'Contacto'::text,
       '+525500000004'::text,
       null::text,
       '00000000-0000-0000-0000-000000007101'::uuid) $$,
  'P0001', 'FIELDS_INCOMPLETE',
  'contact_email NULL (resto completo) -> P0001 FIELDS_INCOMPLETE'
);
reset role;

select is(
  (select count(*)::int from public.agencies),
  3,
  'atomicidad: cero filas nuevas tras los 3 intentos por FIELDS_INCOMPLETE (siguen siendo 3)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 20) created_by_user_id NULL -> P0001 CREATED_BY_REQUIRED
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.register_agency_atomic(
       'Inmobiliaria Sin Creador'::text,
       'inmobiliaria-sin-creador'::text,
       'Contacto'::text, '+525500000005'::text, 'c5@sincreador.mx'::text,
       null::uuid) $$,
  'P0001', 'CREATED_BY_REQUIRED',
  'created_by_user_id NULL -> P0001 CREATED_BY_REQUIRED'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 21) Usuario inexistente (no está en public.users) -> P0001 USER_NOT_FOUND
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.register_agency_atomic(
       'Inmobiliaria Usuario Fantasma'::text,
       'inmobiliaria-usuario-fantasma'::text,
       'Contacto'::text, '+525500000006'::text, 'c6@fantasma.mx'::text,
       '00000000-0000-0000-0000-000000007199'::uuid) $$,
  'P0001', 'USER_NOT_FOUND',
  'created_by_user_id de un usuario inexistente -> P0001 USER_NOT_FOUND'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 22) Idempotencia del constraint anti-duplicados (SEAM 4): el unique de slug
--     también bloquea contra una agencia PENDING (no solo contra 'active')
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.register_agency_atomic(
       'Otro Usuario Mismo Slug Pending'::text,
       'inmobiliaria-bosques'::text,
       'Contacto'::text, '+525500000007'::text, 'c7@pending.mx'::text,
       '00000000-0000-0000-0000-000000007102'::uuid) $$,
  'P0001', 'SLUG_DUPLICATE',
  'slug duplicado contra una agencia pending_approval (no solo active) -> P0001 SLUG_DUPLICATE'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 23) SEAM 4: el MISMO usuario puede registrar DOS agencias pending (distinto
--     slug/name) -- permitido en beta, sin límite por usuario
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select lives_ok(
  $$ select public.register_agency_atomic(
       'Segunda Inmobiliaria Del Mismo Usuario'::text,
       'segunda-inmobiliaria-mismo-usuario'::text,
       'Ana Torres'::text, '+525511119301'::text, 'ana2@segundamx.mx'::text,
       '00000000-0000-0000-0000-000000007101'::uuid) $$,
  'SEAM 4: un usuario que ya tiene una agencia pending puede registrar una segunda (permitido en beta)'
);
reset role;

select is(
  (select count(*)::int from public.agencies
    where created_by_user_id = '00000000-0000-0000-0000-000000007101'::uuid),
  2,
  'el creador del test #23 ahora tiene 2 agencias registradas (ninguna bloqueada por duplicidad de usuario)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 24-28) RLS agencies (SEAM 5): no-regresión de la política REAL vigente
-- ════════════════════════════════════════════════════════════════════════════

-- 24) El prospecto SÍ puede insertar directo en agencies con su propio
--     created_by_user_id (política agencies_insert vigente, migración
--     20260604000010) -- documentado como comportamiento actual, no tocado aquí.
select pg_temp.act_as('00000000-0000-0000-0000-000000007102', 'authenticated');
select lives_ok(
  $$ insert into public.agencies (name, slug, status, created_by_user_id) values
     ('Inmobiliaria RLS Directa', 'inmobiliaria-rls-directa', 'pending_approval',
      '00000000-0000-0000-0000-000000007102') $$,
  'RLS no-regresión: authenticated puede insertar en agencies con su propio created_by_user_id'
);
reset role;

-- 25) El prospecto NO puede insertar spoofeando created_by_user_id de OTRO usuario.
select pg_temp.act_as('00000000-0000-0000-0000-000000007102', 'authenticated');
select throws_ok(
  $$ insert into public.agencies (name, slug, status, created_by_user_id) values
     ('Inmobiliaria RLS Spoof', 'inmobiliaria-rls-spoof', 'pending_approval',
      '00000000-0000-0000-0000-000000007101') $$,
  '42501', null,
  'RLS: authenticated NO puede insertar en agencies con created_by_user_id de otro usuario'
);
reset role;

-- 26) El creador ve su propia agencia pending vía SELECT.
select pg_temp.act_as('00000000-0000-0000-0000-000000007102', 'authenticated');
select is(
  (select count(*)::int from public.agencies where slug = 'inmobiliaria-rls-directa'),
  1,
  'RLS: el creador ve su propia agencia pending_approval vía SELECT'
);
reset role;

-- 27) Un tercer usuario autenticado (no admin, no creador) NO ve esa agencia pending.
select pg_temp.act_as('00000000-0000-0000-0000-000000007101', 'authenticated');
select is(
  (select count(*)::int from public.agencies where slug = 'inmobiliaria-rls-directa'),
  0,
  'RLS: un usuario autenticado distinto del creador NO ve la agencia pending ajena'
);
reset role;

-- 28) El admin SÍ ve la agencia pending (necesario para aprobarla en 71.5).
select pg_temp.act_as('00000000-0000-0000-0000-000000007103', 'authenticated');
select is(
  (select count(*)::int from public.agencies where slug = 'inmobiliaria-rls-directa'),
  1,
  'RLS: el admin ve cualquier agencia pending_approval (is_admin() bypass)'
);
reset role;

select * from finish();
rollback;
