-- Tests pgTAP — cambio de agencia (RPC switch_agency_atomic) + RLS properties_insert
-- vs suspensión (subtarea 71.6, PRD §4.6/§4.7)
-- Ejecutar con: supabase test db
-- Corre como superusuario dentro de una transacción revertida (no persiste).
--
-- ════════════════════════════════════════════════════════════════════════════
-- ALCANCE (decisión de Abraham 2026-08-05, PLAN de la subtarea — no se reabre aquí):
-- ════════════════════════════════════════════════════════════════════════════
-- Followers DIFERIDO a #78 (la tabla `follows` NO existe todavía). El PRD §4.6
-- dice "si cambia de inmobiliaria, conserva sus seguidores" — el follow es al
-- AGENTE, no a la agencia, así que ninguna operación de esta subtarea debería
-- tocar seguidores. Cuando #78 exista, agregar ahí un assert que confirme que
-- switch_agency_atomic no toca `follows` (ponytail: no crear la tabla antes de
-- tiempo solo para este test).
--
-- Alta/baja/suspensión de agentes (EF manage-agency-member) se cubre en Deno
-- (supabase/functions/manage-agency-member/handler.test.ts) — el SEAM elegido
-- para esa EF es TS puro (service_role + reimplementación explícita de
-- private.can_manage_agency_member, patrón update-property-status/
-- property_status_updater.ts, NO paso por RLS) precisamente porque necesita
-- distinguir 404 (miembro invisible/de otra agencia) de 403 (miembro visible
-- pero el rol del caller no alcanza) — ver rationale completo en
-- supabase/functions/manage-agency-member/types.ts. Por eso este archivo pgTAP
-- NO prueba de nuevo members_update/members_delete (ya cubiertas en
-- 21_agency_member_role_matrix_test.sql) — esas policies YA permiten a
-- owner/admin cambiar `status` a cualquier valor de columna (no distinguen
-- valores); el único delta de ESTE archivo a nivel de base de datos es (a) la
-- RPC nueva de transición atómica y (b) que `properties_insert` NO consulta
-- `agency_members.status` (hallazgo, ver sección J).
--
-- ── HALLAZGO DEL SCHEMA: agency_member_status solo tiene 2 valores ───────────
-- `agency_member_status` = ('active', 'removed') — ver 20260604000001. NO existe
-- 'suspended' ni 'left'. Precedente 71.2 (20260805000002/21_...test.sql):
-- extender un enum vive en GREEN, nunca en RED (ADD VALUE no puede convivir en
-- la misma transacción con código que lo use). Esta fase RED NO extiende el
-- enum: el status fino ('suspended' vs 'removed'/baja) es un detalle de
-- CONTRATO de la EF manage-agency-member (TS puro, sin dependencia del enum
-- real -- ver ese handler.test.ts) que GREEN resolverá (lo más probable:
-- ALTER TYPE ADD VALUE 'suspended' en su propia migración, mismo patrón que
-- 20260805000002). La RLS de properties_insert (sección J) SOLO necesita saber
-- "¿la membresía está active o no?" -- coarse-grained -- así que se prueba con
-- el valor YA real 'removed' como proxy de "no soy miembro activo", sin
-- bloquear este RED en la extensión del enum.
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM 1 — SUT (aún NO existe, se crea en la migración GREEN):
-- ════════════════════════════════════════════════════════════════════════════
-- public.switch_agency_atomic(p_user_id uuid, p_target_agency_id uuid)
--   returns table (old_agency_id uuid, new_agency_id uuid, agency_member_id uuid)
--   language plpgsql, SECURITY DEFINER, set search_path fijo.
-- Espejo de upgrade_to_agent_atomic (20260805000004): una función PL/pgSQL es
-- un solo statement, así que si una excepción escapa Postgres revierte TODOS
-- los efectos -- misma garantía de atomicidad, sin necesitar probarla aparte.
--
-- Orden de validación (barreras, una por RAISE EXCEPTION P0001):
--   1. NOT_CURRENT_MEMBER  -- p_user_id no tiene una membresía status='active' HOY
--      (cubre tanto "nunca fue miembro" como "su única membresía ya es 'removed'").
--   2. SAME_AGENCY         -- p_target_agency_id = la agencia actual (no-op explícito,
--      se rechaza en vez de tratarlo como éxito silencioso -- evita crear
--      dos filas idénticas o pisar removed_at con un no-op).
--   3. TARGET_AGENCY_NOT_FOUND   -- p_target_agency_id no existe en `agencies`.
--   4. TARGET_AGENCY_INACTIVE    -- existe pero status <> 'active'.
--   5. ALREADY_ACTIVE_MEMBER     -- backstop atómico del índice único
--      agency_members_one_active_per_user (unique_violation al insertar la fila
--      nueva) -- mismo patrón que upgrade_to_agent_atomic paso (4).
--
-- Efectos (happy path, en una transacción):
--   (a) la membresía VIEJA pasa a status='removed', removed_at=now() -- el
--       member_role histórico NO se toca (queda como registro, no se sobrescribe).
--   (b) se INSERTA una membresía NUEVA en la agencia destino: member_role='agent'
--       SIEMPRE (decisión: un owner/admin que cambia de agencia entra como agente
--       raso en la nueva -- no "hereda" jerarquía, el PRD §4.6 no lo pide y evitar
--       la ambigüedad "¿quién es el owner de la agencia destino ahora?"), status='active'.
--   (c) `users.agency_id` se denormaliza al nuevo valor. `users.role` NO se toca
--       (el usuario ya era agent/admin antes de cambiar de agencia).
--   (d) el índice agency_members_one_active_per_user nunca queda violado: se
--       verifica indirectamente contando que, tras la RPC, el usuario tiene
--       EXACTAMENTE 1 fila status='active' (ni 0 ni 2) -- una función PL/pgSQL
--       es un solo statement, así que un estado "transitorio" con 2 filas activas
--       NUNCA es observable desde otra sesión ni siquiera dentro de esta misma
--       transacción de test (los efectos intermedios de la función no son
--       visibles hasta que la función retorna).
--   Atomicidad de fallas: cualquier barrera (1)-(5) deja la membresía vieja
--   intacta (sin remover) -- verificado explícitamente en las secciones F/H/I.
--
-- Grants: solo service_role (la llamará la futura EF manage-agency-member o una
-- pantalla de "cambiar de agencia" -- fuera del alcance pgTAP de esta subtarea).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM 2 — Convención DELTA vs INVARIANTE (para el guardian, mismo criterio
-- que 21_agency_member_role_matrix_test.sql):
-- ════════════════════════════════════════════════════════════════════════════
-- DELTA      = hoy falla por assertion, tras GREEN completo pasa (discrimina).
-- INVARIANTE = ya se cumple hoy y debe seguir cumpliéndose tras GREEN (red de
--              seguridad explícita, no un caso inventado).
--
-- Patrón de impersonación: pg_temp.act_as (igual que 02/16/17/18/19/21/22/24_*).

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
  ('00000000-0000-0000-0000-000000726100', 'creator_switch@test.local'),       -- created_by_user_id de las agencias
  ('00000000-0000-0000-0000-000000726111', 'agent_happy_switch@test.local'),   -- happy path agente
  ('00000000-0000-0000-0000-000000726112', 'owner_happy_switch@test.local'),   -- happy path owner (member_role se resetea)
  ('00000000-0000-0000-0000-000000726113', 'user_no_membership@test.local'),   -- NOT_CURRENT_MEMBER (nunca fue miembro)
  ('00000000-0000-0000-0000-000000726114', 'user_removed_membership@test.local'), -- NOT_CURRENT_MEMBER (única membresía ya removed)
  ('00000000-0000-0000-0000-000000726115', 'user_target_notfound@test.local'), -- TARGET_AGENCY_NOT_FOUND
  ('00000000-0000-0000-0000-000000726116', 'user_target_inactive@test.local'), -- TARGET_AGENCY_INACTIVE
  ('00000000-0000-0000-0000-000000726117', 'user_same_agency@test.local'),     -- SAME_AGENCY
  ('00000000-0000-0000-0000-000000726118', 'agent_active_control@test.local'), -- INVARIANTE: publica hoy, debe seguir publicando
  ('00000000-0000-0000-0000-000000726119', 'agent_removed_membership@test.local'), -- DELTA: publica hoy (bug), NO debe poder tras GREEN
  ('00000000-0000-0000-0000-000000726120', 'agent_independent_control@test.local'); -- INVARIANTE: independiente (sin agencia) sigue publicando

