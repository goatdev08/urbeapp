-- Tests pgTAP — Capacidades sobre public.agencies + helper private.org_can_advertise
-- (tarea #168.1, exploración 039)
-- Ejecutar con: supabase test db
-- Corre como superusuario dentro de una transacción revertida (no persiste).
-- Impersonamos con pg_temp.act_as(uid, role) (mismo patrón que 02/16/25_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SUT (AÚN NO EXISTE, RED 2026-08-15): la migración GREEN debe agregar a
-- public.agencies:
--   can_publish_properties boolean not null default true
--   can_advertise           boolean not null default false
--   advertiser_category     advertiser_category null   (enum NUEVO: 7 valores)
-- + constraint agencies_al_menos_una_capacidad check (can_publish_properties or can_advertise)
-- + private.org_can_advertise(p_agency_id uuid) returns boolean (security definer)
--     false si: id inexistente | deleted_at no nulo | status <> 'active' | can_advertise = false
--     true en el happy path (activa, no borrada, can_advertise = true).
-- Todo aditivo, sin backfill: toda fila (nueva o preexistente) cae en el
-- default de columna (true, false, null) — comportamiento IDÉNTICO al de hoy.
--
-- ⚠️ Estructura del archivo / por qué, una vez que las columnas no existen, TODO
-- lo demás cae en cascada: la Sección 1 usa SOLO funciones catalográficas de
-- pgTAP (has_column/col_type_is/col_not_null/col_is_null/col_default_is/
-- has_type) y una consulta propia contra pg_enum/pg_type — estas NUNCA lanzan
-- excepción aunque la columna/tipo no exista, así que reportan "not ok" limpio,
-- uno por uno. A partir de la Sección 2 se hacen consultas RAW contra columnas
-- que aún no existen. Postgres aborta la transacción completa en la primera
-- ("column ... does not exist") y todo lo que sigue se reporta en cascada hasta
-- el rollback final. Mismo patrón ya usado en este repo para RED de columnas/
-- funciones inexistentes (ver 16_mx_catalog_test.sql, header + sección 2).
--
-- Patrón de impersonación: igual que 02_rls_test.sql / 16_mx_catalog_test.sql
-- (pg_temp.act_as(uid, role) + set local role + request.jwt.claims).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(28);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Metadata: columnas, tipos, nullability, defaults y el enum nuevo
--    (funciones catalográficas de pgTAP: no abortan la transacción si el
--    objeto no existe)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1-3) Las 3 columnas existen ─────────────────────────────────────────────
select has_column('public', 'agencies', 'can_publish_properties', 'agencies.can_publish_properties existe');
select has_column('public', 'agencies', 'can_advertise', 'agencies.can_advertise existe');
select has_column('public', 'agencies', 'advertiser_category', 'agencies.advertiser_category existe');

-- ── 4-6) Tipos de columna ───────────────────────────────────────────────────
select col_type_is('public', 'agencies', 'can_publish_properties', 'boolean', 'can_publish_properties es boolean');
select col_type_is('public', 'agencies', 'can_advertise', 'boolean', 'can_advertise es boolean');
select col_type_is('public', 'agencies', 'advertiser_category', 'advertiser_category', 'advertiser_category es del enum advertiser_category');

-- ── 7-9) Nullability: los 2 booleanos son NOT NULL, la categoría es NULLABLE ─
select col_not_null('public', 'agencies', 'can_publish_properties', 'can_publish_properties es NOT NULL');
select col_not_null('public', 'agencies', 'can_advertise', 'can_advertise es NOT NULL');
select col_is_null('public', 'agencies', 'advertiser_category', 'advertiser_category es NULLABLE (la llena el admin al encender la capacidad, no al crear la organización)');

-- ── 10-11) Defaults exactos: el statu quo de hoy, literal ──────────────────
select col_default_is('public', 'agencies', 'can_publish_properties', 'true', 'default de can_publish_properties es true');
select col_default_is('public', 'agencies', 'can_advertise', 'false', 'default de can_advertise es false');

