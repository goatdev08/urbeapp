-- Tests pgTAP — public.ads_for_zone sirve PROMOCIONES de propiedades
-- (tarea #213, subtarea 213.3-SQL). Ejecutar con:
--   supabase test db supabase/tests/89_ads_for_zone_promos_test.sql --local
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL HUECO: 213.1 dio a `ads` una segunda fuente de video (property_id) y
-- 213.2 la ruta para crearla, pero ads_for_zone sigue haciendo `join
-- ad_creatives` — un INNER join sobre una columna que ahora es NULL para toda
-- promoción. Resultado: las promociones se aprueban en /admin/ads y NUNCA
-- llegan al feed. Esta suite fija el contrato que las hace visibles.
--
-- SEAM bajo prueba: el contrato PÚBLICO de la RPC — firma de retorno (leída
-- del catálogo, nunca reescrita a mano), permisos, y qué anuncios devuelve
-- para una zona dada. NO se inspecciona el cuerpo salvo por el ancla
-- anti-regresión de #235 (ver SIG7), que es una regla explícita del proyecto.
--
-- SUT (RED 2026-09-02): la migración GREEN
-- supabase/migrations/20260903300003_ads_for_zone_promos.sql (+ rollback) debe:
--   · `drop function if exists` + `create` (el `returns table` cambia, así que
--     un `create or replace` no basta) conservando las 9 columnas actuales EN
--     EL MISMO ORDEN y agregando `property_id uuid` AL FINAL. Aditivo: los
--     builds instalados leen las columnas por nombre y no piden la nueva.
--     El grant a `authenticated` se re-otorga explícito (un drop se lo lleva).
--   · `join ad_creatives` → `left join`.
--   · Condición de servicio: (creative_id no nulo Y creative 'ready') OR
--     (property_id no nulo Y la propiedad está publicada y tiene video
--     reproducible). El criterio de "video reproducible" es EL MISMO que
--     autoriza mint-video-url (supabase/functions/mint-video-url/types.ts:43-47
--     y el adapter de _shared/clients.ts): properties.status='active' AND
--     properties.deleted_at IS NULL AND property_videos.status='ready' AND
--     property_videos.deleted_at IS NULL. Si el feed sirviera una promo cuyo
--     video mint-video-url se niega a firmar, el cliente la descartaría en
--     silencio y el anunciante consumiría su cupo de 30 días por un hueco.
--   · 🔴 Seguir delegando el fallback municipal en private.municipality_at_point
--     (#235). Esta migración REESCRIBE la función entera, así que es
--     exactamente el punto donde la copia triplicada del `order by` puede
--     volver a nacer.
--   · Sin cambios en Edge Functions: mint-ad-urls sigue recibiendo solo
--     creative_ids no nulos; el video de la promo lo firma mint-video-url.
--
-- ── Técnica RED sin abortar la transacción ─────────────────────────────────
-- En RED la función EXISTE (versión de 9 columnas), así que una consulta que
-- nombre `property_id` muere con 42703 y aborta el archivo. TODA llamada va
-- por pg_temp.q(), que ejecuta el texto y devuelve el escalar o 'err:<estado>'.
--
-- ── Edge cases enumerados ──────────────────────────────────────────────────
-- SIG1-7  firma de retorno EXACTA con property_id al final · argumentos sin
--         cambios · security definer · search_path fijo · authenticated con
--         EXECUTE · anon sin EXECUTE · el cuerpo NO menciona mx_municipalities.
-- PROMO1-5 una promo activa cuya propiedad está publicada con video ready se
--         sirve en su municipio · sus columnas (creative_id, cloudflare_uid,
--         cta_type, cta_value, description NULL; property_id poblado) · title
--         desde la fila ads · identidad del anunciante intacta · se sirve
--         también cuando el municipio salió del fallback por bbox (la
--         delegación en private.municipality_at_point sigue viva).
-- LIFE1-2 assert COMPUESTO antes(servida)→después(ausente) cuando la propiedad
--         se pausa y cuando se borra: el estado de la publicación manda sobre
--         el del anuncio.
-- VID1-2  sin video ready · con el video ready soft-deleted → no se sirve.
-- ELIG1-2 la elegibilidad del ANUNCIO no se relajó: pending_review y vigencia
--         vencida siguen fuera.
-- ZONE1-2 una promo de otro municipio no se cuela AQUÍ y SÍ aparece ALLÁ (el
--         negativo va con su control positivo, nunca un assert que pase vacío).
-- DISP1-4 regresión de lo ya desplegado: el display con creative ready sigue
--         presente, con property_id NULL y sus columnas idénticas; el display
--         con creative no-'ready' sigue ausente (el left join no lo cuela).
-- NAT1    D3 (169.1) intacta: cero filas en ad_zones sigue siendo inventario
--         nacional.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(25);

-- Ejecuta un SELECT escalar y devuelve su valor como texto, o 'err:<sqlstate>'.
create or replace function pg_temp.q(p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  return coalesce(v, 'NULL');
exception when others then
  return 'err:' || sqlstate;
end $$;

create temp table now_89 as select now() as v_now;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) Fixtures — state '89', fuera del rango real INEGI (01-32). Dos municipios
--    separados ~110 km para que ST_Intersects/bbox no se crucen.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.mx_states (id, name, abbr) values ('89', 'Estado Promo Feed 89', 'PF');
insert into public.mx_municipalities (id, state_id, name, bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng) values
  ('89001', '89', 'Municipio A Promo Feed 89', 19.20, -99.50, 19.60, -99.00),
  ('89002', '89', 'Municipio B Promo Feed 89', 20.20, -100.50, 20.60, -100.00);
insert into public.mx_neighborhoods (source_key, municipality_id, name, geom) values
  ('test-promofeed-89-a1', '89001', 'Colonia A1 Promo Feed 89',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-99.30, 19.30, -99.28, 19.32, 4326))::extensions.geography);

