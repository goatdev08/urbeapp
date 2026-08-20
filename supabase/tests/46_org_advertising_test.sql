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
select plan(80);

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
-- Reconciliado 168.7 (2026-08-16): can_advertise=true ahora exige
-- advertiser_category no nula (agencies_categoria_requerida_para_anunciar,
-- 20260816000003) -- se agrega la categoría al fixture para seguir cumpliendo
-- ESE invariante SIN dejar de probar el boundary original de esta sección
-- (agencies_al_menos_una_capacidad acepta (false, true) como combinación
-- válida de capacidades). El caso viejo -- (false, true) SIN categoría -- se
-- cubre por separado en CATREQ8 (sección 10), que prueba que ahora es
-- rechazado a propósito.
select lives_ok(
  $$ update public.agencies set can_publish_properties = false, can_advertise = true,
       advertiser_category = 'otro'
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
-- 4B) 🔒 public.org_can_advertise(uuid) — wrapper PÚBLICO que DELEGA en
--     private.org_can_advertise (fix del guardián sobre 169.4, 2026-08-16:
--     PostgREST no expone el esquema `private` -- client.rpc("org_can_advertise")
--     desde make_advertiser_authorizer (_shared/clients.ts) fallaba SIEMPRE
--     con PGRST202, la EF devolvía 403 al 100% de los anunciantes legítimos.
--     Migración: 20260816000008_org_can_advertise_public_wrapper.sql.
--
--     Nada anclaba este contrato: el guardián mutó el nombre de la función y
--     el nombre del parámetro y las 1310 pruebas de la suite quedaron verdes
--     en ambos casos -- el bug exacto que se acaba de pagar puede volver en
--     silencio. Verificado EMPÍRICAMENTE contra la migración ya aplicada
--     (has_function_privilege directo, sin pgTAP) antes de fijar cada
--     literal esperado -- no se adivinó ningún valor.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ────────────────
--   · Existencia + firma exacta (uuid) -- mata el mutante del renombre de
--     función.
--   · Nombre del parámetro EXACTO = p_agency_id -- el adapter lo pasa
--     NOMBRADO; renombrarlo rompe la llamada real en producción sin romper
--     un test que solo mire la firma posicional.
--   · Privilegios, lo que más importa: anon/authenticated/PUBLIC (pseudo-rol)
--     SIN EXECUTE, service_role CON EXECUTE -- un futuro
--     `grant execute on all functions in schema public to authenticated`
--     (el patrón más común del ecosistema Supabase) evaporaría el revoke y
--     este assert es lo único que lo detectaría en rojo.
--   · Delegación REAL, no sello de goma: true/false para las MISMAS
--     organizaciones que la Sección 4 ya probó contra private.org_can_advertise
--     directo (reusa agencia 460111=true / 460114=false) -- si alguien
--     hardcodea `return true` o reimplementa el predicado en `public` en vez
--     de delegar, esto lo cacha. Impersonando service_role (el canal real
--     que usa la EF), no superusuario.
--   · private.org_can_advertise SIGUE existiendo con el grant de
--     `authenticated` intacto (168.1, 20260815000001:75) -- el wrapper la
--     complementa, no la sustituye ni le quita privilegios.
-- ════════════════════════════════════════════════════════════════════════════

-- ── WRAP1) Existencia + firma exacta -- mata el mutante del renombre ───────
select has_function('public', 'org_can_advertise', array['uuid'],
  'public.org_can_advertise(uuid) existe -- wrapper del fix de 169.4 (PostgREST no expone private)');

-- ── WRAP2) Nombre del parámetro EXACTO = p_agency_id -- el adapter real lo
--          pasa NOMBRADO (make_advertiser_authorizer, _shared/clients.ts) ──
select is(
  (select pg_get_function_arguments(p.oid)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'org_can_advertise'),
  'p_agency_id uuid',
  'public.org_can_advertise: el parámetro se llama EXACTAMENTE p_agency_id -- renombrarlo rompe la llamada nombrada real sin romper la firma posicional'
);

-- ── WRAP3-6) Privilegios reales (has_function_privilege por debajo, no
--            catálogo de un revoke que un GRANT masivo futuro evapora) ────
select function_privs_are('public', 'org_can_advertise', array['uuid'], 'anon', array[]::name[],
  'public.org_can_advertise: anon SIN EXECUTE');
select function_privs_are('public', 'org_can_advertise', array['uuid'], 'authenticated', array[]::name[],
  'public.org_can_advertise: authenticated SIN EXECUTE -- mata un futuro grant execute on all functions in schema public a authenticated (el patrón más común de Supabase)');
select function_privs_are('public', 'org_can_advertise', array['uuid'], 'public', array[]::name[],
  'public.org_can_advertise: PUBLIC (pseudo-rol) SIN EXECUTE -- Postgres otorga EXECUTE a PUBLIC por default al crear la función, el revoke explícito debe seguir vivo');
select function_privs_are('public', 'org_can_advertise', array['uuid'], 'service_role', array['EXECUTE']::name[],
  'public.org_can_advertise: service_role SÍ tiene EXECUTE -- sin esto la EF vuelve a devolver 403 al 100% de los anunciantes');

-- ── WRAP7-8) Delegación REAL -- MISMAS organizaciones de la Sección 4
--            (460111=true, 460114=false), llamadas ahora vía el wrapper
--            público impersonando service_role (el canal real de la EF) ───
select pg_temp.act_as(null, 'service_role');
select is(
  public.org_can_advertise('00000000-0000-0000-0000-000000460111'::uuid),
  true,
  'public.org_can_advertise: delega en private.org_can_advertise y devuelve true para una organización que SÍ puede anunciar'
);
select is(
  public.org_can_advertise('00000000-0000-0000-0000-000000460114'::uuid),
  false,
  'public.org_can_advertise: delega en private.org_can_advertise y devuelve false para una organización que NO puede anunciar'
);
reset role;

-- ── WRAP9) private.org_can_advertise conserva su grant de authenticated ────
select function_privs_are('private', 'org_can_advertise', array['uuid'], 'authenticated', array['EXECUTE']::name[],
  'private.org_can_advertise: authenticated conserva EXECUTE (grant original de 168.1, 20260815000001:75) intacto tras agregar el wrapper -- el wrapper complementa, no sustituye');

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

