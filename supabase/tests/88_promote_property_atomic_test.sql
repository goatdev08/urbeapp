-- Tests pgTAP — RPC public.promote_property_atomic (tarea #213, subtarea
-- 213.2). Ejecutar con:
--   supabase test db supabase/tests/88_promote_property_atomic_test.sql --local
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL PRODUCTO: "promocionar una publicación" (exploración 040, decisiones 2-5
-- de Abraham 2026-08-23). Un miembro con permiso de PUBLICAR de una
-- organización toma una propiedad YA activa y la manda a moderación como
-- anuncio: mismo video, badge «Anuncio», municipio heredado, 30 días fijos,
-- un solo paso. Gratis — el gate es la MODERACIÓN, no el pago.
--
-- 🔒 DOS PRODUCTOS, DOS GATES (modelo Meta: boost vs Ads Manager).
-- `can_advertise` es el gate del anuncio DISPLAY (creativo propio + CTA) y
-- NO tiene nada que ver aquí: una organización que solo publica propiedades
-- puede promocionarlas. El assert HAPPY11 fija eso contra la tentación de
-- "reusar" el guard de create_ad_campaign_atomic, que sería el bug silencioso
-- más fácil de introducir en esta RPC.
--
-- SEAM bajo prueba: el CONTRATO PÚBLICO de la RPC — firma, permisos, el código
-- de error de cada rechazo, y el estado que deja en `ads`/`ad_zones` observado
-- leyendo esas tablas. NO se inspecciona el cuerpo de la función.
--
-- SUT (AÚN NO EXISTE — RED 2026-09-01): la migración GREEN
-- supabase/migrations/20260903300002_promote_property_atomic.sql (+ rollback)
-- debe crear:
--
--   public.promote_property_atomic(p_property_id uuid) returns uuid
--   language plpgsql security definer set search_path = public, pg_temp
--   revoke execute from public, anon;  grant execute to authenticated;
--
--   Calca la estructura de create_ad_campaign_atomic (20260820000005):
--   🔒 nada que identifique al actor o a su organización viaja como parámetro
--   — la organización sale de la PROPIEDAD y el actor de `auth.uid()`.
--
--   CÓDIGOS (todos P0001, patrón de la épica):
--     NOT_AUTHENTICATED     · auth.uid() es NULL.
--     PROPERTY_NOT_FOUND    · un SOLO código para: no existe · soft-deleted ·
--       `agency_id is null` (publicación de agente independiente: promocionar
--       es un producto de ORGANIZACIONES) · el caller no es miembro con
--       permiso de publicar en esa organización. No se distingue "no existe"
--       de "no es tuya": el mismo criterio anti-enumeración que
--       CREATIVE_NOT_FOUND en create_ad_campaign_atomic.
--       El predicado de "miembro con permiso de publicar" es EL MISMO de la
--       policy properties_insert (20260805000009:144-150):
--         private.current_user_role() in ('agent','admin')
--         and private.agency_role_of(p.agency_id) is not null
--     AGENCY_CANNOT_PUBLISH · organización con can_publish_properties=false,
--       suspendida o soft-deleted (espejo de private.org_can_advertise, con
--       la capacidad de publicar en vez de la de anunciarse).
--     PROPERTY_NOT_PUBLISHED· p.status <> 'active'.
--     ALREADY_PROMOTED      · ya existe una promo ABIERTA de esa propiedad
--       (índice único parcial de 213.1). Se traduce del unique_violation, que
--       es el ÚNICO punto sin ventana de carrera: entre un `select ... if not
--       exists` y el INSERT de dos transacciones concurrentes no hay nada que
--       las ordene, y el doble tap en «Promocionar» es exactamente eso.
--     ZONE_UNRESOLVED       · resolve_ad_zone no devuelve municipio (la
--       propiedad cae fuera de toda cobertura). 🔒 NO se crea el ad: una promo
--       sin zona sería inventario NACIONAL (cero filas en ad_zones = nacional,
--       D3 de 169.1) — un anuncio gratis servido en todo el país.
--
--   EFECTO del camino feliz: 1 fila en `ads` (agency_id de la propiedad,
--   property_id, creative_id NULL, cta_type/cta_value/description NULL,
--   status 'pending_review', starts_at now(), ends_at now()+30d,
--   created_by_user_id = caller) + 1 fila en `ad_zones` con el municipio
--   heredado (neighborhood_id NULL: el alcance de la promo es MUNICIPAL,
--   decisión 5 — el selector de alcance llega con el cobro).
--
--   ⚠️ `properties` NO tiene columna `title` (verificado contra el esquema
--   vivo, 20260604000005 + migraciones posteriores). `ads.title` es NOT NULL,
--   así que la promo hereda `properties.address`, que es el identificador que
--   la publicación muestra en «Mis publicaciones» y en la cola de moderación.
--   Es dato de la propia organización: no expone nada que su miembro no vea ya.
--
-- ── Nota sobre la técnica RED sin abortar la transacción ────────────────────
-- Toda invocación de la RPC va por pg_temp.promote(), que atrapa la excepción
-- y devuelve 'SQLSTATE|mensaje'. En RED eso es '42883|function ... does not
-- exist' y el archivo sigue corriendo; con `select public.promote_...` crudo
-- el 42883 abortaría la transacción y ningún assert posterior se ejecutaría.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ────────────────
-- META1-7  firma exacta, retorno uuid, security definer, search_path fijo,
--          authenticated SÍ puede, anon NO aparece en el ACL.
-- PERM1    anon ejecutando → 42501.
-- AUTH1    authenticated sin JWT → NOT_AUTHENTICATED.
-- HAPPY1-11 devuelve uuid; nace en pending_review; property_id poblado y
--          creative_id NULL; agency_id heredado de la propiedad; created_by =
--          caller; cta/description NULL; ventana de 30 días; ad_zones con el
--          municipio heredado y sin colonia; title = address; un 'agent' de la
--          organización también puede; 🔒 can_advertise=false NO estorba.
-- DENY1-12 inexistente · soft-deleted · sin agency_id · de otra organización ·
--          sin membresía · membresía suspendida · users.role='user' →
--          PROPERTY_NOT_FOUND; can_publish_properties=false · organización
--          suspendida · organización soft-deleted → AGENCY_CANNOT_PUBLISH;
--          status draft · status paused → PROPERTY_NOT_PUBLISHED.
-- ALREADY1-2 segunda promo de la misma propiedad → ALREADY_PROMOTED; tras
--          rechazarla (estado terminal) se puede volver a promocionar.
-- ZONE1-2  fuera de cobertura → ZONE_UNRESOLVED Y cero filas nuevas en ads.
-- MOD1-3   moderate_ad_atomic aprueba la promo sin tocar creative_id y sin
--          perder su ad_zones (el resto de la épica opera por ad_id/agency_id).
-- RLS1-3   el miembro ve su promo en pending_review; un tercero NO; el tercero
--          SÍ cuando queda active y vigente (el feed la necesita cross-org).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(41);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- Invoca la RPC bajo el rol actual y devuelve 'ok|<uuid>' o 'SQLSTATE|mensaje'.
-- SECURITY INVOKER (el default) a propósito: el chequeo de EXECUTE y el
-- auth.uid() deben verse desde el rol impersonado, no desde postgres.
create or replace function pg_temp.promote(p_property_id uuid)
returns text language plpgsql as $$
declare v_id uuid;
begin
  v_id := public.promote_property_atomic(p_property_id);
  return 'ok|' || v_id::text;