-- Puntos: (19.31,-99.29) dentro de la colonia A1 · (19.50,-99.45) dentro del
-- bbox de 89001 pero FUERA del polígono (el hueco DCAH que ejercita el
-- fallback delegado en private.municipality_at_point) · (20.31,-100.29) en el
-- municipio B.

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000890001', 'owner_promofeed89@urbea.mx');
update public.users set role = 'agent' where id = '00000000-0000-0000-0000-000000890001';

insert into public.agencies (id, name, slug, logo_url, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000890101', 'Inmobiliaria Promo Feed 89', 'inmo-promofeed-89',
   'https://cdn.urbea.mx/logos/promofeed-89.png', 'active', '00000000-0000-0000-0000-000000890001');
insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000890101', '00000000-0000-0000-0000-000000890001', 'owner', 'active');

insert into public.ad_creatives (id, agency_id, cloudflare_uid, status) values
  ('00000000-0000-0000-0000-000000890201', '00000000-0000-0000-0000-000000890101', 'cf-promofeed89-ready', 'ready'),
  ('00000000-0000-0000-0000-000000890202', '00000000-0000-0000-0000-000000890101', null, 'uploading');

-- Propiedades: todas activas al arrancar, en la colonia A1 salvo la de B y la
-- del hueco de bbox.
insert into public.properties (id, owner_user_id, agency_id, property_type, operation_type,
                               address, location, price, status, published_at)
select v.id::uuid, '00000000-0000-0000-0000-000000890001', '00000000-0000-0000-0000-000000890101',
       'casa', 'rent', v.addr,
       extensions.ST_SetSRID(extensions.ST_Point(v.lng, v.lat), 4326)::extensions.geography,
       10000, 'active', now()
from (values
  ('00000000-0000-0000-0000-000000890301', 'Prop Servida 301',       -99.29, 19.31),
  ('00000000-0000-0000-0000-000000890302', 'Prop Se Pausa 302',      -99.29, 19.31),
  ('00000000-0000-0000-0000-000000890303', 'Prop Se Borra 303',      -99.29, 19.31),
  ('00000000-0000-0000-0000-000000890304', 'Prop Sin Video 304',     -99.29, 19.31),
  ('00000000-0000-0000-0000-000000890305', 'Prop Video Borrado 305', -99.29, 19.31),
  ('00000000-0000-0000-0000-000000890306', 'Prop Pendiente 306',     -99.29, 19.31),
  ('00000000-0000-0000-0000-000000890307', 'Prop Vencida 307',       -99.29, 19.31),
  ('00000000-0000-0000-0000-000000890308', 'Prop Muni B 308',       -100.29, 20.31),
  ('00000000-0000-0000-0000-000000890309', 'Prop Hueco Bbox 309',    -99.45, 19.50)
) as v(id, addr, lng, lat);