-- ════════════════════════════════════════════════════════════════════════════
-- 7) RPC public.set_org_advertising_atomic(p_agency_id, p_enabled, p_category)
--    (subtarea #168.2) — SOLO service_role, auditada en admin_actions.
--
-- SUT (AÚN NO EXISTE, RED 2026-08-15): migración GREEN
-- 20260815000002_set_org_advertising_rpc.sql debe crear:
--   public.set_org_advertising_atomic(p_agency_id uuid, p_enabled boolean,
--     p_category advertiser_category default null) returns void
--   language plpgsql security definer, search_path fijo explícito (mismo
--   criterio que private.agency_role_of, 20260805000003:14 — un security
--   definer sin search_path fijo es escalada de privilegios).
--   revoke execute from public, anon, authenticated; grant execute a
--   service_role únicamente (queda fuera del alcance de PostgREST/JWT normal
--   -- solo Studio/CLI con la service_role key).
--   Enciende/apaga can_advertise (+ advertiser_category si viene) sobre
--   agencies y, en la MISMA transacción, escribe EXACTAMENTE una fila en
--   admin_actions (entity_type='agency', entity_id=p_agency_id — mismo
--   criterio que approve_agency/reject_agency, 20260805000007:143). Si el
--   INSERT de auditoría falla, TODA la llamada hace rollback (ni el UPDATE de
--   agencies queda aplicado). Organización inexistente o con deleted_at no
--   nulo -> error explícito (P0001, mismo criterio que el resto de RPCs de
--   negocio: TOKEN_NOT_FOUND/USER_NOT_FOUND/STATUS_CHANGE_REQUIRES_ADMIN),
--   NUNCA un no-op silencioso.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ────────────────
-- Happy path:
--   · La función existe con la firma exacta (uuid, boolean, advertiser_category).
--   · Es SECURITY DEFINER con search_path fijo explícito (no vacío de facto).
--   · service_role enciende can_advertise (+ category) sin error.
--   · service_role apaga can_advertise (p_enabled=false, p_category en su
--     default) sin error — no es de una sola vía.
--   · Cada invocación escribe EXACTAMENTE una fila nueva en admin_actions
--     (entity_type/entity_id correctos), con admin_id no nulo.
-- Ramas no obvias (permisos, impersonación real — no catálogo de grants):
--   · anon recibe permission denied (42501) al intentar ejecutarla.
--   · authenticated recibe permission denied (42501) al intentar ejecutarla.
-- Boundary / error (los invariantes más importantes):
--   · 🔒 Fault-injection: si el INSERT de auditoría falla, TODA la llamada
--     hace rollback — la capacidad NO queda encendida y no queda fila
--     huérfana en admin_actions (patrón literal de
--     38_property_video_slots_test.sql: trigger "veneno" BEFORE INSERT).
--   · Organización inexistente -> error explícito P0001, no no-op silencioso.
--   · Organización con deleted_at no nulo -> error explícito P0001, no no-op
--     silencioso, y no queda ningún efecto parcial (ni capacidad ni auditoría).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 7.1) Metadata — catálogo puro, nunca lanza aunque la función no exista ──
select has_function(
  'public', 'set_org_advertising_atomic', array['uuid', 'boolean', 'advertiser_category'],
  'RPC1_set_org_advertising_atomic_existe_con_la_firma_exacta_uuid_boolean_advertiser_category'
);

select is(
  (select prosecdef from pg_proc join pg_namespace ns on pg_proc.pronamespace = ns.oid
    where ns.nspname = 'public' and pg_proc.proname = 'set_org_advertising_atomic' limit 1),
  true,
  'RPC2_set_org_advertising_atomic_debe_ser_security_definer'
);

-- search_path FIJO explícito -- no se pin a un valor exacto (la migración
-- GREEN es libre de elegir 'public' o '' como agency_role_of/org_can_advertise
-- ya hacen), solo que exista un proconfig con la forma 'search_path=...'.
select is(
  exists (
    select 1
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      cross join lateral unnest(coalesce(p.proconfig, array[]::text[])) as cfg(setting)
     where ns.nspname = 'public'
       and p.proname = 'set_org_advertising_atomic'
       and cfg.setting like 'search_path=%'
  ),
  true,
  'RPC3_set_org_advertising_atomic_fija_search_path_explicito_proteccion_contra_search_path_hijacking'
);

-- ── 7.2) Permisos — impersonación real, no catálogo de grants ───────────────
select pg_temp.act_as('00000000-0000-0000-0000-000000460400', 'anon');
select throws_ok(
  $$ select public.set_org_advertising_atomic('00000000-0000-0000-0000-000000460400'::uuid, true, 'otro'::advertiser_category) $$,
  '42501', null,
  'PERM1_anon_no_puede_ejecutar_set_org_advertising_atomic'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000460400', 'authenticated');
select throws_ok(
  $$ select public.set_org_advertising_atomic('00000000-0000-0000-0000-000000460400'::uuid, true, 'otro'::advertiser_category) $$,
  '42501', null,
  'PERM2_authenticated_no_puede_ejecutar_set_org_advertising_atomic_ni_para_su_propia_agencia'
);
reset role;

-- ── 7.3) Happy path: enciende Y apaga (impersonación service_role real) ─────
-- El admin actor viaja en el JWT (sub) del propio caller service_role -- mismo
-- mecanismo que ya soporta pg_temp.act_as(uid, role) en este archivo -- con
-- role='admin' real en public.users, para que cualquier resolución basada en
-- auth.uid()/rol admin encuentre un actor válido para admin_actions.admin_id.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000460401', 'admin_actor_46@urbea.mx'),
  ('00000000-0000-0000-0000-000000460411', 'owner_onoff_46@urbea.mx');
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000460401';
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000460412', 'Inmobiliaria Enciende Apaga 46', 'inmo-enciende-apaga-46', 'active',
   '00000000-0000-0000-0000-000000460411');

select pg_temp.act_as('00000000-0000-0000-0000-000000460401', 'service_role');
select lives_ok(
  $$ select public.set_org_advertising_atomic('00000000-0000-0000-0000-000000460412'::uuid, true, 'seguros'::advertiser_category) $$,
  'ON1_service_role_enciende_can_advertise_sin_error'
);
reset role;

select is(
  (select can_advertise from public.agencies where id = '00000000-0000-0000-0000-000000460412'),
  true,
  'ON2_can_advertise_queda_encendido_true'
);
select is(
  (select advertiser_category from public.agencies where id = '00000000-0000-0000-0000-000000460412'),
  'seguros'::advertiser_category,
  'ON3_advertiser_category_queda_en_seguros'
);

select is(
  (select count(*)::int from public.admin_actions
    where entity_id = '00000000-0000-0000-0000-000000460412' and entity_type = 'agency'),
  1,
  'AUD1_al_encender_se_escribe_EXACTAMENTE_una_fila_en_admin_actions_en_la_misma_transaccion'
);
select isnt(
  (select admin_id from public.admin_actions
    where entity_id = '00000000-0000-0000-0000-000000460412' and entity_type = 'agency'
    order by created_at desc limit 1),
  null,
  'AUD2_la_fila_de_auditoria_registra_un_admin_id_no_nulo'
);
-- AUD3 (#176): el CONTENIDO de la auditoría. AUD1/AUD2 solo miraban que la fila
-- existiera y que el admin_id no fuera nulo -- una auditoría que registrara el
-- estado equivocado los pasaba a los dos. Aquí se fija el par completo: el
-- old_values debe traer el estado ANTERIOR (can_advertise false, categoría
-- nula) y el new_values el estado PEDIDO ('seguros'). Ocupa el lugar que dejó
-- FI3 al eliminarse; el plan sigue en 80.
select is(
  (select (old_values->>'can_advertise') || '|' ||
          coalesce(old_values->>'advertiser_category', 'NULL') || '|' ||
          (new_values->>'can_advertise') || '|' ||
          (new_values->>'advertiser_category')
     from public.admin_actions
    where entity_id = '00000000-0000-0000-0000-000000460412' and entity_type = 'agency'
    order by created_at desc limit 1),
  'false|NULL|true|seguros',
  'AUD3_la_auditoria_registra_el_estado_ANTERIOR_y_el_NUEVO_no_solo_que_hubo_un_cambio'
);

-- ...y también APAGA -- no es de una sola vía. p_category en su default (null).
-- Fixture INDEPENDIENTE (agencia B), sembrada DIRECTO con can_advertise=true
-- (bypass del RPC, simulando una organización que YA tenía la capacidad
-- encendida de antes) -- a propósito, para que OFF2 sea una aserción con
-- dientes en RED: si set_org_advertising_atomic no existe, la llamada no
-- toca la fila y can_advertise se queda en true, en vez de coincidir por
-- default con el false esperado (lo que sí le pasaría a esta misma aserción
-- si reusara la agencia A, que arranca en false).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000460413', 'owner_onoff_b_46@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id, can_advertise, advertiser_category) values
  ('00000000-0000-0000-0000-000000460414', 'Inmobiliaria Enciende Apaga B 46', 'inmo-enciende-apaga-b-46', 'active',
   '00000000-0000-0000-0000-000000460413', true, 'notaria');