update public.users set role = 'agent' where id in (
  '00000000-0000-0000-0000-000000726111', '00000000-0000-0000-0000-000000726112',
  '00000000-0000-0000-0000-000000726113', '00000000-0000-0000-0000-000000726114',
  '00000000-0000-0000-0000-000000726115', '00000000-0000-0000-0000-000000726116',
  '00000000-0000-0000-0000-000000726117', '00000000-0000-0000-0000-000000726118',
  '00000000-0000-0000-0000-000000726119', '00000000-0000-0000-0000-000000726120'
);
-- agent_independent_control es explícitamente independiente: sin agencia en el perfil.
update public.users set agency_id = null where id = '00000000-0000-0000-0000-000000726120';

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000726200', 'Inmobiliaria Switch Origen A', 'inmo-switch-origen-a', 'active', '00000000-0000-0000-0000-000000726100'),
  ('00000000-0000-0000-0000-000000726201', 'Inmobiliaria Switch Destino B', 'inmo-switch-destino-b', 'active', '00000000-0000-0000-0000-000000726100'),
  ('00000000-0000-0000-0000-000000726202', 'Inmobiliaria Switch Origen C (owner)', 'inmo-switch-origen-c', 'active', '00000000-0000-0000-0000-000000726100'),
  ('00000000-0000-0000-0000-000000726203', 'Inmobiliaria Switch Destino D', 'inmo-switch-destino-d', 'active', '00000000-0000-0000-0000-000000726100'),
  ('00000000-0000-0000-0000-000000726204', 'Inmobiliaria Switch Pendiente', 'inmo-switch-pendiente', 'pending_approval', '00000000-0000-0000-0000-000000726100'),
  ('00000000-0000-0000-0000-000000726205', 'Inmobiliaria Switch Publicar E', 'inmo-switch-publicar-e', 'active', '00000000-0000-0000-0000-000000726100');