exception when others then
  return sqlstate || '|' || sqlerrm;
end $$;

-- Resultados capturados bajo impersonación. El grant a public es lo que
-- permite escribir aquí mientras `set local role` está activo.
create temp table res_88 (k text primary key, v text);
grant insert, select, update on res_88 to public;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) Fixtures — state '88', fuera del rango real INEGI (01-32).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.mx_states (id, name, abbr) values ('88', 'Estado Promo 88', 'PP');
insert into public.mx_municipalities (id, state_id, name, bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng)
values ('88001', '88', 'Municipio Promo 88', 19.20, -99.50, 19.60, -99.00);
insert into public.mx_neighborhoods (source_key, municipality_id, name, geom) values
  ('test-promo-88-a1', '88001', 'Colonia Promo 88 A1',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-99.30, 19.30, -99.28, 19.32, 4326))::extensions.geography);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000880001', 'owner_a_promo88@urbea.mx'),
  ('00000000-0000-0000-0000-000000880003', 'agente_a_promo88@urbea.mx'),
  ('00000000-0000-0000-0000-000000880004', 'sin_membresia_promo88@urbea.mx'),
  ('00000000-0000-0000-0000-000000880005', 'suspendido_a_promo88@urbea.mx'),
  ('00000000-0000-0000-0000-000000880006', 'owner_b_promo88@urbea.mx'),
  ('00000000-0000-0000-0000-000000880007', 'rol_user_a_promo88@urbea.mx'),
  ('00000000-0000-0000-0000-000000880008', 'owner_c_promo88@urbea.mx'),
  ('00000000-0000-0000-0000-000000880009', 'owner_d_promo88@urbea.mx'),
  ('00000000-0000-0000-0000-000000880010', 'owner_e_promo88@urbea.mx'),
  ('00000000-0000-0000-0000-000000880011', 'admin_promo88@urbea.mx'),
  ('00000000-0000-0000-0000-000000880012', 'independiente_promo88@urbea.mx');