select pg_temp.act_as('00000000-0000-0000-0000-000000460401', 'service_role');
select lives_ok(
  $$ select public.set_org_advertising_atomic('00000000-0000-0000-0000-000000460414'::uuid, false) $$,
  'OFF1_service_role_apaga_can_advertise_sin_error_con_p_category_en_su_default'
);
reset role;

select is(
  (select can_advertise from public.agencies where id = '00000000-0000-0000-0000-000000460414'),
  false,
  'OFF2_can_advertise_queda_apagado_false_no_es_de_una_sola_via_arrancaba_en_true_sembrado_directo'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_id = '00000000-0000-0000-0000-000000460414' and entity_type = 'agency'),
  1,
  'AUD3_la_llamada_de_apagado_tambien_escribe_EXACTAMENTE_una_fila_en_admin_actions'
);

-- ── 7.4) 🔒 Fault-injection — el INSERT de auditoría falla -> ROLLBACK TOTAL ─
-- Trigger "veneno" sobre admin_actions (patrón literal de
-- 38_property_video_slots_test.sql sección 5), adjuntado AHORA, después de
-- que 7.3 ya escribió sus propias filas de auditoría sin interferencia.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000460431', 'owner_poison_46@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000460432', 'Inmobiliaria Fault Injection 46', 'inmo-fault-injection-46', 'active',
   '00000000-0000-0000-0000-000000460431');

create or replace function pg_temp.poison_admin_actions_insert()
returns trigger language plpgsql as $poison$
begin
  raise exception 'poison: fault injection forzada (pgTAP 46_org_advertising_test) para probar el rollback total de set_org_advertising_atomic'
    using errcode = '23505';
end
$poison$;
create trigger poison_admin_actions_before_insert
  before insert on public.admin_actions
  for each row execute function pg_temp.poison_admin_actions_insert();

select pg_temp.act_as('00000000-0000-0000-0000-000000460401', 'service_role');
-- sqlstate '23505' EXACTO (el que lanza el trigger veneno), no null/null: así la
-- aserción distingue el fallo real de auditoría del 42883 de "función inexistente"
-- (RED de hoy), en vez de pasar por coincidencia con cualquier excepción.
select throws_ok(
  $$ select public.set_org_advertising_atomic('00000000-0000-0000-0000-000000460432'::uuid, true, 'mudanzas'::advertiser_category) $$,
  '23505', null,
  'FI1_fault_injection_el_insert_de_auditoria_falla_y_set_org_advertising_atomic_debe_lanzar_excepcion'
);
reset role;

select is(
  (select can_advertise from public.agencies where id = '00000000-0000-0000-0000-000000460432'),
  false,
  'FI2_atomicidad_rollback_total_can_advertise_NO_quedo_encendido_pese_al_update_previo_a_la_falla'
);
-- 🔴 FI3 ELIMINADO (#176) — NO era un assert débil: era INMATABLE.
-- Afirmaba "no quedó ninguna fila huérfana en admin_actions". Con el trigger
-- veneno puesto en BEFORE INSERT sobre esa misma tabla, ninguna fila PUEDE
-- aterrizar jamás -- el count(*)=0 lo garantizaba el fixture, no el SUT. Y el
-- problema es más profundo que el fixture: set_org_advertising_atomic corre
-- entera en UNA transacción, así que una fila huérfana es imposible por
-- construcción. FI3 asertaba la transaccionalidad de POSTGRES, no la del SUT.
-- Verificado por mutación antes de borrarlo (ninguno lo mató):
--   · mutante A -- envolver el insert de auditoría en `exception when others
--     then null` (la función deja de ser atómica): ✕ FI1, ✕ FI2, FI3 VIVO.
--   · mutante B -- insertar la auditoría ANTES del update (el escenario
--     clásico de huérfana que FI3 nombra): suite entera en PASS, FI3 VIVO.
-- La atomicidad la sostienen FI1 (lanza) y FI2 (can_advertise no quedó
-- encendido), y el mutante A mata a los dos. El assert que ocupa su lugar en
-- el plan es AUD3, arriba, que sí tiene dientes.

-- 🔴 El trigger veneno MUERE AQUÍ, al terminar 7.4 (#176). Antes sobrevivía
-- hasta la sección 8 y blindaba a 7.5 entera: con él puesto, INV3 e INV4 no
-- podían fallar aunque el SUT estuviera mal -- un mutante sin el guard de
-- deleted_at encendía la agencia borrada, pero el insert de auditoría chocaba
-- con el veneno y revertía el update, así que INV3 veía false e INV4 veía 0.
-- El fixture pasaba los asserts, no el SUT. Dropearlo aquí es lo que les
-- devuelve los dientes (mutación abajo, en la bitácora de la tarea).
drop trigger if exists poison_admin_actions_before_insert on public.admin_actions;

-- ── 7.5) Organización inexistente o con deleted_at -> error explícito ───────
select pg_temp.act_as('00000000-0000-0000-0000-000000460401', 'service_role');
select throws_ok(
  $$ select public.set_org_advertising_atomic('00000000-0000-0000-0000-000000460499'::uuid, true, 'otro'::advertiser_category) $$,
  'P0001', null,
  'INV1_agencia_inexistente_lanza_error_explicito_P0001_no_un_no_op_silencioso'
);
reset role;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000460441', 'owner_borrada_set_46@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id, deleted_at) values
  ('00000000-0000-0000-0000-000000460442', 'Inmobiliaria Borrada Set 46', 'inmo-borrada-set-46', 'active',
   '00000000-0000-0000-0000-000000460441', now());

select pg_temp.act_as('00000000-0000-0000-0000-000000460401', 'service_role');
select throws_ok(
  $$ select public.set_org_advertising_atomic('00000000-0000-0000-0000-000000460442'::uuid, true, 'otro'::advertiser_category) $$,
  'P0001', null,
  'INV2_agencia_con_deleted_at_lanza_error_explicito_P0001_no_un_no_op_silencioso'
);
reset role;

