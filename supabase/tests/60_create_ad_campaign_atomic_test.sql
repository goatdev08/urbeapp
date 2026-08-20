-- Tests pgTAP — RPC public.create_ad_campaign_atomic (tarea #191, subtarea 170.10).
-- Ejecutar con:
--   supabase test db supabase/tests/60_create_ad_campaign_atomic_test.sql --local
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL HUECO: no existía NINGUNA ruta para que un anunciante creara el registro
-- de su campaña. `public.ads` solo tiene `grant select ... to authenticated` y
-- su única policy es `ads_select` — sin policy de INSERT, a propósito
-- ("exclusivo de RPC/EF security definer futura"). Y grant_ad_slot_atomic está
-- revoke'd de authenticated: la invoca el admin desde Studio.
-- Resultado: el wizard de 169.9 recogía título, CTA y zonas que no tenían
-- dónde ir, y su paso final avisaba que el envío no estaba disponible.
--
-- SIMETRÍA con grant_ad_slot_atomic (169.3), con dos diferencias que son el
-- punto entero de esta RPC:
--   1. El caller es `authenticated`, no service_role.
--   2. 🔒 LA AGENCIA NO ES UN PARÁMETRO. Se resuelve del JWT del caller. Si
--      viajara como argumento, cualquiera podría crear campañas a nombre de
--      otra organización — el mismo vector que #193 eliminó derivando el id
--      server-side en vez de blindar el del cliente.
--
-- REQUISITOS YA FIJADOS por el resto de la épica, que aquí NO se re-litigan:
--   · El ad nace en 'pending_review', NUNCA en 'active'. Activar es exclusivo
--     del admin (el trigger de 169.2 exige private.resolve_admin_actor()).
--   · Guard AGENCY_CANNOT_ADVERTISE reusando private.org_can_advertise, LLAMADA
--     DESDE DENTRO — el wrapper public está revoke'd a authenticated
--     (20260816000008) y esta RPC no puede exponerlo.
--   · p_zones vacío = inventario NACIONAL, no error de input (D3 de 169.1).
--   · Atomicidad total: ad + ad_zones, o nada.
--
-- ── Edge cases enumerados ───────────────────────────────────────────────────
--  META1-4 firma exacta, security definer, search_path fijo, grants.
--  PERM1   anon no puede ejecutar (42501).
--  HAPPY1  owner crea → devuelve uuid y la fila existe.
--  HAPPY2  🔴 nace en 'pending_review', NUNCA en 'active'.
--  HAPPY3  la agencia es la DEL CALLER (no hay parámetro que la elija).
--  HAPPY4  created_by_user_id = el caller.
--  HAPPY5  título/cta/description tal cual, sin transformar.
--  HAPPY6  admin de la organización también puede.
--  ZONE1   municipio y colonia se persisten en ad_zones.
--  ZONE2   p_zones '[]' → CERO filas en ad_zones (nacional), sin error.
--  ZONE3   p_zones null → igual que '[]'.
--  DENY1   member_role='agent' → NOT_AGENCY_MANAGER.
--  DENY2   sin membresía → NOT_AGENCY_MANAGER.
--  DENY3   membresía suspendida → NOT_AGENCY_MANAGER.
--  DENY4   can_advertise=false → AGENCY_CANNOT_ADVERTISE.
--  DENY5   🔒 creativo de OTRA agencia → CREATIVE_NOT_FOUND (no se roba).
--  DENY6   creativo que no está 'ready' → CREATIVE_NOT_FOUND.
--  ATOM1   zona inválida (municipio Y colonia) → revienta y CERO ads nuevos.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(21);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) Fixtures — state '60', fuera del rango real INEGI.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.mx_states (id, name, abbr) values ('60', 'Estado Self Service 60', 'SS');
insert into public.mx_municipalities (id, state_id, name) values ('60001', '60', 'Municipio Self Service 60');
insert into public.mx_neighborhoods (source_key, municipality_id, name, geom) values
  ('test-selfservice-60-001', '60001', 'Colonia Self Service 60',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-99.30, 19.30, -99.28, 19.32, 4326))::extensions.geography);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000600001', 'owner_ss60@urbea.mx'),
  ('00000000-0000-0000-0000-000000600002', 'admin_ss60@urbea.mx'),
  ('00000000-0000-0000-0000-000000600003', 'agente_ss60@urbea.mx'),
  ('00000000-0000-0000-0000-000000600004', 'sin_membresia_ss60@urbea.mx'),
  ('00000000-0000-0000-0000-000000600005', 'inactivo_ss60@urbea.mx'),
  ('00000000-0000-0000-0000-000000600006', 'owner_sin_capacidad_ss60@urbea.mx'),
  ('00000000-0000-0000-0000-000000600007', 'owner_ajeno_ss60@urbea.mx');