-- Videos: 'ready' para todas menos 304 (uploading) y 305 (ready pero borrado).
insert into public.property_videos (property_id, storage_path, position, status, deleted_at)
select v.pid::uuid, v.path, 1, v.st::public.property_video_status, v.del::timestamptz
from (values
  ('00000000-0000-0000-0000-000000890301', 'promofeed89/301.mp4', 'ready',     null),
  ('00000000-0000-0000-0000-000000890302', 'promofeed89/302.mp4', 'ready',     null),
  ('00000000-0000-0000-0000-000000890303', 'promofeed89/303.mp4', 'ready',     null),
  ('00000000-0000-0000-0000-000000890304', 'promofeed89/304.mp4', 'uploading', null),
  ('00000000-0000-0000-0000-000000890305', 'promofeed89/305.mp4', 'ready',     '2026-09-01T00:00:00Z'),
  ('00000000-0000-0000-0000-000000890306', 'promofeed89/306.mp4', 'ready',     null),
  ('00000000-0000-0000-0000-000000890307', 'promofeed89/307.mp4', 'ready',     null),
  ('00000000-0000-0000-0000-000000890308', 'promofeed89/308.mp4', 'ready',     null),
  ('00000000-0000-0000-0000-000000890309', 'promofeed89/309.mp4', 'ready',     null)
) as v(pid, path, st, del);

-- Anuncios: promos (property_id) y display (creative_id), más el nacional.
insert into public.ads (id, agency_id, property_id, title, status, starts_at, ends_at)
select v.id::uuid, '00000000-0000-0000-0000-000000890101', v.pid::uuid, v.title,
       v.st::public.ad_status, (select v_now from now_89) + v.starts, (select v_now from now_89) + v.ends
from (values
  ('00000000-0000-0000-0000-000000890401','00000000-0000-0000-0000-000000890301','Promo Servida 401','active',           interval '0',        interval '30 days'),
  ('00000000-0000-0000-0000-000000890402','00000000-0000-0000-0000-000000890302','Promo Se Pausa 402','active',          interval '0',        interval '30 days'),
  ('00000000-0000-0000-0000-000000890403','00000000-0000-0000-0000-000000890303','Promo Se Borra 403','active',          interval '0',        interval '30 days'),
  ('00000000-0000-0000-0000-000000890404','00000000-0000-0000-0000-000000890304','Promo Sin Video 404','active',         interval '0',        interval '30 days'),
  ('00000000-0000-0000-0000-000000890405','00000000-0000-0000-0000-000000890305','Promo Video Borrado 405','active',     interval '0',        interval '30 days'),
  ('00000000-0000-0000-0000-000000890406','00000000-0000-0000-0000-000000890306','Promo Pendiente 406','pending_review', interval '0',        interval '30 days'),
  ('00000000-0000-0000-0000-000000890407','00000000-0000-0000-0000-000000890307','Promo Vencida 407','active',           interval '-60 days', interval '-10 days'),
  ('00000000-0000-0000-0000-000000890408','00000000-0000-0000-0000-000000890308','Promo Muni B 408','active',            interval '0',        interval '30 days'),
  ('00000000-0000-0000-0000-000000890409','00000000-0000-0000-0000-000000890309','Promo Hueco Bbox 409','active',        interval '0',        interval '30 days')
) as v(id, pid, title, st, starts, ends);