select is(
  (select can_advertise from public.agencies where id = '00000000-0000-0000-0000-000000460442'),
  false,
  'INV3_agencia_borrada_no_quedo_con_can_advertise_encendido_tras_el_intento_fallido'
);
select is(
  (select count(*)::int from public.admin_actions where entity_id = '00000000-0000-0000-0000-000000460442'),
  0,
  'INV4_agencia_borrada_no_quedo_ninguna_fila_de_auditoria_tras_el_intento_fallido'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 8) subtarea #168.3 — admin_create_agency_atomic + guard AGENCY_CANNOT_PUBLISH_
--    PROPERTIES en publish_property_atomic — params de capacidad con DEFAULT
--    al final (RED 2026-08-15).
--
-- SUT (AÚN NO EXISTE): una migración GREEN debe:
--   (a) reemplazar public.admin_create_agency_atomic (hoy 9 params, migración
--       20260604000016) por UNA función de 11 params — p_can_publish_properties
--       boolean default true, p_can_advertise boolean default false, AL FINAL
--       (mismo patrón "defaults al final" que ya usa esa función) — con DROP
--       explícito del overload viejo ANTES del CREATE (precedente exacto:
--       20260604000016:27-44), para terminar con UNA sola función en pg_proc
--       (dos sobrecargas dejan la llamada por PostgREST ambigua).
--   (b) reemplazar public.publish_property_atomic partiendo EXACTAMENTE del
--       cuerpo vigente en 20260809000006_publish_property_atomic_price_visible.sql
--       (create or replace :34, guard AGENCY_MEMBERSHIP_SUSPENDED :93, comment
--       :181) — NO de 20260809000005 — agregando SOBRE ese cuerpo un guard
--       nuevo: si la agencia resuelta del publicante tiene
--       can_publish_properties = false, RAISE 'AGENCY_CANNOT_PUBLISH_PROPERTIES'
--       con errcode P0001, ANTES del INSERT en properties. El guard de precio
--       visible (p_price_visible / coalesce) y AGENCY_MEMBERSHIP_SUSPENDED
--       deben sobrevivir intactos (riesgo real: un create or replace reescribe
--       el cuerpo entero y puede pisarlos en silencio).
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ────────────────
-- Happy path / retrocompatibilidad del contrato publicado (§0.5 regla 2):
--   · RETRO1: llamar admin_create_agency_atomic con la firma vieja de 9 params
--     (tal como la llaman hoy los builds instalados vía la EF) sigue dando
--     EXACTAMENTE el mismo resultado (can_publish_properties=true,
--     can_advertise=false por default de columna) bajo la firma NUEVA de 11
--     params — no basta con que la llamada no truene, además debe resolverse
--     contra la función de 11 args (no quedar huérfana en un overload viejo).
-- Ramas no obvias (criterio de producto de la columna, org solo-publicidad):
--   · CAP1: la RPC acepta (p_can_publish_properties=false, p_can_advertise=true)
--     sin lanzar excepción — crea la organización solo-publicidad.
--   · CAP2: el owner de esa organización recibe un error EXPLÍCITO
--     (AGENCY_CANNOT_PUBLISH_PROPERTIES, P0001) al intentar publicar una
--     propiedad — no un fallo genérico ni un no-op silencioso.
--   · CAP3/CAP4: atomicidad del bloqueo — no queda ninguna propiedad creada ni
--     ningún video enlazado tras el intento bloqueado.
-- Boundary / error:
--   · CHECK1: (false, false) vía la RPC lo rechaza el CHECK
--     agencies_al_menos_una_capacidad (mismo mensaje explícito que el UPDATE
--     directo ya probado en la sección 3) — la RPC no lo enmascara ni lo
--     convierte en un error genérico distinto.
--   · OVERLOAD1: admin_create_agency_atomic tiene EXACTAMENTE una sobrecarga
--     en pg_proc, con 12 parámetros (168.7 agrega p_advertiser_category AL
--     FINAL con DEFAULT, 20260816000004) — dos sobrecargas conviviendo dejan
--     la llamada por PostgREST ambigua y rompen el alta desde el cliente
--     instalado (tan importante como RETRO1).
-- NO-REGRESIÓN (guardan comportamiento YA vigente en producción; PASAN hoy
-- por diseño — son la red de seguridad para el create-or-replace de (b), no
-- capacidad nueva; mismo patrón que la sección 6 "no regresión" de este mismo
-- archivo):
--   · NOREG1: AGENCY_MEMBERSHIP_SUSPENDED sigue vivo tras el create or replace.
--   · NOREG2: p_price_visible=false sigue escribiéndose en la fila real.
--   · NOREG3: p_price_visible omitido sigue defaulteando a true.
-- ════════════════════════════════════════════════════════════════════════════

-- ⚠️ Fixture pegajoso (hallazgo del guardian de 168.2): el trigger "veneno"
-- creado en la sección 7.4 (línea ~500) sobre admin_actions NUNCA se dropea en
-- este archivo. Si no se dropea aquí, cualquier INSERT a admin_actions de esta
-- sección aborta la transacción en cascada y los asserts que dependen de
-- auditoría quedan vacuos. Esta sección no depende de admin_actions
-- directamente, pero se dropea de todas formas por higiene y porque
-- admin_create_agency_atomic SÍ escribe en admin_actions internamente.
drop trigger if exists poison_admin_actions_before_insert on public.admin_actions;

-- ── 8.1) RETRO1 — firma vieja de 9 params == mismo resultado, bajo la función
--         NUEVA de 12 params (no un overload viejo huérfano) ────────────────
-- 🔄 168.7 (2026-08-16): igual que OVERLOAD1 (sección 8.5), este assert trae
-- embebido un pronargs = 11 -- con la firma creciendo a 12 params
-- (20260816000004, p_advertiser_category) el mismo tipo de reconciliación de
-- firma aplica aquí también (mismo mecanismo, misma afirmación: "resuelve
-- contra la función vigente, no un overload huérfano"). Se actualiza SOLO el
-- número, nada de lo que el assert afirma cambia.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000468301', 'admin_retrocompat_83@urbea.mx');

create temp table result_retrocompat_83 (agency_id uuid);
insert into result_retrocompat_83 (agency_id)
select agency_id from public.admin_create_agency_atomic(
  'Org Retrocompat 83'::text,
  'org-retrocompat-83'::text,
  'Contacto Retrocompat'::text,
  '+52 55 0000 0083'::text,
  'contacto-retrocompat-83@urbea.mx'::text,
  '00000000-0000-0000-0000-000000468301'::uuid,
  null::uuid,
  null::text,
  null::integer
);

select ok(
  (
    (select can_publish_properties from public.agencies
      where id = (select agency_id from result_retrocompat_83)) = true
    and (select can_advertise from public.agencies
      where id = (select agency_id from result_retrocompat_83)) = false
    and exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'admin_create_agency_atomic'
         and p.pronargs = 12
    )
  ),
  'RETRO1_llamada_con_la_firma_vieja_de_9_params_sigue_dando_can_publish_properties_true_y_can_advertise_false_resuelta_contra_la_funcion_nueva_de_12_params_no_un_overload_viejo_huerfano'
);