-- Agencia A: puede anunciarse.
insert into public.agencies (id, name, slug, status, created_by_user_id, can_advertise, advertiser_category) values
  ('00000000-0000-0000-0000-000000600101', 'Inmobiliaria Self Service 60', 'inmo-ss-60', 'active',
   '00000000-0000-0000-0000-000000600001', true, 'otro'),
-- Agencia B: NO puede anunciarse (can_advertise=false).
  ('00000000-0000-0000-0000-000000600102', 'Inmobiliaria Sin Capacidad 60', 'inmo-sincap-60', 'active',
   '00000000-0000-0000-0000-000000600006', false, null),
-- Agencia C: ajena, para el robo de creativo.
  ('00000000-0000-0000-0000-000000600103', 'Inmobiliaria Ajena 60', 'inmo-ajena-60', 'active',
   '00000000-0000-0000-0000-000000600007', true, 'otro');

insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000600101', '00000000-0000-0000-0000-000000600001', 'owner',  'active'),
  ('00000000-0000-0000-0000-000000600101', '00000000-0000-0000-0000-000000600002', 'admin',  'active'),
  ('00000000-0000-0000-0000-000000600101', '00000000-0000-0000-0000-000000600003', 'agent',  'active'),
  ('00000000-0000-0000-0000-000000600101', '00000000-0000-0000-0000-000000600005', 'owner',  'suspended'),
  ('00000000-0000-0000-0000-000000600102', '00000000-0000-0000-0000-000000600006', 'owner',  'active'),
  ('00000000-0000-0000-0000-000000600103', '00000000-0000-0000-0000-000000600007', 'owner',  'active');

insert into public.ad_creatives (id, agency_id, cloudflare_uid, status) values
  ('00000000-0000-0000-0000-000000600201', '00000000-0000-0000-0000-000000600101', 'cf-ss60-ready',  'ready'),
  ('00000000-0000-0000-0000-000000600202', '00000000-0000-0000-0000-000000600101', 'cf-ss60-ready2', 'ready'),
  ('00000000-0000-0000-0000-000000600203', '00000000-0000-0000-0000-000000600101', null,             'processing'),
  ('00000000-0000-0000-0000-000000600204', '00000000-0000-0000-0000-000000600103', 'cf-ss60-ajeno',  'ready'),
  ('00000000-0000-0000-0000-000000600205', '00000000-0000-0000-0000-000000600102', 'cf-ss60-sincap', 'ready');

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Metadata — catálogo puro, nunca lanza aunque la función no exista.
-- ════════════════════════════════════════════════════════════════════════════

select has_function(
  'public', 'create_ad_campaign_atomic',
  array['uuid', 'text', 'ad_cta_type', 'text', 'jsonb', 'text', 'integer'],
  'META1_create_ad_campaign_atomic_existe_con_la_firma_exacta'
);

select is(
  (select prosecdef from pg_proc join pg_namespace ns on pg_proc.pronamespace = ns.oid
    where ns.nspname = 'public' and pg_proc.proname = 'create_ad_campaign_atomic' limit 1),
  true,
  'META2_debe_ser_security_definer'
);

select is(
  exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    cross join lateral unnest(coalesce(p.proconfig, array[]::text[])) as cfg(setting)
    where ns.nspname = 'public' and p.proname = 'create_ad_campaign_atomic'
      and cfg.setting like 'search_path=%'
  ),
  true,
  'META3_fija_search_path_explicito'
);