update public.users set role = 'agent' where id in (
  '00000000-0000-0000-0000-000000880001','00000000-0000-0000-0000-000000880003',
  '00000000-0000-0000-0000-000000880004','00000000-0000-0000-0000-000000880005',
  '00000000-0000-0000-0000-000000880006','00000000-0000-0000-0000-000000880008',
  '00000000-0000-0000-0000-000000880009','00000000-0000-0000-0000-000000880010',
  '00000000-0000-0000-0000-000000880012');
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000880011';
-- 880007 se queda con el default 'user': miembro activo de la organización
-- pero SIN el rol de plataforma que habilita publicar (DENY7).

insert into public.agencies (id, name, slug, status, created_by_user_id,
                             can_publish_properties, can_advertise, advertiser_category, deleted_at) values
  -- A: 🔒 publica pero NO puede anunciarse — el caso que prueba que los dos
  --    gates son independientes (HAPPY1..HAPPY11).
  ('00000000-0000-0000-0000-000000880101', 'Inmobiliaria A Promo 88', 'inmo-a-promo-88', 'active',
   '00000000-0000-0000-0000-000000880001', true,  false, null, null),
  -- B: organización ajena, para el anti-enumeración.
  ('00000000-0000-0000-0000-000000880102', 'Inmobiliaria B Promo 88', 'inmo-b-promo-88', 'active',
   '00000000-0000-0000-0000-000000880006', true,  false, null, null),
  -- C: NO puede publicar (solo anunciarse) — el CHECK agencies_al_menos_una_
  --    capacidad exige al menos una, así que lleva can_advertise=true.
  ('00000000-0000-0000-0000-000000880103', 'Inmobiliaria C Promo 88', 'inmo-c-promo-88', 'active',
   '00000000-0000-0000-0000-000000880008', false, true,  'otro', null),
  -- D: suspendida.
  ('00000000-0000-0000-0000-000000880104', 'Inmobiliaria D Promo 88', 'inmo-d-promo-88', 'suspended',
   '00000000-0000-0000-0000-000000880009', true,  false, null, null),
  -- E: soft-deleted.
  ('00000000-0000-0000-0000-000000880105', 'Inmobiliaria E Promo 88', 'inmo-e-promo-88', 'active',
   '00000000-0000-0000-0000-000000880010', true,  false, null, now());

insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000880101', '00000000-0000-0000-0000-000000880001', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000880101', '00000000-0000-0000-0000-000000880003', 'agent', 'active'),
  ('00000000-0000-0000-0000-000000880101', '00000000-0000-0000-0000-000000880005', 'agent', 'suspended'),
  ('00000000-0000-0000-0000-000000880101', '00000000-0000-0000-0000-000000880007', 'agent', 'active'),
  ('00000000-0000-0000-0000-000000880102', '00000000-0000-0000-0000-000000880006', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000880103', '00000000-0000-0000-0000-000000880008', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000880104', '00000000-0000-0000-0000-000000880009', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000880105', '00000000-0000-0000-0000-000000880010', 'owner', 'active');

-- Punto DENTRO de la colonia 88-A1 (y del bbox de 88001): resolve_ad_zone
-- devuelve municipio '88001'. Punto (1.0, 1.0) = golfo de Guinea: fuera de
-- todo polígono y de todo bbox → municipio NULL.
insert into public.properties (id, owner_user_id, agency_id, property_type, operation_type,
                               address, location, price, status, published_at, deleted_at) values
  ('00000000-0000-0000-0000-000000880301', '00000000-0000-0000-0000-000000880001', '00000000-0000-0000-0000-000000880101',
   'casa', 'rent', 'Av. Camino Feliz 301, Promo 88',
   extensions.ST_SetSRID(extensions.ST_Point(-99.29, 19.31), 4326)::extensions.geography, 15000, 'active', now(), null),
  ('00000000-0000-0000-0000-000000880302', '00000000-0000-0000-0000-000000880003', '00000000-0000-0000-0000-000000880101',
   'departamento', 'rent', 'Av. Agente 302, Promo 88',
   extensions.ST_SetSRID(extensions.ST_Point(-99.29, 19.31), 4326)::extensions.geography, 9000, 'active', now(), null),
  ('00000000-0000-0000-0000-000000880303', '00000000-0000-0000-0000-000000880001', '00000000-0000-0000-0000-000000880101',
   'casa', 'sale', 'Av. Borrador 303, Promo 88',
   extensions.ST_SetSRID(extensions.ST_Point(-99.29, 19.31), 4326)::extensions.geography, 2000000, 'draft', null, null),
  ('00000000-0000-0000-0000-000000880304', '00000000-0000-0000-0000-000000880001', '00000000-0000-0000-0000-000000880101',
   'casa', 'sale', 'Av. Pausada 304, Promo 88',
   extensions.ST_SetSRID(extensions.ST_Point(-99.29, 19.31), 4326)::extensions.geography, 2100000, 'paused', now(), null),
  ('00000000-0000-0000-0000-000000880305', '00000000-0000-0000-0000-000000880001', '00000000-0000-0000-0000-000000880101',
   'casa', 'rent', 'Av. Borrada 305, Promo 88',
   extensions.ST_SetSRID(extensions.ST_Point(-99.29, 19.31), 4326)::extensions.geography, 11000, 'active', now(), now()),
  ('00000000-0000-0000-0000-000000880306', '00000000-0000-0000-0000-000000880012', null,
   'casa', 'rent', 'Av. Independiente 306, Promo 88',
   extensions.ST_SetSRID(extensions.ST_Point(-99.29, 19.31), 4326)::extensions.geography, 8000, 'active', now(), null),
  ('00000000-0000-0000-0000-000000880308', '00000000-0000-0000-0000-000000880008', '00000000-0000-0000-0000-000000880103',
   'local', 'rent', 'Av. Sin Publicar 308, Promo 88',
   extensions.ST_SetSRID(extensions.ST_Point(-99.29, 19.31), 4326)::extensions.geography, 30000, 'active', now(), null),
  ('00000000-0000-0000-0000-000000880309', '00000000-0000-0000-0000-000000880009', '00000000-0000-0000-0000-000000880104',
   'local', 'rent', 'Av. Suspendida 309, Promo 88',
   extensions.ST_SetSRID(extensions.ST_Point(-99.29, 19.31), 4326)::extensions.geography, 31000, 'active', now(), null),
  ('00000000-0000-0000-0000-000000880310', '00000000-0000-0000-0000-000000880010', '00000000-0000-0000-0000-000000880105',
   'local', 'rent', 'Av. Borrada Org 310, Promo 88',
   extensions.ST_SetSRID(extensions.ST_Point(-99.29, 19.31), 4326)::extensions.geography, 32000, 'active', now(), null),
  ('00000000-0000-0000-0000-000000880311', '00000000-0000-0000-0000-000000880001', '00000000-0000-0000-0000-000000880101',
   'terreno', 'sale', 'Av. Fuera De Cobertura 311, Promo 88',
   extensions.ST_SetSRID(extensions.ST_Point(1.0, 1.0), 4326)::extensions.geography, 500000, 'active', now(), null),
  ('00000000-0000-0000-0000-000000880312', '00000000-0000-0000-0000-000000880001', '00000000-0000-0000-0000-000000880101',
   'casa', 'rent', 'Av. Doble Tap 312, Promo 88',
   extensions.ST_SetSRID(extensions.ST_Point(-99.29, 19.31), 4326)::extensions.geography, 14000, 'active', now(), null),
  ('00000000-0000-0000-0000-000000880313', '00000000-0000-0000-0000-000000880001', '00000000-0000-0000-0000-000000880101',
   'casa', 'rent', 'Av. Moderada 313, Promo 88',
   extensions.ST_SetSRID(extensions.ST_Point(-99.29, 19.31), 4326)::extensions.geography, 13000, 'active', now(), null);

-- Snapshot de conteo para ZONE2 (nada se crea cuando la zona no resuelve).
create temp table ads_antes_88 as select count(*)::bigint as n from public.ads;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Metadata — catálogo puro, nunca lanza aunque la función no exista.
-- ════════════════════════════════════════════════════════════════════════════

select has_function('public', 'promote_property_atomic', array['uuid'],
  'META1_promote_property_atomic_existe_y_recibe_solo_el_id_de_la_propiedad');

select is(
  (select pg_get_function_result(p.oid) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'promote_property_atomic' limit 1),
  'uuid',
  'META2_devuelve_el_uuid_del_ad_creado'
);

-- 🔒 El actor y su organización NO son parámetros: salen del JWT y de la
-- propiedad. Si la firma creciera con un agency_id, cualquiera podría
-- promocionar a nombre de otra organización (mismo criterio que #191/#193).
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'promote_property_atomic' limit 1),
  'p_property_id uuid',
  'META3_UN_SOLO_parametro_el_actor_y_la_organizacion_NO_viajan_como_argumento'
);