-- ── 12) El enum advertiser_category existe ─────────────────────────────────
select has_type('public', 'advertiser_category', 'el enum public.advertiser_category existe');

-- ── 13) El enum tiene EXACTAMENTE los 7 valores esperados, en el orden dado ─
-- Consulta propia (no pgTAP) vía JOIN contra pg_enum/pg_type — si el tipo no
-- existe, el JOIN simplemente no encuentra filas y array_agg da NULL (no aborta).
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_catalog.pg_enum e
     join pg_catalog.pg_type t on t.oid = e.enumtypid
    where t.typname = 'advertiser_category'),
  array['credito_hipotecario', 'seguros', 'mudanzas', 'limpieza', 'notaria', 'avaluos', 'otro']::text[],
  'advertiser_category tiene exactamente los 7 valores esperados, en orden'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Sin backfill: una fila "preexistente" (insertada SIN tocar las 3 columnas
--    nuevas, tal como hace cualquier INSERT anterior a esta migración) cae en
--    el default de columna (true, false, null) — comportamiento IDÉNTICO al
--    de hoy, no un valor calculado.
--    (a partir de aquí: consultas RAW — si las columnas no existen, la
--    transacción aborta y el resto del archivo cae en cascada, ver cabecera)
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000460001', 'owner_preexistente_46@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000460002', 'Inmobiliaria Preexistente 46', 'inmo-preexistente-46', 'active',
   '00000000-0000-0000-0000-000000460001');

-- ── 14-16) La fila preexistente quedó exactamente en (true, false, null) ───
select is(
  (select can_publish_properties from public.agencies where id = '00000000-0000-0000-0000-000000460002'),
  true,
  'fila preexistente: can_publish_properties = true SIN backfill (default de columna)'
);
select is(
  (select can_advertise from public.agencies where id = '00000000-0000-0000-0000-000000460002'),
  false,
  'fila preexistente: can_advertise = false SIN backfill (default de columna)'
);
select is(
  (select advertiser_category from public.agencies where id = '00000000-0000-0000-0000-000000460002'),
  null,
  'fila preexistente: advertiser_category = null SIN backfill'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) CHECK agencies_al_menos_una_capacidad: rechaza (false, false), acepta
--    cualquier combinación con al menos una capacidad activa
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000460021', 'owner_check_46@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000460022', 'Inmobiliaria Check 46', 'inmo-check-46', 'active',
   '00000000-0000-0000-0000-000000460021');

-- ── 17) (false, false) es rechazado, con mensaje explícito (no genérico) ───
-- Mensaje EXACTO de Postgres para una violación de CHECK nombrado: nombra la
-- relación y el constraint, así se distingue de cualquier otro CHECK de la
-- tabla (p.ej. no basta con "violates check constraint" a secas).
select throws_ok(
  $$ update public.agencies set can_publish_properties = false, can_advertise = false
     where id = '00000000-0000-0000-0000-000000460022' $$,
  '23514',
  'new row for relation "agencies" violates check constraint "agencies_al_menos_una_capacidad"',
  'agencies_al_menos_una_capacidad rechaza (false, false) con mensaje explícito'
);

-- ── 18) Boundary: solo-publicidad (false, true) SÍ respeta "al menos una" ──
select lives_ok(
  $$ update public.agencies set can_publish_properties = false, can_advertise = true
     where id = '00000000-0000-0000-0000-000000460022' $$,
  'agencies_al_menos_una_capacidad acepta (false, true) — cuenta solo-publicidad'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) private.org_can_advertise(p_agency_id uuid) — false en 4 escenarios,
--    true en el happy path (5 asserts de comportamiento + existencia)
-- ════════════════════════════════════════════════════════════════════════════