-- '...726299' NUNCA se inserta: agencia destino inexistente.

insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000726300', '00000000-0000-0000-0000-000000726200', '00000000-0000-0000-0000-000000726111', 'agent', 'active'),
  ('00000000-0000-0000-0000-000000726301', '00000000-0000-0000-0000-000000726202', '00000000-0000-0000-0000-000000726112', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000726302', '00000000-0000-0000-0000-000000726200', '00000000-0000-0000-0000-000000726115', 'agent', 'active'),
  ('00000000-0000-0000-0000-000000726303', '00000000-0000-0000-0000-000000726200', '00000000-0000-0000-0000-000000726116', 'agent', 'active'),
  ('00000000-0000-0000-0000-000000726304', '00000000-0000-0000-0000-000000726200', '00000000-0000-0000-0000-000000726117', 'agent', 'active'),
  ('00000000-0000-0000-0000-000000726305', '00000000-0000-0000-0000-000000726205', '00000000-0000-0000-0000-000000726118', 'agent', 'active'),
  ('00000000-0000-0000-0000-000000726307', '00000000-0000-0000-0000-000000726200', '00000000-0000-0000-0000-000000726114', 'agent', 'removed');
update public.agency_members set removed_at = now() - interval '10 days'
  where id = '00000000-0000-0000-0000-000000726307';

-- agent_removed_membership: SIMULA "suspendido/dado de baja" (status<>'active')
-- pero users.role sigue 'agent' -- el estado que EXPONE el hueco de RLS (sección J).
insert into public.agency_members (id, agency_id, user_id, member_role, status, removed_at) values
  ('00000000-0000-0000-0000-000000726306', '00000000-0000-0000-0000-000000726205', '00000000-0000-0000-0000-000000726119', 'agent', 'removed', now());

-- ════════════════════════════════════════════════════════════════════════════
-- A) 1-2) La función existe con la firma esperada, SECURITY DEFINER
-- ════════════════════════════════════════════════════════════════════════════