select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'promote_property_atomic' limit 1),
  true,
  'META4_es_security_definer_escribe_en_ads_que_no_tiene_policy_de_INSERT'
);

select is(
  (select exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join lateral unnest(coalesce(p.proconfig, array[]::text[])) as cfg(setting)
     where n.nspname = 'public' and p.proname = 'promote_property_atomic'
       and cfg.setting = 'search_path=public, pg_temp')),
  true,
  'META5_search_path_fijo_a_public_pg_temp'
);

select is(
  (select exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'promote_property_atomic'
       and array_to_string(p.proacl, ',') like '%authenticated=X%')),
  true,
  'META6_authenticated_SI_puede_ejecutarla_es_el_punto_de_esta_RPC'
);

select is(
  (select exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'promote_property_atomic'
       and array_to_string(p.proacl, ',') like '%anon=X%')),
  false,
  'META7_anon_NO_aparece_en_el_ACL_ni_por_herencia_de_public'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Permisos y autenticación.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000880001', 'anon');
insert into res_88 values ('PERM1', pg_temp.promote('00000000-0000-0000-0000-000000880301'));
reset role;

select is(
  (select split_part(v, '|', 1) from res_88 where k = 'PERM1'),
  '42501',
  'PERM1_anon_no_puede_ejecutar_la_RPC_42501_no_es_solo_que_RLS_lo_filtre'
);

-- authenticated SIN claims: auth.uid() es NULL.
set local role authenticated;
select set_config('request.jwt.claims', null, true);
insert into res_88 values ('AUTH1', pg_temp.promote('00000000-0000-0000-0000-000000880301'));
reset role;