select has_function('private', 'org_can_advertise', array['uuid'],
  'private.org_can_advertise(uuid) existe');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000460101', 'owner_happy_46@urbea.mx'),
  ('00000000-0000-0000-0000-000000460102', 'owner_deleted_46@urbea.mx'),
  ('00000000-0000-0000-0000-000000460103', 'owner_inactive_46@urbea.mx'),
  ('00000000-0000-0000-0000-000000460104', 'owner_noadv_46@urbea.mx');

-- Happy path: activa, no borrada, can_advertise = true.
insert into public.agencies (id, name, slug, status, created_by_user_id, can_advertise, advertiser_category) values
  ('00000000-0000-0000-0000-000000460111', 'Inmobiliaria Anuncia 46', 'inmo-anuncia-46', 'active',
   '00000000-0000-0000-0000-000000460101', true, 'notaria');

-- Soft-deleted: deleted_at no nulo, aunque can_advertise = true.
insert into public.agencies (id, name, slug, status, created_by_user_id, can_advertise, advertiser_category, deleted_at) values
  ('00000000-0000-0000-0000-000000460112', 'Inmobiliaria Borrada 46', 'inmo-borrada-46', 'active',
   '00000000-0000-0000-0000-000000460102', true, 'seguros', now());

-- Inactiva: status <> 'active' (suspended), aunque can_advertise = true.
insert into public.agencies (id, name, slug, status, created_by_user_id, can_advertise, advertiser_category) values
  ('00000000-0000-0000-0000-000000460113', 'Inmobiliaria Suspendida 46', 'inmo-suspendida-46', 'suspended',
   '00000000-0000-0000-0000-000000460103', true, 'mudanzas');

-- Sin capacidad: can_advertise = false explícito (activa, no borrada).
insert into public.agencies (id, name, slug, status, created_by_user_id, can_advertise) values
  ('00000000-0000-0000-0000-000000460114', 'Inmobiliaria Sin Anuncios 46', 'inmo-sin-anuncios-46', 'active',
   '00000000-0000-0000-0000-000000460104', false);

-- ── 20) id inexistente -> false ────────────────────────────────────────────
select is(
  private.org_can_advertise('00000000-0000-0000-0000-000000460199'),
  false,
  'org_can_advertise: id inexistente -> false'
);
-- ── 21) deleted_at no nulo -> false, aunque can_advertise = true ──────────
select is(
  private.org_can_advertise('00000000-0000-0000-0000-000000460112'),
  false,
  'org_can_advertise: organización soft-deleted -> false pese a can_advertise=true'
);
-- ── 22) status <> 'active' -> false, aunque can_advertise = true ──────────
select is(
  private.org_can_advertise('00000000-0000-0000-0000-000000460113'),
  false,
  'org_can_advertise: organización suspendida (status<>active) -> false pese a can_advertise=true'
);
-- ── 23) can_advertise = false -> false ─────────────────────────────────────
select is(
  private.org_can_advertise('00000000-0000-0000-0000-000000460114'),
  false,
  'org_can_advertise: can_advertise=false -> false'
);
-- ── 24) happy path: activa, no borrada, can_advertise=true -> true ────────
select is(
  private.org_can_advertise('00000000-0000-0000-0000-000000460111'),
  true,
  'org_can_advertise: activa + no borrada + can_advertise=true -> true (happy path)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Seguridad — impersonación con JWT real de OWNER: ni el dueño legítimo de
--    la organización puede prender can_advertise por PostgREST (UPDATE directo
--    a la tabla). El mecanismo real es el GRANT por columnas de
--    20260604000008_rls_helpers_and_policies.sql:411-412 (revoke update on
--    agencies + grant update SOLO de name/slug/logo_url/contact_*/deleted_at):
--    las 3 columnas nuevas NO deben sumarse a esa lista. El owner SÍ pasa la
--    policy RLS (manages_agency(id)=true) -- el bloqueo debe venir del GRANT de
--    columna (42501 "permission denied for table"), NO de la RLS (que, de
--    fallar, dejaría pasar el UPDATE con 0 filas afectadas sin excepción, no
--    con un error 42501). Por eso el fixture usa un owner LEGÍTIMO y no un
--    tercero cualquiera: así el único obstáculo posible es el GRANT.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000460201', 'owner_impersonado_46@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000460202', 'Inmobiliaria Impersonada 46', 'inmo-impersonada-46', 'active',
   '00000000-0000-0000-0000-000000460201');
insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000460202', '00000000-0000-0000-0000-000000460201', 'owner', 'active');

-- ── 25) El owner legítimo (RLS lo dejaría pasar) NO puede prender can_advertise ─
select pg_temp.act_as('00000000-0000-0000-0000-000000460201', 'authenticated');
select throws_ok(
  $$ update public.agencies set can_advertise = true where id = '00000000-0000-0000-0000-000000460202' $$,
  '42501',
  'permission denied for table agencies',
  'owner legítimo (manages_agency=true) NO puede setear can_advertise vía UPDATE directo — bloqueado por el GRANT de columna, no por RLS'
);
reset role;

-- ── 26) ...y la fila sigue exactamente como antes (el intento bloqueado no dejó rastro) ─
select is(
  (select can_advertise from public.agencies where id = '00000000-0000-0000-0000-000000460202'),
  false,
  'tras el intento bloqueado del owner, can_advertise sigue en su default (false)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) No-regresión: publicar una propiedad con una organización preexistente
--    (capacidades en su default) sigue funcionando exactamente igual que hoy.
--    publish_property_atomic (20260809000006) no cambia de firma en esta
--    subtarea -- las capacidades nuevas no la tocan todavía (eso es 168.2/169+).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000460301', 'agente_noregresion_46@urbea.mx');
update public.users set role = 'agent' where id = '00000000-0000-0000-0000-000000460301';
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000460302', 'Inmobiliaria No Regresión 46', 'inmo-noregresion-46', 'active',
   '00000000-0000-0000-0000-000000460301');
insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000460302', '00000000-0000-0000-0000-000000460301', 'owner', 'active');
insert into public.property_videos (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url) values
  ('00000000-0000-0000-0000-000000460303', null, '00000000-0000-0000-0000-000000460301', 'ready', 1,
   'cfuid-46-noregresion', 'https://upload.example/no-regresion-46');

create temp table result_noregresion_46 (
  ok           boolean,
  property_id  uuid,
  err_sqlstate text,
  err_message  text
);

do $$
declare
  v_property_id uuid;
begin
  select property_id into v_property_id
    from public.publish_property_atomic(
      p_user_id             => '00000000-0000-0000-0000-000000460301'::uuid,
      p_operation_type      => 'rent',
      p_property_type       => 'departamento',
      p_price               => 8800.00,
      p_address             => 'Calle No Regresión 46',
      p_lat                 => 20.5,
      p_lng                 => -103.5,
      p_cloudflare_uid      => 'cfuid-46-noregresion',
      p_property_status     => 'pending_review'
    );
  insert into result_noregresion_46 values (true, v_property_id, null, null);
exception when others then
  insert into result_noregresion_46 values (false, null, sqlstate, sqlerrm);
end $$;

-- ── 27) Publicar con una organización preexistente sigue sin lanzar excepción ─
select is(
  (select ok from result_noregresion_46),
  true,
  'no-regresión: publicar con una organización preexistente (capacidades default) sigue funcionando sin excepción'
);

-- ── 28) ...y sigue denormalizando agency_id exactamente igual que hoy ──────
select is(
  (select agency_id from public.properties where id = (select property_id from result_noregresion_46)),
  '00000000-0000-0000-0000-000000460302'::uuid,
  'no-regresión: properties.agency_id se denormaliza a la agencia del publicante, igual que antes de esta migración'
);

select * from finish();
rollback;