-- ── 8.2) CAP1 — la RPC acepta (false, true): org solo-publicidad ────────────
-- 🔄 RECONCILIADO 168.7 (2026-08-16), continuación tras el CHECK: la
-- migración 20260816000004 extiende admin_create_agency_atomic con un 12°
-- parámetro p_advertiser_category (default null) precisamente para destrabar
-- este caso — antes (BLOQUEADO, ver historial de la subtarea) la firma de 11
-- params no tenía forma de mandar la categoría y el INSERT chocaba SIEMPRE
-- con agencies_categoria_requerida_para_anunciar. Igual que assert 18 y
-- CAP2-4 (reconciliados sumando advertiser_category al fixture), aquí se
-- suma el 12° argumento a la llamada — el assert sigue afirmando EXACTAMENTE
-- lo mismo: la RPC acepta (can_publish_properties=false, can_advertise=true)
-- sin lanzar excepción y crea la organización solo-publicidad.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000468311', 'owner_solo_publicidad_83@urbea.mx');

select lives_ok(
  $$ select agency_id from public.admin_create_agency_atomic(
       'Org Solo Publicidad 83'::text,
       'org-solo-publicidad-83'::text,
       null::text, null::text, null::text,
       '00000000-0000-0000-0000-000000468301'::uuid,
       '00000000-0000-0000-0000-000000468311'::uuid,
       null::text, null::integer,
       false, true, 'otro'::advertiser_category
     ) $$,
  'CAP1_la_rpc_acepta_can_publish_properties_false_can_advertise_true_advertiser_category_sin_lanzar_excepcion_crea_la_organizacion_solo_publicidad'
);

-- ── 8.3) CAP2-CAP4 — el owner de una org solo-publicidad NO puede publicar ──
-- Fixture sembrado DIRECTO (no vía la RPC, que aún no acepta estos params en
-- RED) para aislar el guard bajo prueba: publish_property_atomic.
-- Reconciliado 168.7 (2026-08-16): can_advertise=true ahora exige
-- advertiser_category no nula (agencies_categoria_requerida_para_anunciar,
-- 20260816000003) -- se agrega la categoría al INSERT directo para seguir
-- pudiendo sembrar la org solo-publicidad; CAP2-CAP4 siguen probando
-- EXACTAMENTE lo mismo (el guard AGENCY_CANNOT_PUBLISH_PROPERTIES sobre
-- publish_property_atomic), ajeno a advertiser_category.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000468321', 'owner_bloqueado_publicar_83@urbea.mx');
update public.users set role = 'agent' where id = '00000000-0000-0000-0000-000000468321';
insert into public.agencies (id, name, slug, status, created_by_user_id, can_publish_properties, can_advertise, advertiser_category) values
  ('00000000-0000-0000-0000-000000468322', 'Inmobiliaria Solo Publicidad 83', 'inmo-solo-publicidad-83', 'active',
   '00000000-0000-0000-0000-000000468321', false, true, 'otro');
insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000468322', '00000000-0000-0000-0000-000000468321', 'owner', 'active');
insert into public.property_videos (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url) values
  ('00000000-0000-0000-0000-000000468323', null, '00000000-0000-0000-0000-000000468321', 'ready', 1,
   'cfuid-83-solopublicidad', 'https://upload.example/solo-publicidad-83');

select throws_ok(
  $$
    select property_id from public.publish_property_atomic(
      p_user_id             => '00000000-0000-0000-0000-000000468321'::uuid,
      p_operation_type      => 'rent',
      p_property_type       => 'departamento',
      p_price               => 9500.00,
      p_address             => 'Calle Solo Publicidad 83',
      p_lat                 => 20.6,
      p_lng                 => -103.6,
      p_cloudflare_uid      => 'cfuid-83-solopublicidad'
    )
  $$,
  'P0001', 'AGENCY_CANNOT_PUBLISH_PROPERTIES',
  'CAP2_el_owner_de_una_organizacion_solo_publicidad_recibe_error_explicito_agency_cannot_publish_properties_al_intentar_publicar_no_un_fallo_generico'
);

select is(
  (select count(*)::int from public.properties where owner_user_id = '00000000-0000-0000-0000-000000468321'),
  0,
  'CAP3_atomicidad_del_bloqueo_no_quedo_ninguna_propiedad_creada_tras_el_intento_bloqueado'
);
select is(
  (select property_id from public.property_videos where id = '00000000-0000-0000-0000-000000468323'),
  null,
  'CAP4_atomicidad_del_bloqueo_el_video_en_vuelo_sigue_sin_enlazar_tras_el_intento_bloqueado'
);

-- ── 8.4) CHECK1 — (false, false) vía la RPC lo rechaza el mismo CHECK ───────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000468331', 'owner_check_rpc_83@urbea.mx');

select throws_ok(
  $$ select agency_id from public.admin_create_agency_atomic(
       'Org Sin Capacidad 83'::text,
       'org-sin-capacidad-83'::text,
       null::text, null::text, null::text,
       '00000000-0000-0000-0000-000000468301'::uuid,
       '00000000-0000-0000-0000-000000468331'::uuid,
       null::text, null::integer,
       false, false
     ) $$,
  '23514',
  'new row for relation "agencies" violates check constraint "agencies_al_menos_una_capacidad"',
  'CHECK1_la_rpc_no_enmascara_el_check_agencies_al_menos_una_capacidad_al_recibir_false_false_mismo_mensaje_explicito_que_el_update_directo'
);

-- ── 8.5) OVERLOAD1 — exactamente UNA sobrecarga en pg_proc, con 12 params ───
select ok(
  (
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'admin_create_agency_atomic') = 1
    and
    (select pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'admin_create_agency_atomic' limit 1) = 12
  ),
  'OVERLOAD1_admin_create_agency_atomic_tiene_exactamente_UNA_sobrecarga_en_pg_proc_con_12_parametros_dos_sobrecargas_dejarian_la_llamada_por_postgrest_ambigua'
);

-- ── 8.6) NO-REGRESIÓN — publish_property_atomic (20260809000006 vigente):
--         AGENCY_MEMBERSHIP_SUSPENDED y p_price_visible sobreviven intactos
--         al create-or-replace de (b). PASAN hoy por diseño (comportamiento
--         YA vigente en producción) — son la red de seguridad, no capacidad
--         nueva; mismo patrón que la sección 6 de este archivo.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000468341', 'agente_suspendido_noregresion_83@urbea.mx'),
  ('00000000-0000-0000-0000-000000468342', 'agente_pricevisible_noregresion_83@urbea.mx');
update public.users set role = 'agent'
  where id in ('00000000-0000-0000-0000-000000468341', '00000000-0000-0000-0000-000000468342');

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000468343', 'Inmobiliaria Suspendida NoRegresion 83', 'inmo-suspendida-noregresion-83', 'active',
   '00000000-0000-0000-0000-000000468341');
insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000468343', '00000000-0000-0000-0000-000000468341', 'owner', 'suspended');
insert into public.property_videos (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url) values
  ('00000000-0000-0000-0000-000000468344', null, '00000000-0000-0000-0000-000000468341', 'ready', 1,
   'cfuid-83-suspendido-noregresion', 'https://upload.example/suspendido-noregresion-83');

-- ── NOREG1 ───────────────────────────────────────────────────────────────────
select throws_ok(
  $$
    select property_id from public.publish_property_atomic(
      p_user_id             => '00000000-0000-0000-0000-000000468341'::uuid,
      p_operation_type      => 'rent',
      p_property_type       => 'departamento',
      p_price               => 7200.00,
      p_address             => 'Calle Suspendido NoRegresion 83',
      p_lat                 => 19.7,
      p_lng                 => -99.7,
      p_cloudflare_uid      => 'cfuid-83-suspendido-noregresion'
    )
  $$,
  'P0001', 'AGENCY_MEMBERSHIP_SUSPENDED',
  'NOREG1_el_guard_agency_membership_suspended_de_20260809000006_sigue_vivo_no_se_pierde_al_agregar_el_guard_nuevo'
);

insert into public.property_videos (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url) values
  ('00000000-0000-0000-0000-000000468345', null, '00000000-0000-0000-0000-000000468342', 'ready', 1,
   'cfuid-83-pricevisible-false-noregresion', 'https://upload.example/pricevisible-false-noregresion-83'),
  ('00000000-0000-0000-0000-000000468346', null, '00000000-0000-0000-0000-000000468342', 'ready', 2,
   'cfuid-83-pricevisible-default-noregresion', 'https://upload.example/pricevisible-default-noregresion-83');

create temp table result_pricevisible_false_83 (property_id uuid);
insert into result_pricevisible_false_83 (property_id)
select property_id from public.publish_property_atomic(
  p_user_id             => '00000000-0000-0000-0000-000000468342'::uuid,
  p_operation_type      => 'rent',
  p_property_type       => 'departamento',
  p_price               => 6600.00,
  p_address             => 'Calle Price Visible False NoRegresion 83',
  p_lat                 => 19.8,
  p_lng                 => -99.8,
  p_cloudflare_uid      => 'cfuid-83-pricevisible-false-noregresion',
  p_price_visible       => false
);

-- ── NOREG2 ───────────────────────────────────────────────────────────────────
select is(
  (select price_visible from public.properties where id = (select property_id from result_pricevisible_false_83)),
  false,
  'NOREG2_el_guard_de_precio_visible_de_20260809000006_sigue_vivo_p_price_visible_false_llega_a_la_fila_real'
);

create temp table result_pricevisible_default_83 (property_id uuid);
insert into result_pricevisible_default_83 (property_id)
select property_id from public.publish_property_atomic(
  p_user_id             => '00000000-0000-0000-0000-000000468342'::uuid,
  p_operation_type      => 'rent',
  p_property_type       => 'departamento',
  p_price               => 6700.00,
  p_address             => 'Calle Price Visible Default NoRegresion 83',
  p_lat                 => 19.9,
  p_lng                 => -99.9,
  p_cloudflare_uid      => 'cfuid-83-pricevisible-default-noregresion'
);

-- ── NOREG3 ───────────────────────────────────────────────────────────────────
select is(
  (select price_visible from public.properties where id = (select property_id from result_pricevisible_default_83)),
  true,
  'NOREG3_el_guard_de_precio_visible_de_20260809000006_sigue_vivo_p_price_visible_omitido_sigue_defaulteando_a_true'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 9) No-regresión — publish_property_atomic (20260815000004, tarea #167,
--    YA DESPLEGADA en producción: hizo backfill real de las 20 propiedades
--    existentes). Ampliación 2026-08-16: cuando 168.3 corra su create-or-
--    replace sobre publish_property_atomic para meter el guard
--    AGENCY_CANNOT_PUBLISH_PROPERTIES, el punto de partida vigente YA NO es
--    20260809000006 (17 params) sino 20260815000004 (20 params) — si el
--    cuerpo se reescribe desde la versión vieja, los 3 params del wizard
--    (p_built_square_meters, p_half_bathrooms, p_currency) desaparecen en
--    silencio y las propiedades que YA los tienen guardados en producción
--    quedan huérfanas de la columna que las alimenta. Estos asserts PASAN
--    hoy por diseño (comportamiento ya vigente) — son la red de seguridad
--    para el create-or-replace de 168.3, no capacidad nueva; mismo patrón
--    que las secciones 6 y 8.6 de este mismo archivo.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ────────────────
-- Firma (catálogo, no basta solo esto — un create-or-replace puede conservar
-- la firma y tirar el cuerpo):
--   · SIG1: publish_property_atomic tiene EXACTAMENTE una sobrecarga en
--     pg_proc, con 20 parámetros — ni el overload viejo de 17 args queda
--     huérfano, ni el nuevo guard bifurca la firma en dos funciones.
--   · SIG2: los 3 params nuevos de 167 siguen presentes AL FINAL de la firma
--     con su tipo y DEFAULT literal exactos (p_built_square_meters numeric
--     default null, p_half_bathrooms integer default null, p_currency text
--     default 'MXN') — valor esperado tomado literal de la migración
--     20260815000004 vigente, no recalculado.
-- Comportamiento (la firma sola no caza un cuerpo que ignore los params):
--   · NOREG4: pasando los 3 valores explícitos (built_square_meters,
--     half_bathrooms, currency='USD'), publish_property_atomic los persiste
--     tal cual en la fila real de properties.
--   · NOREG5: built_square_meters/half_bathrooms omitidos (currency='USD'
--     explícito, para aislar este default del de currency) -> ambos quedan
--     null en la fila real.
--   · NOREG6: p_currency omitido (built_square_meters/half_bathrooms
--     explícitos, para aislar este default) -> la fila real queda en 'MXN'
--     — el MISMO default que hizo el backfill de las 20 propiedades ya en
--     producción; si 168.3 lo pierde, esas 20 filas quedan sin ancla de
--     comportamiento esperado hacia adelante.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 9.1) SIG1 — exactamente UNA sobrecarga en pg_proc, con 20 params ───────
select ok(
  (
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'publish_property_atomic') = 1
    and
    (select pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'publish_property_atomic' limit 1) = 20
  ),
  'SIG1_publish_property_atomic_tiene_exactamente_UNA_sobrecarga_en_pg_proc_con_20_parametros_el_create_or_replace_de_168_3_no_debe_dejar_huerfano_el_overload_viejo_de_17_args_ni_bifurcar_la_firma'
);

-- ── 9.2) SIG2 — los 3 params del wizard (167) siguen AL FINAL de la firma,
--         con tipo y DEFAULT literal exactos (valor esperado tomado de
--         20260815000004, no recalculado) ─────────────────────────────────
select ok(
  coalesce(
    (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'publish_property_atomic' and p.pronargs = 20),
    ''
  ) like
    '%p_built_square_meters numeric DEFAULT NULL::numeric, '
    || 'p_half_bathrooms integer DEFAULT NULL::integer, '
    || 'p_currency text DEFAULT ''MXN''::text',
  'SIG2_los_3_parametros_del_wizard_de_167_p_built_square_meters_p_half_bathrooms_p_currency_siguen_al_final_de_la_firma_con_tipo_y_default_exactos_incluyendo_default_MXN_tras_el_create_or_replace_de_168_3'
);