select is(
  (select v from res_88 where k = 'AUTH1'),
  'P0001|NOT_AUTHENTICATED',
  'AUTH1_authenticated_sin_JWT_recibe_NOT_AUTHENTICATED'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Camino feliz — owner de la organización A.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000880001');
insert into res_88 values ('HAPPY', pg_temp.promote('00000000-0000-0000-0000-000000880301'));
reset role;

select is(
  (select split_part(v, '|', 1) from res_88 where k = 'HAPPY'),
  'ok',
  'HAPPY1_el_owner_promociona_su_propiedad_activa_y_recibe_el_uuid_del_ad'
);

select is(
  (select a.status::text from public.ads a
    where a.id::text = (select split_part(v, '|', 2) from res_88 where k = 'HAPPY')),
  'pending_review',
  'HAPPY2_la_promo_nace_en_pending_review_el_gate_es_la_moderacion_nunca_active_directo'
);

select is(
  (select a.property_id::text || '/' || coalesce(a.creative_id::text, 'NULL')
     from public.ads a
    where a.id::text = (select split_part(v, '|', 2) from res_88 where k = 'HAPPY')),
  '00000000-0000-0000-0000-000000880301/NULL',
  'HAPPY3_property_id_poblado_y_creative_id_NULL_la_promo_ES_la_propiedad'
);

select is(
  (select a.agency_id::text from public.ads a
    where a.id::text = (select split_part(v, '|', 2) from res_88 where k = 'HAPPY')),
  '00000000-0000-0000-0000-000000880101',
  'HAPPY4_agency_id_heredado_de_la_propiedad_no_de_un_parametro'
);

select is(
  (select a.created_by_user_id::text from public.ads a
    where a.id::text = (select split_part(v, '|', 2) from res_88 where k = 'HAPPY')),
  '00000000-0000-0000-0000-000000880001',
  'HAPPY5_created_by_user_id_es_el_caller_del_JWT'
);

select is(
  (select coalesce(a.cta_type::text,'NULL') || '/' || coalesce(a.cta_value,'NULL') || '/' || coalesce(a.description,'NULL')
     from public.ads a
    where a.id::text = (select split_part(v, '|', 2) from res_88 where k = 'HAPPY')),
  'NULL/NULL/NULL',
  'HAPPY6_sin_CTA_ni_descripcion_el_tap_abre_el_detalle_de_la_publicacion'
);

-- 30 días exactos con tolerancia de 1 minuto (now() se evalúa dos veces).
select is(
  (select (a.ends_at - a.starts_at) between interval '30 days' - interval '1 minute'
                                        and interval '30 days' + interval '1 minute'
     from public.ads a
    where a.id::text = (select split_part(v, '|', 2) from res_88 where k = 'HAPPY')),
  true,
  'HAPPY7_la_vigencia_es_de_30_dias_fijos_decision_5_sin_configuracion'
);

select is(
  (select coalesce(z.municipality_id,'NULL') || '/' || coalesce(z.neighborhood_id::text,'NULL')
     from public.ad_zones z
    where z.ad_id::text = (select split_part(v, '|', 2) from res_88 where k = 'HAPPY')),
  '88001/NULL',
  'HAPPY8_ad_zones_hereda_el_MUNICIPIO_de_la_propiedad_sin_colonia_el_alcance_es_municipal'
);

select is(
  (select count(*)::int from public.ad_zones z
    where z.ad_id::text = (select split_part(v, '|', 2) from res_88 where k = 'HAPPY')),
  1,
  'HAPPY9_exactamente_UNA_fila_de_zona_cero_filas_seria_inventario_NACIONAL_gratis'
);

select is(
  (select a.title from public.ads a
    where a.id::text = (select split_part(v, '|', 2) from res_88 where k = 'HAPPY')),
  'Av. Camino Feliz 301, Promo 88',
  'HAPPY10_title_hereda_el_address_de_la_propiedad_properties_no_tiene_columna_title'
);

-- Un 'agent' de la organización (ni owner ni admin) TAMBIÉN promociona: el
-- gate es el permiso de PUBLICAR, no el de gestionar publicidad.
select pg_temp.act_as('00000000-0000-0000-0000-000000880003');
insert into res_88 values ('HAPPY_AGENT', pg_temp.promote('00000000-0000-0000-0000-000000880302'));
reset role;

select is(
  (select split_part(v, '|', 1) from res_88 where k = 'HAPPY_AGENT'),
  'ok',
  'HAPPY11_un_miembro_agent_promociona_el_gate_es_publicar_no_gestionar_publicidad'
);

-- 🔒 La organización A tiene can_advertise=false y aun así las dos promos
-- anteriores funcionaron: dos productos, dos gates.
select is(
  (select ag.can_advertise from public.agencies ag
    where ag.id = '00000000-0000-0000-0000-000000880101'),
  false,
  'HAPPY12_la_organizacion_que_acaba_de_promocionar_tiene_can_advertise_FALSE_los_gates_son_independientes'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) PROPERTY_NOT_FOUND — un solo código para 7 causas (anti-enumeración).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000880001');
insert into res_88 values
  ('DENY1', pg_temp.promote('00000000-0000-0000-0000-0000008809ff')),
  ('DENY2', pg_temp.promote('00000000-0000-0000-0000-000000880305')),
  ('DENY3', pg_temp.promote('00000000-0000-0000-0000-000000880306')),
  ('DENY11', pg_temp.promote('00000000-0000-0000-0000-000000880303')),
  ('DENY12', pg_temp.promote('00000000-0000-0000-0000-000000880304'));
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000880006');
insert into res_88 values ('DENY4', pg_temp.promote('00000000-0000-0000-0000-000000880301'));
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000880004');
insert into res_88 values ('DENY5', pg_temp.promote('00000000-0000-0000-0000-000000880301'));
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000880005');
insert into res_88 values ('DENY6', pg_temp.promote('00000000-0000-0000-0000-000000880301'));
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000880007');
insert into res_88 values ('DENY7', pg_temp.promote('00000000-0000-0000-0000-000000880301'));
reset role;

select is((select v from res_88 where k = 'DENY1'), 'P0001|PROPERTY_NOT_FOUND',
  'DENY1_propiedad_inexistente');
select is((select v from res_88 where k = 'DENY2'), 'P0001|PROPERTY_NOT_FOUND',
  'DENY2_propiedad_soft_deleted_no_se_promociona');
select is((select v from res_88 where k = 'DENY3'), 'P0001|PROPERTY_NOT_FOUND',
  'DENY3_publicacion_de_agente_independiente_sin_agency_id_promocionar_es_producto_de_ORGANIZACIONES');
select is((select v from res_88 where k = 'DENY4'), 'P0001|PROPERTY_NOT_FOUND',
  'DENY4_miembro_de_OTRA_organizacion_mismo_codigo_no_se_revela_que_la_propiedad_existe');
select is((select v from res_88 where k = 'DENY5'), 'P0001|PROPERTY_NOT_FOUND',
  'DENY5_usuario_sin_ninguna_membresia');
select is((select v from res_88 where k = 'DENY6'), 'P0001|PROPERTY_NOT_FOUND',
  'DENY6_membresia_suspendida_no_publica_luego_no_promociona');
select is((select v from res_88 where k = 'DENY7'), 'P0001|PROPERTY_NOT_FOUND',
  'DENY7_miembro_activo_con_users_role_user_no_cumple_el_predicado_de_properties_insert');

-- ════════════════════════════════════════════════════════════════════════════
-- 5) AGENCY_CANNOT_PUBLISH y PROPERTY_NOT_PUBLISHED.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000880008');
insert into res_88 values ('DENY8', pg_temp.promote('00000000-0000-0000-0000-000000880308'));
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000880009');
insert into res_88 values ('DENY9', pg_temp.promote('00000000-0000-0000-0000-000000880309'));
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000880010');
insert into res_88 values ('DENY10', pg_temp.promote('00000000-0000-0000-0000-000000880310'));
reset role;