-- 🔒 A DIFERENCIA de grant_ad_slot_atomic, ESTA sí la invoca el cliente.
-- Se consulta el ACL por CATÁLOGO, no con has_function_privilege sobre un
-- literal regprocedure: ese lanza 42883 si la función no existe y ABORTA la
-- transacción, con lo que el resto del archivo no llega a correr (gotcha
-- heredado de 47/48/51/52_*, "RED sin abortar la transacción").
select is(
  exists (
    select 1
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname = 'create_ad_campaign_atomic'
       and array_to_string(p.proacl, ',') like '%authenticated=X%'
  ),
  true,
  'META4_authenticated_SI_puede_ejecutarla_es_el_punto_de_esta_RPC'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Permisos
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000600001', 'anon');
select throws_ok(
  $$ select public.create_ad_campaign_atomic(
       '00000000-0000-0000-0000-000000600201'::uuid, 'Campana Anon 60',
       'phone'::ad_cta_type, '+5213300000060', '[]'::jsonb, null, 30) $$,
  '42501',
  null,
  'PERM1_anon_no_puede_ejecutar_la_RPC'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Happy path — el owner crea su campaña
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_60 (ok boolean, ad_id uuid, err_sqlstate text, err_message text);

do $$
declare v_ad_id uuid;
begin
  perform pg_temp.act_as('00000000-0000-0000-0000-000000600001');
  v_ad_id := public.create_ad_campaign_atomic(
    '00000000-0000-0000-0000-000000600201'::uuid,
    'Créditos Self Service 60',
    'external_url'::ad_cta_type,
    'https://ejemplo.mx/ss60',
    jsonb_build_array(
      jsonb_build_object('municipality_id', '60001'),
      jsonb_build_object('neighborhood_id',
        (select id from public.mx_neighborhoods where source_key = 'test-selfservice-60-001'))
    ),
    'Descripción de la campaña 60',
    45
  );
  reset role;
  insert into result_60 (ok, ad_id) values (true, v_ad_id);
exception when others then
  reset role;
  insert into result_60 (ok, err_sqlstate, err_message) values (false, sqlstate, sqlerrm);
end $$;

select is(
  (select ok from result_60), true,
  'HAPPY1_no_lanza_en_el_happy_path -- ' || coalesce((select err_message from result_60), '')
);

select is(
  (select status::text from public.ads where id = (select ad_id from result_60)),
  'pending_review',
  'HAPPY2_el_ad_nace_en_pending_review_NUNCA_en_active'
);

select is(
  (select agency_id from public.ads where id = (select ad_id from result_60)),
  '00000000-0000-0000-0000-000000600101'::uuid,
  'HAPPY3_la_agencia_es_la_del_CALLER_no_un_parametro'
);

select is(
  (select created_by_user_id from public.ads where id = (select ad_id from result_60)),
  '00000000-0000-0000-0000-000000600001'::uuid,
  'HAPPY4_created_by_user_id_es_el_caller'
);

select is(
  (select title || '|' || cta_value || '|' || coalesce(description, '')
     from public.ads where id = (select ad_id from result_60)),
  'Créditos Self Service 60|https://ejemplo.mx/ss60|Descripción de la campaña 60',
  'HAPPY5_titulo_cta_y_description_tal_cual_sin_transformar'
);

select is(
  (select count(*)::int from public.ad_zones where ad_id = (select ad_id from result_60)),
  2,
  'ZONE1_las_dos_zonas_se_persisten'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Zonas: vacío = NACIONAL, no error
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_nat_60 (ok boolean, ad_id uuid, err_message text);

do $$
declare v_ad_id uuid;
begin
  perform pg_temp.act_as('00000000-0000-0000-0000-000000600002');  -- admin de la org
  v_ad_id := public.create_ad_campaign_atomic(
    '00000000-0000-0000-0000-000000600202'::uuid, 'Campana Nacional 60',
    'whatsapp'::ad_cta_type, '3312345678', '[]'::jsonb, null, 30);
  reset role;
  insert into result_nat_60 (ok, ad_id) values (true, v_ad_id);
exception when others then
  reset role;
  insert into result_nat_60 (ok, err_message) values (false, sqlerrm);
end $$;

select is(
  (select ok from result_nat_60), true,
  'HAPPY6_un_admin_de_la_organizacion_tambien_puede -- ' || coalesce((select err_message from result_nat_60), '')
);

select is(
  (select count(*)::int from public.ad_zones where ad_id = (select ad_id from result_nat_60)),
  0,
  'ZONE2_p_zones_vacio_es_inventario_NACIONAL_cero_filas_sin_error'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Denegaciones
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000600003');  -- agent, no manager
select throws_ok(
  $$ select public.create_ad_campaign_atomic('00000000-0000-0000-0000-000000600201'::uuid,
       'X', 'phone'::ad_cta_type, '3312345678', '[]'::jsonb, null, 30) $$,
  'P0001', 'NOT_AGENCY_MANAGER',
  'DENY1_member_role_agent_no_puede_crear_campanas'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000600004');  -- sin membresía
select throws_ok(
  $$ select public.create_ad_campaign_atomic('00000000-0000-0000-0000-000000600201'::uuid,
       'X', 'phone'::ad_cta_type, '3312345678', '[]'::jsonb, null, 30) $$,
  'P0001', 'NOT_AGENCY_MANAGER',
  'DENY2_sin_membresia_no_puede'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000600005');  -- membresía inactiva
select throws_ok(
  $$ select public.create_ad_campaign_atomic('00000000-0000-0000-0000-000000600201'::uuid,
       'X', 'phone'::ad_cta_type, '3312345678', '[]'::jsonb, null, 30) $$,
  'P0001', 'NOT_AGENCY_MANAGER',
  'DENY3_membresia_suspendida_no_puede'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000600006');  -- owner sin can_advertise
select throws_ok(
  $$ select public.create_ad_campaign_atomic('00000000-0000-0000-0000-000000600205'::uuid,
       'X', 'phone'::ad_cta_type, '3312345678', '[]'::jsonb, null, 30) $$,
  'P0001', 'AGENCY_CANNOT_ADVERTISE',
  'DENY4_agencia_sin_can_advertise_no_puede'
);
reset role;

-- 🔒 El vector más importante: usar el creativo de OTRA organización.
select pg_temp.act_as('00000000-0000-0000-0000-000000600001');
select throws_ok(
  $$ select public.create_ad_campaign_atomic('00000000-0000-0000-0000-000000600204'::uuid,
       'X', 'phone'::ad_cta_type, '3312345678', '[]'::jsonb, null, 30) $$,
  'P0001', 'CREATIVE_NOT_FOUND',
  'DENY5_no_se_puede_usar_un_creativo_de_OTRA_organizacion'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000600001');
select throws_ok(
  $$ select public.create_ad_campaign_atomic('00000000-0000-0000-0000-000000600203'::uuid,
       'X', 'phone'::ad_cta_type, '3312345678', '[]'::jsonb, null, 30) $$,
  'P0001', 'CREATIVE_NOT_FOUND',
  'DENY6_un_creativo_que_no_esta_ready_no_sirve'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Atomicidad — una zona inválida no deja el ad huérfano
-- ════════════════════════════════════════════════════════════════════════════

create temp table ads_before_60 as
  select count(*)::int as n from public.ads where agency_id = '00000000-0000-0000-0000-000000600101';

do $$
begin
  perform pg_temp.act_as('00000000-0000-0000-0000-000000600001');
  perform public.create_ad_campaign_atomic(
    '00000000-0000-0000-0000-000000600201'::uuid, 'Campana Zona Invalida 60',
    'phone'::ad_cta_type, '3312345678',
    -- municipio Y colonia a la vez: revienta el CHECK ad_zones_exactly_one_scope.
    jsonb_build_array(jsonb_build_object('municipality_id', '60001', 'neighborhood_id',
      (select id from public.mx_neighborhoods where source_key = 'test-selfservice-60-001'))),
    null, 30);
  reset role;
exception when others then
  reset role;
end $$;

select is(
  (select count(*)::int from public.ads where agency_id = '00000000-0000-0000-0000-000000600101'),
  (select n from ads_before_60),
  'ATOM1_una_zona_invalida_no_deja_el_ad_huerfano_todo_o_nada'
);

select * from finish();
rollback;