select has_function(
  'public',
  'switch_agency_atomic',
  ARRAY['uuid', 'uuid'],
  'switch_agency_atomic(uuid, uuid) debe existir en el schema public'
);
select is(
  (select prosecdef from pg_proc join pg_namespace ns on pg_proc.pronamespace = ns.oid
    where ns.nspname = 'public' and pg_proc.proname = 'switch_agency_atomic' limit 1),
  true,
  'switch_agency_atomic debe ser SECURITY DEFINER'
);

-- ════════════════════════════════════════════════════════════════════════════
-- B) 3-4) Grants defensivos: solo service_role puede ejecutar
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select public.switch_agency_atomic('00000000-0000-0000-0000-000000726111'::uuid, '00000000-0000-0000-0000-000000726201'::uuid) $$,
  '42501', null,
  'anon no puede ejecutar switch_agency_atomic'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000726111', 'authenticated');
select throws_ok(
  $$ select public.switch_agency_atomic('00000000-0000-0000-0000-000000726111'::uuid, '00000000-0000-0000-0000-000000726201'::uuid) $$,
  '42501', null,
  'authenticated no puede ejecutar switch_agency_atomic (ni siquiera para su propio user_id)'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- C) 5-12) Happy path: agente activo en A cambia a B [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select lives_ok(
  $$ select public.switch_agency_atomic('00000000-0000-0000-0000-000000726111'::uuid, '00000000-0000-0000-0000-000000726201'::uuid) $$,
  'switch_agency_atomic: agente activo en A cambia a B se ejecuta sin error'
);
reset role;

select is(
  (select status::text from public.agency_members where id = '00000000-0000-0000-0000-000000726300'),
  'removed',
  'membresía vieja (A) queda status=removed tras el switch'
);
select ok(
  (select removed_at from public.agency_members where id = '00000000-0000-0000-0000-000000726300') is not null,
  'membresía vieja (A) queda con removed_at seteado'
);
select is(
  (select member_role::text from public.agency_members where id = '00000000-0000-0000-0000-000000726300'),
  'agent',
  'membresía vieja (A) conserva su member_role histórico (agent) sin sobrescribir'
);
select is(
  (select count(*)::int from public.agency_members
    where user_id = '00000000-0000-0000-0000-000000726111' and agency_id = '00000000-0000-0000-0000-000000726201'
      and status = 'active' and member_role = 'agent'),
  1,
  'membresía nueva (B) creada: status=active, member_role=agent'
);
select is(
  (select count(*)::int from public.agency_members
    where user_id = '00000000-0000-0000-0000-000000726111' and status = 'active'),
  1,
  'invariante: el usuario tiene EXACTAMENTE 1 membresía activa tras el switch (índice agency_members_one_active_per_user nunca violado)'
);
select is(
  (select agency_id from public.users where id = '00000000-0000-0000-0000-000000726111'),
  '00000000-0000-0000-0000-000000726201'::uuid,
  'users.agency_id se denormaliza a la agencia destino (B)'
);
select is(
  (select role::text from public.users where id = '00000000-0000-0000-0000-000000726111'),
  'agent',
  'users.role NO se toca por el switch (ya era agent)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- D) 13-17) Happy path owner: cambia de C a D y el member_role se RESETEA a
--     'agent' (no hereda jerarquía en la nueva agencia) [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select lives_ok(
  $$ select public.switch_agency_atomic('00000000-0000-0000-0000-000000726112'::uuid, '00000000-0000-0000-0000-000000726203'::uuid) $$,
  'switch_agency_atomic: owner en C cambia a D se ejecuta sin error'
);
reset role;

select is(
  (select status::text from public.agency_members where id = '00000000-0000-0000-0000-000000726301'),
  'removed',
  'membresía vieja del owner (C) queda status=removed'
);
select is(
  (select member_role::text from public.agency_members where id = '00000000-0000-0000-0000-000000726301'),
  'owner',
  'membresía vieja del owner (C) conserva member_role=owner histórico'
);
select is(
  (select member_role::text from public.agency_members
    where user_id = '00000000-0000-0000-0000-000000726112' and agency_id = '00000000-0000-0000-0000-000000726203' and status = 'active'),
  'agent',
  'membresía nueva (D) del ex-owner nace member_role=agent -- NO hereda owner en la agencia destino'
);
select is(
  (select count(*)::int from public.agency_members
    where user_id = '00000000-0000-0000-0000-000000726112' and status = 'active'),
  1,
  'invariante: el ex-owner también termina con EXACTAMENTE 1 membresía activa'
);

-- ════════════════════════════════════════════════════════════════════════════
-- E) 18-19) Cambio a la MISMA agencia -> SAME_AGENCY, sin efectos [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.switch_agency_atomic('00000000-0000-0000-0000-000000726117'::uuid, '00000000-0000-0000-0000-000000726200'::uuid) $$,
  'P0001', 'SAME_AGENCY',
  'cambiar a la agencia donde ya está activo -> P0001 SAME_AGENCY'
);
reset role;

select is(
  (select status::text from public.agency_members where id = '00000000-0000-0000-0000-000000726304'),
  'active',
  'atomicidad: la membresía sigue active tras SAME_AGENCY (sin remover ni duplicar)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- F) 20) Usuario sin membresía activa (nunca fue miembro) -> NOT_CURRENT_MEMBER [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.switch_agency_atomic('00000000-0000-0000-0000-000000726113'::uuid, '00000000-0000-0000-0000-000000726201'::uuid) $$,
  'P0001', 'NOT_CURRENT_MEMBER',
  'usuario que nunca tuvo agency_members -> P0001 NOT_CURRENT_MEMBER'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- G) 21-22) Usuario cuya única membresía ya es 'removed' -> NOT_CURRENT_MEMBER,