select is((select v from res_88 where k = 'DENY8'), 'P0001|AGENCY_CANNOT_PUBLISH',
  'DENY8_organizacion_con_can_publish_properties_false_no_promociona');
select is((select v from res_88 where k = 'DENY9'), 'P0001|AGENCY_CANNOT_PUBLISH',
  'DENY9_organizacion_suspendida_no_promociona');
select is((select v from res_88 where k = 'DENY10'), 'P0001|AGENCY_CANNOT_PUBLISH',
  'DENY10_organizacion_soft_deleted_no_promociona');

select is((select v from res_88 where k = 'DENY11'), 'P0001|PROPERTY_NOT_PUBLISHED',
  'DENY11_una_propiedad_en_draft_no_se_promociona_primero_se_publica');
select is((select v from res_88 where k = 'DENY12'), 'P0001|PROPERTY_NOT_PUBLISHED',
  'DENY12_una_propiedad_paused_tampoco_solo_active');

-- ════════════════════════════════════════════════════════════════════════════
-- 6) ALREADY_PROMOTED — el candado del doble tap.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000880001');
insert into res_88 values ('ALREADY_1', pg_temp.promote('00000000-0000-0000-0000-000000880312'));
insert into res_88 values ('ALREADY_2', pg_temp.promote('00000000-0000-0000-0000-000000880312'));
reset role;

select is(
  (select split_part(v, '|', 1) from res_88 where k = 'ALREADY_1') || ' -> ' ||
  (select v from res_88 where k = 'ALREADY_2'),
  'ok -> P0001|ALREADY_PROMOTED',
  'ALREADY1_la_primera_promo_entra_y_la_segunda_de_la_MISMA_propiedad_recibe_ALREADY_PROMOTED'
);

-- Rechazarla (estado TERMINAL) libera la propiedad. Se hace con la RPC real de
-- moderación, no con un UPDATE a mano: así el assert prueba que las dos piezas
-- encajan, no solo que el índice tiene el predicado que yo escribí.
-- En RED `split_part` devuelve el mensaje de error, no un uuid: el cast
-- reventaria con 22P02 y abortaria el archivo. Va protegido.
do $$
begin
  perform public.moderate_ad_atomic(
    (select split_part(v, '|', 2) from res_88 where k = 'ALREADY_1')::uuid,
    'rejected', 'No cumple lineamientos', '00000000-0000-0000-0000-000000880011');