insert into public.ads (id, agency_id, creative_id, title, description, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000890501', '00000000-0000-0000-0000-000000890101',
   '00000000-0000-0000-0000-000000890201', 'Display Control 501', 'Descripcion display 501',
   'whatsapp', '+5213312345689', 'active', (select v_now from now_89), (select v_now + interval '30 days' from now_89)),
  ('00000000-0000-0000-0000-000000890502', '00000000-0000-0000-0000-000000890101',
   '00000000-0000-0000-0000-000000890202', 'Display Creativo Uploading 502', null,
   'phone', '+5213300000502', 'active', (select v_now from now_89), (select v_now + interval '30 days' from now_89)),
  -- Sin filas en ad_zones = inventario NACIONAL (D3, 169.1).
  ('00000000-0000-0000-0000-000000890503', '00000000-0000-0000-0000-000000890101',
   '00000000-0000-0000-0000-000000890201', 'Display Nacional 503', null,
   'phone', '+5213300000503', 'active', (select v_now from now_89), (select v_now + interval '30 days' from now_89));

insert into public.ad_zones (ad_id, municipality_id) values
  ('00000000-0000-0000-0000-000000890401', '89001'),
  ('00000000-0000-0000-0000-000000890402', '89001'),
  ('00000000-0000-0000-0000-000000890403', '89001'),
  ('00000000-0000-0000-0000-000000890404', '89001'),
  ('00000000-0000-0000-0000-000000890405', '89001'),
  ('00000000-0000-0000-0000-000000890406', '89001'),
  ('00000000-0000-0000-0000-000000890407', '89001'),
  ('00000000-0000-0000-0000-000000890408', '89002'),
  ('00000000-0000-0000-0000-000000890409', '89001'),
  ('00000000-0000-0000-0000-000000890501', '89001'),
  ('00000000-0000-0000-0000-000000890502', '89001');

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Firma y permisos — el contrato que consumen builds instalados.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ads_for_zone' limit 1),
  'TABLE(id uuid, creative_id uuid, title text, description text, cta_type ad_cta_type, cta_value text, cloudflare_uid text, agency_name text, agency_logo_url text, property_id uuid)',
  'SIG1_las_9_columnas_actuales_en_el_MISMO_orden_mas_property_id_uuid_AL_FINAL_aditivo_para_builds_instalados'
);

select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ads_for_zone' limit 1),
  'p_lat double precision, p_lng double precision, p_neighborhood_id bigint DEFAULT NULL::bigint, p_municipality_id text DEFAULT NULL::text',
  'SIG2_los_argumentos_NO_cambian_el_cliente_llama_igual'
);

select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ads_for_zone' limit 1),
  true, 'SIG3_sigue_siendo_security_definer');

select is(
  (select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join lateral unnest(coalesce(p.proconfig, array[]::text[])) as cfg(setting)
     where n.nspname = 'public' and p.proname = 'ads_for_zone'
       and cfg.setting = 'search_path=public, pg_temp')),
  true, 'SIG4_search_path_sigue_fijo_a_public_pg_temp');

-- 🔴 Un `drop function` se lleva los grants: si la migración no los re-otorga,
-- el feed entero recibe 42501 para TODO usuario.
select is(
  (select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'ads_for_zone'
       and array_to_string(p.proacl, ',') like '%authenticated=X%')),
  true, 'SIG5_authenticated_conserva_EXECUTE_tras_el_drop_and_create');

select is(
  (select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'ads_for_zone'
       and array_to_string(p.proacl, ',') like '%anon=X%')),
  false, 'SIG6_anon_sigue_SIN_EXECUTE');

-- Ancla de #235 replicada aquí a propósito: esta migración reescribe el cuerpo
-- ENTERO de ads_for_zone, así que es el punto exacto donde la copia del
-- `order by` de #194 puede volver a nacer. EC-31 de la suite 86 vigila lo
-- mismo; tenerlo también aquí lo pone donde el cambio ocurre.
select is(
  (select position('mx_municipalities' in pg_get_functiondef(
     to_regprocedure('public.ads_for_zone(double precision,double precision,bigint,text)')::oid))),
  0,
  'SIG7_el_cuerpo_reescrito_sigue_SIN_tocar_mx_municipalities_delega_en_private_municipality_at_point'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) La promoción se sirve.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.q($$ select count(*)::text from public.ads_for_zone(19.31, -99.29)
               where id = '00000000-0000-0000-0000-000000890401' $$),
  '1',
  'PROMO1_una_promo_activa_con_propiedad_publicada_y_video_ready_se_sirve_en_su_municipio'
);