--     idempotente (no la reactiva) [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.switch_agency_atomic('00000000-0000-0000-0000-000000726114'::uuid, '00000000-0000-0000-0000-000000726201'::uuid) $$,
  'P0001', 'NOT_CURRENT_MEMBER',
  'usuario cuya única membresía ya está removed -> P0001 NOT_CURRENT_MEMBER'
);
reset role;

select is(
  (select status::text from public.agency_members where id = '00000000-0000-0000-0000-000000726307'),
  'removed',
  'atomicidad: la membresía removed preexistente NO se reactiva por el intento fallido'
);

-- ════════════════════════════════════════════════════════════════════════════
-- H) 23-24) Agencia destino inexistente -> TARGET_AGENCY_NOT_FOUND [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.switch_agency_atomic('00000000-0000-0000-0000-000000726115'::uuid, '00000000-0000-0000-0000-000000726299'::uuid) $$,
  'P0001', 'TARGET_AGENCY_NOT_FOUND',
  'agencia destino que no existe -> P0001 TARGET_AGENCY_NOT_FOUND'
);
reset role;

select is(
  (select status::text from public.agency_members where id = '00000000-0000-0000-0000-000000726302'),
  'active',
  'atomicidad: la membresía origen sigue active tras TARGET_AGENCY_NOT_FOUND'
);

