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
select plan(48);

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
select is(
  (select count(*)::int from public.admin_actions where entity_id = '00000000-0000-0000-0000-000000460432'),
  0,
  'FI3_atomicidad_no_quedo_ninguna_fila_huerfana_en_admin_actions_para_esta_agencia'
);

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

select * from finish();
rollback;