-- ── 9.3) NOREG4 — happy path: los 3 valores explícitos se persisten ────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000468351', 'agente_wizard_full_noregresion_83@urbea.mx');
update public.users set role = 'agent' where id = '00000000-0000-0000-0000-000000468351';
insert into public.property_videos (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url) values
  ('00000000-0000-0000-0000-000000468352', null, '00000000-0000-0000-0000-000000468351', 'ready', 1,
   'cfuid-83-wizard-full-noregresion', 'https://upload.example/wizard-full-noregresion-83');

create temp table result_wizard_full_83 (property_id uuid);
insert into result_wizard_full_83 (property_id)
select property_id from public.publish_property_atomic(
  p_user_id              => '00000000-0000-0000-0000-000000468351'::uuid,
  p_operation_type       => 'sale',
  p_property_type        => 'casa',
  p_price                => 2450000.00,
  p_address              => 'Calle Wizard Full NoRegresion 83',
  p_lat                  => 20.65,
  p_lng                  => -103.35,
  p_cloudflare_uid       => 'cfuid-83-wizard-full-noregresion',
  p_built_square_meters  => 210.75,
  p_half_bathrooms       => 2,
  p_currency             => 'USD'
);

select is(
  (select row(built_square_meters, half_bathrooms, currency)::text
     from public.properties
    where id = (select property_id from result_wizard_full_83)),
  '(210.75,2,USD)',
  'NOREG4_los_3_campos_del_wizard_de_167_built_square_meters_half_bathrooms_currency_se_siguen_persistiendo_en_la_fila_real_tras_el_create_or_replace_de_168_3'
);

-- ── 9.4) NOREG5 — built_square_meters/half_bathrooms omitidos -> null,
--         aislado con currency explícito para no depender del default de
--         currency ──────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000468361', 'agente_wizard_omiteBH_noregresion_83@urbea.mx');
update public.users set role = 'agent' where id = '00000000-0000-0000-0000-000000468361';
insert into public.property_videos (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url) values
  ('00000000-0000-0000-0000-000000468362', null, '00000000-0000-0000-0000-000000468361', 'ready', 1,
   'cfuid-83-wizard-omiteBH-noregresion', 'https://upload.example/wizard-omiteBH-noregresion-83');

create temp table result_wizard_omiteBH_83 (property_id uuid);
insert into result_wizard_omiteBH_83 (property_id)
select property_id from public.publish_property_atomic(
  p_user_id         => '00000000-0000-0000-0000-000000468361'::uuid,
  p_operation_type  => 'sale',
  p_property_type   => 'casa',
  p_price           => 1980000.00,
  p_address         => 'Calle Wizard Omite BH NoRegresion 83',
  p_lat             => 20.66,
  p_lng             => -103.36,
  p_cloudflare_uid  => 'cfuid-83-wizard-omiteBH-noregresion',
  p_currency        => 'USD'
  -- p_built_square_meters / p_half_bathrooms omitidos a propósito
);

select is(
  (select row(built_square_meters, half_bathrooms, currency)::text
     from public.properties
    where id = (select property_id from result_wizard_omiteBH_83)),
  '(,,USD)',
  'NOREG5_p_built_square_meters_p_half_bathrooms_omitidos_siguen_quedando_null_en_la_fila_real_aislado_de_currency_tras_el_create_or_replace_de_168_3'
);

-- ── 9.5) NOREG6 — p_currency omitido -> default 'MXN' (el MISMO default
--         que hizo el backfill de las 20 propiedades ya en producción),
--         aislado con built_square_meters/half_bathrooms explícitos ──────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000468371', 'agente_wizard_omiteCurrency_noregresion_83@urbea.mx');
update public.users set role = 'agent' where id = '00000000-0000-0000-0000-000000468371';
insert into public.property_videos (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url) values
  ('00000000-0000-0000-0000-000000468372', null, '00000000-0000-0000-0000-000000468371', 'ready', 1,
   'cfuid-83-wizard-omiteCurrency-noregresion', 'https://upload.example/wizard-omiteCurrency-noregresion-83');

create temp table result_wizard_omiteCurrency_83 (property_id uuid);
insert into result_wizard_omiteCurrency_83 (property_id)
select property_id from public.publish_property_atomic(
  p_user_id              => '00000000-0000-0000-0000-000000468371'::uuid,
  p_operation_type       => 'sale',
  p_property_type        => 'casa',
  p_price                => 3100000.00,
  p_address              => 'Calle Wizard Omite Currency NoRegresion 83',
  p_lat                  => 20.67,
  p_lng                  => -103.37,
  p_cloudflare_uid       => 'cfuid-83-wizard-omiteCurrency-noregresion',
  p_built_square_meters  => 305,
  p_half_bathrooms       => 1
  -- p_currency omitido a propósito
);

select is(
  (select row(built_square_meters, half_bathrooms, currency)::text
     from public.properties
    where id = (select property_id from result_wizard_omiteCurrency_83)),
  '(305,1,MXN)',
  'NOREG6_p_currency_omitido_sigue_defaulteando_a_MXN_el_mismo_default_que_hizo_el_backfill_de_las_20_propiedades_ya_en_produccion_tras_el_create_or_replace_de_168_3'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 10) subtarea #168.7 — CHECK: encender can_advertise exige advertiser_category