select is(
  pg_temp.q($$ select coalesce(creative_id::text,'NULL') || '|' || coalesce(cloudflare_uid,'NULL') || '|' ||
                      coalesce(cta_type::text,'NULL') || '|' || coalesce(cta_value,'NULL') || '|' ||
                      coalesce(description,'NULL') || '|' || coalesce(property_id::text,'NULL')
               from public.ads_for_zone(19.31, -99.29)
               where id = '00000000-0000-0000-0000-000000890401' $$),
  'NULL|NULL|NULL|NULL|NULL|00000000-0000-0000-0000-000000890301',
  'PROMO2_la_promo_viaja_sin_creativo_sin_uid_y_sin_CTA_con_property_id_poblado_el_cliente_firma_el_video_con_mint_video_url'
);

select is(
  pg_temp.q($$ select title from public.ads_for_zone(19.31, -99.29)
               where id = '00000000-0000-0000-0000-000000890401' $$),
  'Promo Servida 401',
  'PROMO3_title_sale_de_la_fila_ads_no_de_la_propiedad'
);

select is(
  pg_temp.q($$ select agency_name || '|' || coalesce(agency_logo_url,'NULL')
               from public.ads_for_zone(19.31, -99.29)
               where id = '00000000-0000-0000-0000-000000890401' $$),
  'Inmobiliaria Promo Feed 89|https://cdn.urbea.mx/logos/promofeed-89.png',
  'PROMO4_la_identidad_del_anunciante_sigue_cruzando_desde_agencies'
);

-- Punto en el hueco DCAH: sin polígono, el municipio sale del fallback por
-- bbox. SIG7 impide que la migración reintroduzca su propia copia del criterio;
-- este assert prueba que el fallback DELEGADO sigue funcionando.
select is(
  pg_temp.q($$ select count(*)::text from public.ads_for_zone(19.50, -99.45)
               where id = '00000000-0000-0000-0000-000000890409' $$),
  '1',
  'PROMO5_la_promo_se_sirve_tambien_cuando_el_municipio_sale_del_fallback_por_bbox_delegado'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) El estado de la PUBLICACIÓN manda — asserts compuestos antes→después.
-- ════════════════════════════════════════════════════════════════════════════

create temp table life_89 (k text primary key, v text);

insert into life_89 select 'PAUSE_ANTES',
  pg_temp.q($$ select count(*)::text from public.ads_for_zone(19.31, -99.29)
               where id = '00000000-0000-0000-0000-000000890402' $$);
update public.properties set status = 'paused' where id = '00000000-0000-0000-0000-000000890302';
insert into life_89 select 'PAUSE_DESPUES',
  pg_temp.q($$ select count(*)::text from public.ads_for_zone(19.31, -99.29)
               where id = '00000000-0000-0000-0000-000000890402' $$);

select is(
  (select v from life_89 where k = 'PAUSE_ANTES') || '->' || (select v from life_89 where k = 'PAUSE_DESPUES'),
  '1->0',
  'LIFE1_pausar_la_PUBLICACION_saca_su_promo_del_feed_aunque_el_anuncio_siga_active'
);

insert into life_89 select 'DEL_ANTES',
  pg_temp.q($$ select count(*)::text from public.ads_for_zone(19.31, -99.29)
               where id = '00000000-0000-0000-0000-000000890403' $$);
update public.properties set deleted_at = now() where id = '00000000-0000-0000-0000-000000890303';
insert into life_89 select 'DEL_DESPUES',
  pg_temp.q($$ select count(*)::text from public.ads_for_zone(19.31, -99.29)
               where id = '00000000-0000-0000-0000-000000890403' $$);

select is(
  (select v from life_89 where k = 'DEL_ANTES') || '->' || (select v from life_89 where k = 'DEL_DESPUES'),
  '1->0',
  'LIFE2_borrar_la_PUBLICACION_saca_su_promo_del_feed_no_se_sirve_un_video_que_ya_no_existe'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) El video reproducible es requisito (mismo criterio que mint-video-url).
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.q($$ select count(*)::text from public.ads_for_zone(19.31, -99.29)
               where id = '00000000-0000-0000-0000-000000890404' $$),
  '0',
  'VID1_una_promo_cuya_propiedad_no_tiene_video_ready_no_se_sirve_mint_video_url_no_la_firmaria'
);