-- ════════════════════════════════════════════════════════════════════════════
-- I) 25-26) Agencia destino no-active (pending_approval) -> TARGET_AGENCY_INACTIVE [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.switch_agency_atomic('00000000-0000-0000-0000-000000726116'::uuid, '00000000-0000-0000-0000-000000726204'::uuid) $$,
  'P0001', 'TARGET_AGENCY_INACTIVE',
  'agencia destino pending_approval -> P0001 TARGET_AGENCY_INACTIVE'
);
reset role;

select is(
  (select status::text from public.agency_members where id = '00000000-0000-0000-0000-000000726303'),
  'active',
  'atomicidad: la membresía origen sigue active tras TARGET_AGENCY_INACTIVE'
);

-- ════════════════════════════════════════════════════════════════════════════
-- J) 27-29) properties_insert NO consulta agency_members.status HOY -- una
--     membresía no-activa (proxy real de "suspendido") NO bloquea publicar.
--     Hallazgo: la policy vigente (20260604000010) es
--       with check (owner_user_id = auth.uid() and private.current_user_role() in ('agent','admin'))
--     -- solo mira `users.role`, nunca `agency_members.status`. [DELTA + INVARIANTE]
-- ════════════════════════════════════════════════════════════════════════════

-- 27) [INVARIANTE] agente con membresía ACTIVA publica hoy y debe seguir publicando.
select pg_temp.act_as('00000000-0000-0000-0000-000000726118');
select lives_ok(
  $$ insert into public.properties
       (owner_user_id, agency_id, property_type, operation_type, address, location, price, status)
     values
       ('00000000-0000-0000-0000-000000726118', '00000000-0000-0000-0000-000000726205',
        'departamento', 'rent', 'Fixture 26 -- agente con membresía activa',
        extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography,
        12000, 'draft') $$,
  'agente con membresía ACTIVA en su agencia SÍ puede publicar (no-regresión)'
);
reset role;

-- 28) [DELTA] agente con membresía 'removed' (proxy de suspendido) NO debería
--     poder publicar propiedades de esa agencia -- HOY el INSERT se permite
--     porque la policy no mira agency_members.status, así que este throws_ok
--     falla en RED (el INSERT vive_ok hoy) y debe empezar a lanzar 42501 tras
--     GREEN (properties_insert debe exigir status='active' cuando agency_id
--     no es null).
select pg_temp.act_as('00000000-0000-0000-0000-000000726119');
select throws_ok(
  $$ insert into public.properties
       (owner_user_id, agency_id, property_type, operation_type, address, location, price, status)
     values
       ('00000000-0000-0000-0000-000000726119', '00000000-0000-0000-0000-000000726205',
        'departamento', 'rent', 'Fixture 26 -- agente con membresía removed/suspendida',
        extensions.ST_SetSRID(extensions.ST_MakePoint(-103.351, 20.671), 4326)::extensions.geography,
        13000, 'draft') $$,
  '42501', null,
  'agente cuya membresía NO está active (suspendido/baja) NO debe poder publicar en esa agencia'
);
reset role;

-- 29) [INVARIANTE] agente INDEPENDIENTE (sin agencia, sin fila en agency_members)
--     sigue pudiendo publicar -- guarda contra un GREEN que sobre-bloquee a
--     quien nunca tuvo membresía que verificar.
select pg_temp.act_as('00000000-0000-0000-0000-000000726120');
select lives_ok(
  $$ insert into public.properties
       (owner_user_id, agency_id, property_type, operation_type, address, location, price, status)
     values
       ('00000000-0000-0000-0000-000000726120', null,
        'casa', 'sale', 'Fixture 26 -- agente independiente sin agencia',
        extensions.ST_SetSRID(extensions.ST_MakePoint(-103.352, 20.672), 4326)::extensions.geography,
        2100000, 'draft') $$,
  'agente independiente (agency_id null, sin agency_members) sigue pudiendo publicar'
);
reset role;

select * from finish();
rollback;