exception when others then null;
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-000000880001');
insert into res_88 values ('ALREADY_3', pg_temp.promote('00000000-0000-0000-0000-000000880312'));
reset role;

select is(
  (select split_part(v, '|', 1) from res_88 where k = 'ALREADY_3'),
  'ok',
  'ALREADY2_tras_rechazar_la_promo_estado_terminal_la_propiedad_se_puede_volver_a_promocionar'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) ZONE_UNRESOLVED — fuera de cobertura NO se convierte en inventario
--    nacional gratis.
-- ════════════════════════════════════════════════════════════════════════════

create temp table ads_pre_zone_88 as select count(*)::bigint as n from public.ads;

select pg_temp.act_as('00000000-0000-0000-0000-000000880001');
insert into res_88 values ('ZONE1', pg_temp.promote('00000000-0000-0000-0000-000000880311'));
reset role;

select is((select v from res_88 where k = 'ZONE1'), 'P0001|ZONE_UNRESOLVED',
  'ZONE1_una_propiedad_fuera_de_toda_cobertura_no_se_puede_promocionar');

select is(
  (select count(*)::bigint from public.ads) - (select n from ads_pre_zone_88),
  0::bigint,
  'ZONE2_y_NO_queda_ningun_ad_creado_cero_filas_en_ad_zones_seria_inventario_NACIONAL'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 8) Moderación — el resto de la épica opera por ad_id/agency_id y no necesita
--    saber que esto es una promo.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000880001');
insert into res_88 values ('MOD', pg_temp.promote('00000000-0000-0000-0000-000000880313'));
reset role;

create temp table mod_88 (resultado text);
do $$
declare v_ad uuid; v_rows int;
begin
  select split_part(v, '|', 2)::uuid into v_ad from res_88 where k = 'MOD';
  v_rows := public.moderate_ad_atomic(v_ad, 'active', null, '00000000-0000-0000-0000-000000880011');
  insert into mod_88
  select v_rows || '/' || a.status::text || '/' || coalesce(a.creative_id::text, 'NULL') || '/' ||
         (select count(*)::text from public.ad_zones z where z.ad_id = a.id)
    from public.ads a where a.id = v_ad;
exception when others then
  insert into mod_88 values ('error:' || sqlstate || '|' || sqlerrm);
end $$;

select is((select resultado from mod_88), '1/active/NULL/1',
  'MOD1_moderate_ad_atomic_aprueba_la_promo_1_fila_queda_active_creative_id_sigue_NULL_y_conserva_su_zona');

-- ════════════════════════════════════════════════════════════════════════════
-- 9) RLS — ads_select ya cubre la promo sin cambios (la policy razona por
--    agency_id/status, no por el tipo de anuncio).
-- ════════════════════════════════════════════════════════════════════════════

-- La promo 'MOD' quedó ACTIVE arriba; para RLS1/RLS2 se usa la de 880302,
-- que sigue en pending_review.
create temp table rls_88 (k text primary key, n int);
grant insert, select on rls_88 to public;

select pg_temp.act_as('00000000-0000-0000-0000-000000880001');
insert into rls_88
select 'RLS1', count(*)::int from public.ads a
 where a.id::text = (select split_part(v, '|', 2) from res_88 where k = 'HAPPY_AGENT');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000880004');
insert into rls_88
select 'RLS2', count(*)::int from public.ads a
 where a.id::text = (select split_part(v, '|', 2) from res_88 where k = 'HAPPY_AGENT');
insert into rls_88
select 'RLS3', count(*)::int from public.ads a
 where a.id::text = (select split_part(v, '|', 2) from res_88 where k = 'MOD');
reset role;

select is((select n from rls_88 where k = 'RLS1'), 1,
  'RLS1_un_miembro_de_la_organizacion_ve_su_promo_aunque_este_en_pending_review');
select is((select n from rls_88 where k = 'RLS2'), 0,
  'RLS2_un_tercero_NO_ve_una_promo_en_pending_review_de_otra_organizacion');
select is((select n from rls_88 where k = 'RLS3'), 1,
  'RLS3_el_tercero_SI_ve_la_promo_una_vez_active_y_vigente_el_feed_la_necesita_cross_org');

select * from finish();
rollback;