--     (RED 2026-08-16, checkpoint tras 168.4 — hallazgo del guardian de 168.2:
--     advertiser_category = p_category es INCONDICIONAL en
--     20260815000002_set_org_advertising_rpc.sql:71-73, así que
--     set_org_advertising_atomic(id, true) SIN p_category deja can_advertise=true
--     con categoría NULL -- el estado que 169-171 no pueden servir).
--
-- SUT (AÚN NO EXISTE, RED 2026-08-16): una migración GREEN debe:
--   (a) agregar sobre public.agencies un CHECK NOMBRADO
--       agencies_categoria_requerida_para_anunciar
--       check (not (can_advertise and advertiser_category is null))
--       -- mismo patrón/estilo que 20260815000001, constraint
--       agencies_al_menos_una_capacidad (mensaje de Postgres verificado
--       literal, no solo "algo truena").
--   (b) la RPC public.set_org_advertising_atomic debe validar ANTES de tocar
--       la fila: si p_enabled = true y p_category is null -> RAISE explícito
--       'ADVERTISER_CATEGORY_REQUIRED' con errcode P0001 (mismo criterio que
--       AGENCY_NOT_FOUND en la misma función), para que el caller nunca vea un
--       23514 crudo del constraint ni deje la fila en un estado a medio
--       actualizar.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ────────────────
-- Boundary / error (los invariantes que cierran el hueco):
--   · CATREQ1: can_advertise=true + advertiser_category NULL es rechazado por
--     el CHECK, con el mensaje EXACTO de Postgres (nombra la relación y el
--     constraint, igual que agencies_al_menos_una_capacidad) -- no basta con
--     que truene, el mensaje discrimina ESTE constraint de cualquier otro.
--   · CATREQ2: can_advertise=true + categoría no nula SÍ pasa el CHECK.
--   🔴 Protege producción:
--   · CATREQ3: can_advertise=false + categoría NULL sigue siendo válido -- es
--     el estado por defecto de TODA fila preexistente (las agencies reales de
--     hoy). Si este assert falla, el CHECK rompe producción.
--   · CATREQ4: apagar can_advertise en una organización que YA tenía categoría
--     asignada (categoría no nula, ahora inactiva) no truena -- el CHECK solo
--     restringe la combinación (true, null), no (false, no-null).
--   · CATREQ5-7: la RPC set_org_advertising_atomic(id, true) SIN p_category da
--     un error EXPLÍCITO propio (P0001 'ADVERTISER_CATEGORY_REQUIRED'), no un
--     23514 crudo del constraint ni un no-op silencioso -- y no deja NINGÚN
--     efecto parcial (ni can_advertise encendido ni fila de auditoría), para
--     no caer en el vacuo de solo verificar "el estado no cambió" sobre una
--     llamada que ya se sabe que falla.
--   · CATREQ8 (reconciliación de fixtures, 2026-08-16): reproduce LITERAL el
--     fixture que el assert 18 (sección 3) usaba antes de este CHECK --
--     (can_publish_properties=false, can_advertise=true, advertiser_category
--     NULL) -- y confirma que ahora es rechazado. No es redundante con
--     CATREQ1 (que deja can_publish_properties en su default true): prueba
--     que el caso viejo concreto dejó de ser legal A PROPÓSITO por este
--     CHECK, no por accidente de otro constraint.
-- ════════════════════════════════════════════════════════════════════════════

-- ⚠️ Fixture pegajoso (ya mordió dos veces en este archivo, FI3/INV4 de la
-- sección 7): el trigger "veneno" de la sección 7.4 se dropea en la sección 8
-- (línea ~625) mucho antes de llegar aquí -- pero se re-dropea de forma
-- defensiva (if exists, idempotente) porque CATREQ5-7 llaman la RPC, que
-- audita en admin_actions.
drop trigger if exists poison_admin_actions_before_insert on public.admin_actions;

-- ── CATREQ1) can_advertise=true + advertiser_category NULL -> rechazado ────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000461001', 'owner_catreq1_46@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000461002', 'Inmobiliaria Catreq1 46', 'inmo-catreq1-46', 'active',
   '00000000-0000-0000-0000-000000461001');

select throws_ok(
  $$ update public.agencies set can_advertise = true
     where id = '00000000-0000-0000-0000-000000461002' $$,
  '23514',
  'new row for relation "agencies" violates check constraint "agencies_categoria_requerida_para_anunciar"',
  'CATREQ1_can_advertise_true_con_advertiser_category_null_es_rechazado_por_el_check_con_mensaje_explicito'
);

-- ── CATREQ2) can_advertise=true + categoría no nula -> SÍ pasa el CHECK ────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000461011', 'owner_catreq2_46@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000461012', 'Inmobiliaria Catreq2 46', 'inmo-catreq2-46', 'active',
   '00000000-0000-0000-0000-000000461011');

select lives_ok(
  $$ update public.agencies set can_advertise = true, advertiser_category = 'otro'
     where id = '00000000-0000-0000-0000-000000461012' $$,
  'CATREQ2_can_advertise_true_con_categoria_no_nula_pasa_el_check'
);

-- ── CATREQ3) 🔴 protege producción: can_advertise=false + categoría NULL
--            sigue siendo válido -- el default de TODA fila preexistente ────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000461021', 'owner_catreq3_46@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000461022', 'Inmobiliaria Catreq3 46', 'inmo-catreq3-46', 'active',
   '00000000-0000-0000-0000-000000461021');

select lives_ok(
  $$ update public.agencies set name = 'Inmobiliaria Catreq3 46 Renombrada'
     where id = '00000000-0000-0000-0000-000000461022' $$,
  'CATREQ3_can_advertise_false_con_advertiser_category_null_sigue_siendo_valido_estado_por_defecto_de_toda_fila_preexistente_si_esto_falla_se_rompe_produccion'
);

-- ── CATREQ4) apagar can_advertise en una org que YA tenía categoría no truena ─
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000461031', 'owner_catreq4_46@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id, can_advertise, advertiser_category) values
  ('00000000-0000-0000-0000-000000461032', 'Inmobiliaria Catreq4 46', 'inmo-catreq4-46', 'active',
   '00000000-0000-0000-0000-000000461031', true, 'mudanzas');

select lives_ok(
  $$ update public.agencies set can_advertise = false
     where id = '00000000-0000-0000-0000-000000461032' $$,
  'CATREQ4_apagar_can_advertise_en_una_organizacion_que_tenia_categoria_asignada_no_truena'
);

-- ── CATREQ5-7) la RPC sin p_category da error EXPLÍCITO propio, no 23514
--              crudo ni estado inválido, y sin efectos parciales ───────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000461041', 'owner_catreq5_46@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000461042', 'Inmobiliaria Catreq5 46', 'inmo-catreq5-46', 'active',
   '00000000-0000-0000-0000-000000461041');

-- Reusa el admin_id ya sembrado en la sección 7.3 (460401, role='admin').
select pg_temp.act_as('00000000-0000-0000-0000-000000460401', 'service_role');
select throws_ok(
  $$ select public.set_org_advertising_atomic('00000000-0000-0000-0000-000000461042'::uuid, true) $$,
  'P0001',
  'ADVERTISER_CATEGORY_REQUIRED',
  'CATREQ5_set_org_advertising_atomic_sin_p_category_da_error_explicito_p0001_advertiser_category_required_no_un_23514_crudo_del_constraint'
);
reset role;

select is(
  (select can_advertise from public.agencies where id = '00000000-0000-0000-0000-000000461042'),
  false,
  'CATREQ6_tras_el_error_explicito_can_advertise_no_quedo_encendido_sin_efecto_parcial'
);
select is(
  (select count(*)::int from public.admin_actions where entity_id = '00000000-0000-0000-0000-000000461042'),
  0,
  'CATREQ7_tras_el_error_explicito_no_quedo_ninguna_fila_de_auditoria_huerfana'
);

-- ── CATREQ8) reconciliación 168.7: el fixture LITERAL viejo de assert 18
--            (false, true, categoría NULL) ahora es rechazado A PROPÓSITO ──
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000461051', 'owner_catreq8_46@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000461052', 'Inmobiliaria Catreq8 46', 'inmo-catreq8-46', 'active',
   '00000000-0000-0000-0000-000000461051');

select throws_ok(
  $$ update public.agencies set can_publish_properties = false, can_advertise = true
     where id = '00000000-0000-0000-0000-000000461052' $$,
  '23514',
  'new row for relation "agencies" violates check constraint "agencies_categoria_requerida_para_anunciar"',
  'CATREQ8_el_fixture_literal_viejo_del_assert_18_false_true_categoria_null_ahora_es_rechazado_a_proposito_no_por_accidente'
);

select * from finish();
rollback;