select is(
  pg_temp.q($$ select count(*)::text from public.ads_for_zone(19.31, -99.29)
               where id = '00000000-0000-0000-0000-000000890405' $$),
  '0',
  'VID2_un_video_ready_pero_soft_deleted_no_cuenta_mismo_filtro_que_el_minter'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) La elegibilidad del ANUNCIO no se relajó al abrir la rama de promos.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.q($$ select count(*)::text from public.ads_for_zone(19.31, -99.29)
               where id = '00000000-0000-0000-0000-000000890406' $$),
  '0',
  'ELIG1_una_promo_en_pending_review_no_se_sirve_el_gate_sigue_siendo_la_moderacion'
);

select is(
  pg_temp.q($$ select count(*)::text from public.ads_for_zone(19.31, -99.29)
               where id = '00000000-0000-0000-0000-000000890407' $$),
  '0',
  'ELIG2_una_promo_con_vigencia_vencida_no_se_sirve'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Zonificación — el negativo con su control positivo.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.q($$ select count(*)::text from public.ads_for_zone(19.31, -99.29)
               where id = '00000000-0000-0000-0000-000000890408' $$),
  '0',
  'ZONE1_una_promo_zonada_al_municipio_B_no_se_cuela_en_el_municipio_A'
);

select is(
  pg_temp.q($$ select count(*)::text from public.ads_for_zone(20.31, -100.29)
               where id = '00000000-0000-0000-0000-000000890408' $$),
  '1',
  'ZONE2_y_esa_MISMA_promo_SI_aparece_en_su_municipio_el_negativo_de_arriba_no_pasa_en_vacio'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) Regresión del anuncio DISPLAY — lo ya desplegado no se mueve.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.q($$ select count(*)::text from public.ads_for_zone(19.31, -99.29)
               where id = '00000000-0000-0000-0000-000000890501' $$),
  '1',
  'DISP1_el_display_con_creativo_ready_sigue_sirviendose'
);

select is(
  pg_temp.q($$ select coalesce(property_id::text,'NULL') from public.ads_for_zone(19.31, -99.29)
               where id = '00000000-0000-0000-0000-000000890501' $$),
  'NULL',
  'DISP2_un_display_trae_property_id_NULL_es_como_el_cliente_particiona_los_dos_lotes'
);

select is(
  pg_temp.q($$ select title || '|' || coalesce(description,'NULL') || '|' || cta_type::text || '|' ||
                      cta_value || '|' || coalesce(cloudflare_uid,'NULL') || '|' || agency_name
               from public.ads_for_zone(19.31, -99.29)
               where id = '00000000-0000-0000-0000-000000890501' $$),
  'Display Control 501|Descripcion display 501|whatsapp|+5213312345689|cf-promofeed89-ready|Inmobiliaria Promo Feed 89',
  'DISP3_las_columnas_del_display_siguen_bit_identicas_ninguna_se_reordeno_ni_se_perdio'
);

-- 🔴 El cambio a `left join` es exactamente lo que podría colar un display con
-- creativo no reproducible: sin la condición `c.status = 'ready'` acotada a la
-- rama de display, el anuncio saldría con cloudflare_uid NULL y el feed
-- mostraría una tarjeta muda.
select is(
  pg_temp.q($$ select count(*)::text from public.ads_for_zone(19.31, -99.29)
               where id = '00000000-0000-0000-0000-000000890502' $$),
  '0',
  'DISP4_el_left_join_NO_cuela_un_display_cuyo_creativo_no_esta_ready'
);

select is(
  pg_temp.q($$ select count(*)::text from public.ads_for_zone(20.31, -100.29)
               where id = '00000000-0000-0000-0000-000000890503' $$),
  '1',
  'NAT1_D3_intacta_cero_filas_en_ad_zones_sigue_siendo_inventario_NACIONAL_visible_en_cualquier_zona'
);

select * from finish();
rollback;
