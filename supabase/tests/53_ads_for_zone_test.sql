-- Tests pgTAP — RPC public.ads_for_zone (subtarea #170.2, "zona vista > GPS,
-- fallback por bbox, inventario nacional" + ampliación de contrato de #192,
-- decisión de Abraham 2026-08-18: description + identidad del anunciante).
-- Ejecutar con:
--   supabase test db supabase/tests/53_ads_for_zone_test.sql --local
-- Corre como superusuario dentro de una transacción revertida (no persiste).
-- Impersonamos con pg_temp.act_as(uid, role) (mismo patrón que 02/16/25/37/43/
-- 44/46/47/48/51/52_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba: el contrato PÚBLICO de la RPC — argumentos, columnas de
-- retorno (leídas del catálogo, nunca reescritas a mano) y el conjunto de ads
-- que devuelve para una combinación (lat,lng,zona declarada) dada. NUNCA
-- internals: no se valida la existencia de un CTE/rama por nombre, se
-- ejercita la llamada real y se observa el resultado.
--
-- SUT (AÚN NO EXISTE — RED 2026-08-18): una migración GREEN
-- (supabase/migrations/20260815000020_ads_for_zone.sql + rollback) debe crear:
--
--   public.ads_for_zone(
--     p_lat double precision, p_lng double precision,
--     p_neighborhood_id bigint default null, p_municipality_id text default null
--   ) returns table (
--     id uuid, creative_id uuid, title text, description text, cta_type ad_cta_type,
--     cta_value text, cloudflare_uid text, agency_name text, agency_logo_url text
--   )
--   -- firma de retorno EXACTA fijada por este archivo (sección 1, catálogo
--   -- pg_get_function_result) -- agency_name/agency_logo_url son los ÚNICOS
--   -- dos campos que cruzan desde agencies (name, logo_url); agencies tiene
--   -- columnas (contact_phone, contact_email, status, created_by_user_id...)
--   -- que un usuario final NUNCA debe ver -- el assert de firma exacta las
--   -- excluye por construcción (cualquier columna de más rompe el match).
--
--   security definer, set search_path = public, pg_temp (🔴 NO se agrega
--   `extensions` al search_path -- ST_Intersects se llama SIEMPRE calificada
--   como extensions.ST_Intersects, igual que properties_within_neighborhood
--   y properties_within_radius ya hacen; el search_path fijo es una defensa,
--   no una comodidad de resolución de nombres).
--   revoke execute from public, anon; grant execute to authenticated.
--
--   ORDEN DE RESOLUCIÓN DE ZONA (regla, no optimización):
--     1. zona activa declarada por el cliente (p_neighborhood_id o
--        p_municipality_id, NUNCA ambos con sentido simultáneo -- el
--        contrato no los valida como XOR, pero el caller solo manda uno)
--        GANA sobre las coordenadas GPS.
--     2. sin zona activa: ST_Intersects(mx_neighborhoods.geom, punto) --
--        resuelve colonia Y (vía join) el municipio de esa colonia.
--     3. sin match de polígono: mx_municipalities por bbox precalculado
--        (bbox_min/max_lat/lng) -- resuelve SOLO municipio, sin colonia.
--     4. sin match de bbox tampoco: sin colonia, sin municipio -- SOLO
--        inventario nacional (🔒 invariante: nunca "sin anuncios").
--   ELEGIBILIDAD: status='active' AND now() BETWEEN starts_at AND ends_at AND
--     ad_creatives.status='ready' AND (ad_zones matchea la colonia o el
--     municipio RESUELTOS OR el ad no tiene ninguna fila en ad_zones =
--     nacional).
--
-- ── Nota sobre la técnica RED sin abortar la transacción (heredada de 47/48/
--    51/52_*) ──────────────────────────────────────────────────────────────
-- has_function/pg_proc (catálogo puro) NUNCA lanzan aunque la función no
-- exista. throws_ok SÍ sobrevive un SQLSTATE inesperado (42883 "function does
-- not exist" en vez del 42501 esperado) -- el esperado no matchea y reporta
-- "not ok" limpio, sin abortar el archivo. lives_ok y select/count directos
-- sobre ads_for_zone NO sobreviven un 42883 -- por eso TODA llamada real a
-- ads_for_zone (para inspeccionar sus filas) va en un bloque `do $$ ...
-- exception when others ... $$` AUTO-PROTEGIDO que escribe su resultado
-- completo en una tabla temporal (técnica de 47/48/51/52_*), nunca en
-- lives_ok/RAW crudo. Las verificaciones de conteo/membresía corren después,
-- sobre esa tabla temporal ya materializada (datos planos, sin riesgo).
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ────────────────
-- Firma pública: has_function; pg_get_function_result EXACTO (9 columnas desde
--   170.8 — creative_id se agregó porque el cliente lo necesita para firmar la
--   URL de reproducción con mint-ad-urls; sin él el anuncio no podía reproducir,
--   incluye description/agency_name/agency_logo_url y nada más de agencies);
--   pg_get_function_arguments EXACTO; security definer; search_path fijo.
-- Permisos: anon no puede ejecutar (42501 explícito); authenticated sí puede.
-- Precedencia (la regla central de esta subtarea):
--   · zona activa DECLARADA (colonia) gana sobre GPS -- GPS apunta a "fuera
--     de todo" pero la colonia declarada sigue sirviendo su inventario.
--   · zona activa DECLARADA (municipio) gana sobre GPS -- GPS cae DENTRO de
--     una colonia real, pero el municipio declarado manda; es también el
--     caso "zona declarada que no corresponde a las coordenadas" (server
--     nunca desconfía de la zona que el cliente YA está viendo).
--   · sin zona activa: ST_Intersects resuelve colonia (verificado en DOS
--     polígonos distintos para simetría, no un solo punto con suerte).
--   · punto fuera de todo polígono -> fallback por bbox: municipal +
--     nacional, la colonia NO se sirve (no hay colonia resuelta).
--   · punto fuera de todo polígono Y fuera de todo bbox -> SOLO nacional,
--     NUNCA vacío (🔒 el assert que impide perder inventario vendido).
-- Elegibilidad (cada rama con su propio ad, en la MISMA llamada que trae
--   controles sembrados y confirmados presentes -- nunca un assert que pueda
--   pasar en vacío):
--   draft, pending_review, vigencia futura, vigencia vencida, creativo
--   uploading/processing/failed, ad de OTRO municipio -- todos ausentes
--   mientras los controles (nacional, colonia propia, municipio propio)
--   siguen presentes en la misma llamada.
--   paused, rejected, expired: assert COMPUESTO antes(activo,visible)-
--   >después(status final,ausente) via transición REAL con admin (mismo
--   patrón que 48/52_*), no vía INSERT directo -- demuestra el efecto de la
--   máquina de estados sobre esta RPC, no solo el WHERE.
--   ad SIN ad_zones sale en CUALQUIER zona (verificado en dos contextos
--   geográficos distintos).
-- Efecto de #192 sobre esta RPC: un ad active al que se le edita la
--   descripción cae a pending_review (169.2+192, YA desplegado) y por lo
--   tanto DEJA de servirse -- assert compuesto antes(visible)->después
--   (ausente), prueba de que las dos piezas encajan.
-- Columnas devueltas: valores literales (title/description/cta_type/
--   cta_value/cloudflare_uid/agency_name/agency_logo_url) comparados contra
--   los literales SEMBRADOS (fuente independiente, nunca recomputados);
--   description NULL se preserva como NULL (no ''), no se inventa texto.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(106);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- Captura ÚNICA de "ahora" para todo el archivo (mismo patrón que 48/51/52_*).
create temp table test_now_53 as select now() as v_now;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) Fixtures — self-contained, aislados con state '53' (fuera del rango real
--    01-32 INEGI, mismo patrón que state '51' en 51_ad_impressions_test.sql).
--    Dos municipios/colonias geográficamente separados (A cerca de CDMX, B
--    ~110km al norte) para que ST_Intersects/bbox nunca se crucen entre sí.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.mx_states (id, name, abbr) values ('53', 'Estado Ads For Zone Test 53', 'AZ');

insert into public.mx_municipalities (id, state_id, name, bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng) values
  ('53001', '53', 'Municipio A Ads Zone 53', 19.20, -99.50, 19.60, -99.00),
  ('53002', '53', 'Municipio B Ads Zone 53', 20.20, -100.50, 20.60, -100.00);

insert into public.mx_neighborhoods (source_key, municipality_id, name, geom) values
  ('test-adszone-53-a1', '53001', 'Colonia A1 Ads Zone 53',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-99.30, 19.30, -99.28, 19.32, 4326))::extensions.geography),
  ('test-adszone-53-b1', '53002', 'Colonia B1 Ads Zone 53',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-100.30, 20.30, -100.28, 20.32, 4326))::extensions.geography);

create temp table test_ctx_53 as
select
  (select id from public.mx_neighborhoods where source_key = 'test-adszone-53-a1') as neighborhood_a1_id,
  (select id from public.mx_neighborhoods where source_key = 'test-adszone-53-b1') as neighborhood_b1_id;

-- Puntos de prueba (x=lng, y=lat, mismo gotcha que 09/44_*):
--   p_in_a1 (19.31,-99.29):    dentro de la colonia A1 (ST_Intersects debe matchear).
--   p_gap_a (19.50,-99.45):    dentro del bbox del municipio A, FUERA de A1 (el hueco DCAH).
--   p_in_b1 (20.31,-100.29):   dentro de la colonia B1 (simetría, ST_Intersects distinto).
--   p_outside_all (1.0,1.0):   fuera de TODO polígono y TODO bbox (golfo de Guinea).

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000530001', 'owner_a_adszone53@urbea.mx'),
  ('00000000-0000-0000-0000-000000530002', 'owner_b_adszone53@urbea.mx'),
  ('00000000-0000-0000-0000-000000530003', 'admin_adszone53@urbea.mx');
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000530003';

insert into public.agencies (id, name, slug, logo_url, contact_phone, contact_email, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000530101', 'Agencia Zona A 53', 'agencia-zona-a-53',
   'https://cdn.urbea.mx/logos/zona-a-53.png', '3312345678', 'contacto-zonaa53@urbea.mx',
   'active', '00000000-0000-0000-0000-000000530001'),
  ('00000000-0000-0000-0000-000000530102', 'Agencia Zona B 53', 'agencia-zona-b-53',
   'https://cdn.urbea.mx/logos/zona-b-53.png', '3387654321', 'contacto-zonab53@urbea.mx',
   'active', '00000000-0000-0000-0000-000000530002');

insert into public.ad_creatives (id, agency_id, cloudflare_uid, status) values
  ('00000000-0000-0000-0000-000000530201', '00000000-0000-0000-0000-000000530101', 'cf-uid-adszone53-a-ready', 'ready'),
  ('00000000-0000-0000-0000-000000530202', '00000000-0000-0000-0000-000000530101', null, 'uploading'),
  ('00000000-0000-0000-0000-000000530203', '00000000-0000-0000-0000-000000530101', null, 'processing'),
  ('00000000-0000-0000-0000-000000530204', '00000000-0000-0000-0000-000000530101', null, 'failed'),
  ('00000000-0000-0000-0000-000000530205', '00000000-0000-0000-0000-000000530102', 'cf-uid-adszone53-b-ready', 'ready');

-- ── Ads: controles (deben servirse en su zona) ──────────────────────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, description, starts_at, ends_at) values
  -- 530301: NACIONAL -- sin filas en ad_zones (D3, 169.1). Description NULL a propósito.
  ('00000000-0000-0000-0000-000000530301', '00000000-0000-0000-0000-000000530101',
   '00000000-0000-0000-0000-000000530201', 'Ad Nacional 53', 'phone', '+5213300000053',
   'active', null, (select v_now from test_now_53), (select v_now + interval '30 days' from test_now_53)),
  -- 530302: colonia A1 -- valores literales para el round-trip de columnas.
  ('00000000-0000-0000-0000-000000530302', '00000000-0000-0000-0000-000000530101',
   '00000000-0000-0000-0000-000000530201', 'Ad Colonia A1 53', 'whatsapp', '+5213312345678',
   'active', 'Descripción real de la colonia A1, edición 53',
   (select v_now from test_now_53), (select v_now + interval '30 days' from test_now_53)),
  -- 530303: municipio A.
  ('00000000-0000-0000-0000-000000530303', '00000000-0000-0000-0000-000000530101',
   '00000000-0000-0000-0000-000000530201', 'Ad Municipio A 53', 'external_url', 'https://ejemplo.mx/munia53',
   'active', 'Promoción del municipio A', (select v_now from test_now_53), (select v_now + interval '30 days' from test_now_53)),
  -- 530304: municipio B (agencia B).
  ('00000000-0000-0000-0000-000000530304', '00000000-0000-0000-0000-000000530102',
   '00000000-0000-0000-0000-000000530205', 'Ad Municipio B 53', 'external_url', 'https://ejemplo.mx/munib53',
   'active', 'Promoción del municipio B', (select v_now from test_now_53), (select v_now + interval '30 days' from test_now_53)),
  -- 530305: colonia B1 (agencia B).
  ('00000000-0000-0000-0000-000000530305', '00000000-0000-0000-0000-000000530102',
   '00000000-0000-0000-0000-000000530205', 'Ad Colonia B1 53', 'external_url', 'https://ejemplo.mx/coloniab153',
   'active', 'Promoción de la colonia B1', (select v_now from test_now_53), (select v_now + interval '30 days' from test_now_53));

-- ── Ads: violaciones de elegibilidad, TODAS zonadas a colonia A1 (para que
--    "no salen en A1" sea la única explicación posible -- no confundible con
--    un problema de resolución de zona) ─────────────────────────────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000530306', '00000000-0000-0000-0000-000000530101',
   '00000000-0000-0000-0000-000000530201', 'Ad Draft 53', 'phone', '+5213300000306',
   'draft', (select v_now from test_now_53), (select v_now + interval '30 days' from test_now_53)),
  ('00000000-0000-0000-0000-000000530307', '00000000-0000-0000-0000-000000530101',
   '00000000-0000-0000-0000-000000530201', 'Ad Pending Review 53', 'phone', '+5213300000307',
   'pending_review', (select v_now from test_now_53), (select v_now + interval '30 days' from test_now_53)),
  ('00000000-0000-0000-0000-000000530308', '00000000-0000-0000-0000-000000530101',
   '00000000-0000-0000-0000-000000530201', 'Ad Vigencia Futura 53', 'phone', '+5213300000308',
   'active', (select v_now + interval '10 days' from test_now_53), (select v_now + interval '40 days' from test_now_53)),
  ('00000000-0000-0000-0000-000000530309', '00000000-0000-0000-0000-000000530101',
   '00000000-0000-0000-0000-000000530201', 'Ad Vigencia Vencida 53', 'phone', '+5213300000309',
   'active', (select v_now - interval '60 days' from test_now_53), (select v_now - interval '10 days' from test_now_53)),
  ('00000000-0000-0000-0000-000000530310', '00000000-0000-0000-0000-000000530101',
   '00000000-0000-0000-0000-000000530202', 'Ad Creativo Uploading 53', 'phone', '+5213300000310',
   'active', (select v_now from test_now_53), (select v_now + interval '30 days' from test_now_53)),
  ('00000000-0000-0000-0000-000000530311', '00000000-0000-0000-0000-000000530101',
   '00000000-0000-0000-0000-000000530203', 'Ad Creativo Processing 53', 'phone', '+5213300000311',
   'active', (select v_now from test_now_53), (select v_now + interval '30 days' from test_now_53)),
  ('00000000-0000-0000-0000-000000530312', '00000000-0000-0000-0000-000000530101',
   '00000000-0000-0000-0000-000000530204', 'Ad Creativo Failed 53', 'phone', '+5213300000312',
   'active', (select v_now from test_now_53), (select v_now + interval '30 days' from test_now_53));

-- ── Ads: 3 violadores NACIONALES (SIN ninguna fila en ad_zones, igual que el
--    control 530301) -- los 9 violadores de arriba están TODOS zonados a A1,
--    así que la rama 100% nacional (D3 de 169.1) nunca se ejercitaba contra
--    un ad inelegible. Ausentes en CALL5 (sección 6, punto 100% nacional).
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000530317', '00000000-0000-0000-0000-000000530101',
   '00000000-0000-0000-0000-000000530201', 'Ad Nacional Pending Review 53', 'phone', '+5213300000317',
   'pending_review', (select v_now from test_now_53), (select v_now + interval '30 days' from test_now_53)),
  ('00000000-0000-0000-0000-000000530318', '00000000-0000-0000-0000-000000530101',
   '00000000-0000-0000-0000-000000530201', 'Ad Nacional Vigencia Vencida 53', 'phone', '+5213300000318',
   'active', (select v_now - interval '60 days' from test_now_53), (select v_now - interval '10 days' from test_now_53)),
  ('00000000-0000-0000-0000-000000530319', '00000000-0000-0000-0000-000000530101',
   '00000000-0000-0000-0000-000000530204', 'Ad Nacional Creativo Failed 53', 'phone', '+5213300000319',
   'active', (select v_now from test_now_53), (select v_now + interval '30 days' from test_now_53));

-- ── Ads: para las transiciones REALES (antes=activo/visible, después=status
--    final/ausente) -- arrancan 'active', zonados a colonia A1 ───────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000530313', '00000000-0000-0000-0000-000000530101',
   '00000000-0000-0000-0000-000000530201', 'Ad Sera Pausado 53', 'phone', '+5213300000313',
   'active', (select v_now from test_now_53), (select v_now + interval '30 days' from test_now_53)),
  ('00000000-0000-0000-0000-000000530314', '00000000-0000-0000-0000-000000530101',
   '00000000-0000-0000-0000-000000530201', 'Ad Sera Rechazado 53', 'phone', '+5213300000314',
   'active', (select v_now from test_now_53), (select v_now + interval '30 days' from test_now_53)),
  ('00000000-0000-0000-0000-000000530315', '00000000-0000-0000-0000-000000530101',
   '00000000-0000-0000-0000-000000530201', 'Ad Sera Expirado 53', 'phone', '+5213300000315',
   'active', (select v_now from test_now_53), (select v_now + interval '30 days' from test_now_53)),
  ('00000000-0000-0000-0000-000000530316', '00000000-0000-0000-0000-000000530101',
   '00000000-0000-0000-0000-000000530201', 'Ad Editara Descripcion 53', 'phone', '+5213300000316',
   'active', (select v_now from test_now_53), (select v_now + interval '30 days' from test_now_53));

-- ── ad_zones: XOR municipio/colonia (169.1). Nacional (530301) sin filas. ──
insert into public.ad_zones (ad_id, neighborhood_id) values
  ('00000000-0000-0000-0000-000000530302', (select neighborhood_a1_id from test_ctx_53)),
  ('00000000-0000-0000-0000-000000530305', (select neighborhood_b1_id from test_ctx_53)),
  ('00000000-0000-0000-0000-000000530306', (select neighborhood_a1_id from test_ctx_53)),
  ('00000000-0000-0000-0000-000000530307', (select neighborhood_a1_id from test_ctx_53)),
  ('00000000-0000-0000-0000-000000530308', (select neighborhood_a1_id from test_ctx_53)),
  ('00000000-0000-0000-0000-000000530309', (select neighborhood_a1_id from test_ctx_53)),
  ('00000000-0000-0000-0000-000000530310', (select neighborhood_a1_id from test_ctx_53)),
  ('00000000-0000-0000-0000-000000530311', (select neighborhood_a1_id from test_ctx_53)),
  ('00000000-0000-0000-0000-000000530312', (select neighborhood_a1_id from test_ctx_53)),
  ('00000000-0000-0000-0000-000000530313', (select neighborhood_a1_id from test_ctx_53)),
  ('00000000-0000-0000-0000-000000530314', (select neighborhood_a1_id from test_ctx_53)),
  ('00000000-0000-0000-0000-000000530315', (select neighborhood_a1_id from test_ctx_53)),
  ('00000000-0000-0000-0000-000000530316', (select neighborhood_a1_id from test_ctx_53));
insert into public.ad_zones (ad_id, municipality_id) values
  ('00000000-0000-0000-0000-000000530303', '53001'),
  ('00000000-0000-0000-0000-000000530304', '53002');

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Firma pública — has_function + catálogo EXACTO (pg_get_function_result/
--    arguments), leído del catálogo, no reescrito a mano. Cualquier columna
--    de agencies de más (contact_phone, status, created_by_user_id...) rompe
--    este match por construcción.
-- ════════════════════════════════════════════════════════════════════════════

select has_function('public', 'ads_for_zone',
  array['double precision', 'double precision', 'bigint', 'text'],
  'FUNC1_ads_for_zone_existe_con_la_firma_pl_lat_pl_lng_bigint_text');

create temp table result_sig_53 (ok boolean, result_sig text, args_sig text, err_sqlstate text);
do $$
declare
  v_oid oid;
begin
  v_oid := to_regprocedure('public.ads_for_zone(double precision, double precision, bigint, text)');
  if v_oid is null then
    insert into result_sig_53 values (false, null, null, 'function_not_found');
  else
    insert into result_sig_53
    select true, pg_get_function_result(v_oid), pg_get_function_arguments(v_oid), null;
  end if;
exception when others then
  insert into result_sig_53 values (false, null, null, sqlstate);
end $$;

select is((select ok from result_sig_53), true,
  'SIG1_la_funcion_resuelve_por_catalogo_con_la_firma_esperada');
-- #213 (213.3): `property_id uuid` se agrega AL FINAL. El assert NO se
-- debilita — sigue siendo la firma EXACTA, y sigue excluyendo por
-- construccion cualquier columna de agencies que un usuario final no debe ver
-- (contact_phone, status, created_by_user_id...). Lo unico que cambia es el
-- contrato: un anuncio ahora trae creative_id (display) XOR property_id
-- (promocion de una publicacion). El orden de las 9 anteriores es intocable:
-- los builds instalados leen por nombre y una reordenacion no los rompe, pero
-- perder o renombrar una si.
select is(
  (select result_sig from result_sig_53),
  'TABLE(id uuid, creative_id uuid, title text, description text, cta_type ad_cta_type, cta_value text, cloudflare_uid text, agency_name text, agency_logo_url text, property_id uuid)',
  'SIG2_firma_de_retorno_EXACTA_10_columnas_incluye_description_agency_name_agency_logo_url_property_id_y_nada_mas_de_agencies'
);
select is(
  (select args_sig from result_sig_53),
  'p_lat double precision, p_lng double precision, p_neighborhood_id bigint DEFAULT NULL::bigint, p_municipality_id text DEFAULT NULL::text',
  'SIG3_argumentos_EXACTOS_p_neighborhood_id_es_bigint_NO_uuid_ambos_con_default_null'
);

select is(
  (select prosecdef from pg_proc where proname = 'ads_for_zone' and pronamespace = 'public'::regnamespace),
  true,
  'SIG4_ads_for_zone_es_security_definer'
);
select is(
  (select proconfig::text[] @> array['search_path=public, pg_temp'] from pg_proc
    where proname = 'ads_for_zone' and pronamespace = 'public'::regnamespace),
  true,
  'SIG5_search_path_fijo_a_public_pg_temp_sin_depender_del_search_path_del_caller'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Permisos — anon NO puede ejecutar (42501 explícito); authenticated SÍ.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select * from public.ads_for_zone(19.31, -99.29, null, null) $$,
  '42501', null,
  'GRANT1_anon_no_puede_ejecutar_ads_for_zone_sin_grant_de_execute'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000530001', 'authenticated');
create temp table result_grant_auth_53 (ok boolean, err_sqlstate text);
do $$
begin
  perform count(*) from public.ads_for_zone(19.31, -99.29, null, null);
  insert into result_grant_auth_53 values (true, null);
exception when others then
  insert into result_grant_auth_53 values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_grant_auth_53), true,
  'GRANT2_authenticated_puede_ejecutar_ads_for_zone');

-- ════════════════════════════════════════════════════════════════════════════
-- 3) CALL1 — sin zona activa, punto DENTRO de la colonia A1 (ST_Intersects).
--    Batch: controles presentes + TODAS las violaciones de elegibilidad
--    ausentes en la MISMA llamada (nunca vacío-por-accidente: los controles
--    presentes prueban que la llamada sí funciona).
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_call1 (ok boolean, err_sqlstate text);
create temp table result_call1_rows (
  id uuid, title text, description text, cta_type text, cta_value text,
  cloudflare_uid text, agency_name text, agency_logo_url text
);
do $$
begin
  insert into result_call1_rows
  select id, title, description, cta_type::text, cta_value, cloudflare_uid, agency_name, agency_logo_url
  from public.ads_for_zone(19.31, -99.29, null, null);
  insert into result_call1 values (true, null);
exception when others then
  insert into result_call1 values (false, sqlstate);
end $$;

select is((select ok from result_call1), true, 'CALL1_no_lanza_excepcion');
select is((select count(*)::int from result_call1_rows), 7,
  'CALL1_conteo_exacto_7_ads_elegibles_los_9_violadores_quedan_fuera');

-- Controles presentes.
select is((select count(*)::int from result_call1_rows where id = '00000000-0000-0000-0000-000000530301'), 1,
  'CALL1_CTRL1_ad_nacional_presente_dentro_de_colonia_A1');
select is((select count(*)::int from result_call1_rows where id = '00000000-0000-0000-0000-000000530302'), 1,
  'CALL1_CTRL2_ad_de_colonia_A1_presente_ST_Intersects_resolvio_la_colonia');
select is((select count(*)::int from result_call1_rows where id = '00000000-0000-0000-0000-000000530303'), 1,
  'CALL1_CTRL3_ad_de_municipio_A_presente_via_join_colonia_a_municipio');
select is((select count(*)::int from result_call1_rows where id = '00000000-0000-0000-0000-000000530313'), 1,
  'CALL1_CTRL4_ad_sera_pausado_TODAVIA_activo_presente_antes_de_la_transicion');
select is((select count(*)::int from result_call1_rows where id = '00000000-0000-0000-0000-000000530314'), 1,
  'CALL1_CTRL5_ad_sera_rechazado_TODAVIA_activo_presente_antes_de_la_transicion');
select is((select count(*)::int from result_call1_rows where id = '00000000-0000-0000-0000-000000530315'), 1,
  'CALL1_CTRL6_ad_sera_expirado_TODAVIA_activo_presente_antes_de_la_transicion');
select is((select count(*)::int from result_call1_rows where id = '00000000-0000-0000-0000-000000530316'), 1,
  'CALL1_CTRL7_ad_editara_descripcion_presente_antes_de_editarla');

-- Ausentes: otra zona (municipio/colonia B).
select is((select count(*)::int from result_call1_rows where id = '00000000-0000-0000-0000-000000530304'), 0,
  'CALL1_ELEG1_ad_de_municipio_B_no_sale_en_colonia_A1_otro_municipio');
select is((select count(*)::int from result_call1_rows where id = '00000000-0000-0000-0000-000000530305'), 0,
  'CALL1_ELEG2_ad_de_colonia_B1_no_sale_en_colonia_A1');

-- Ausentes: elegibilidad, todas zonadas a A1 (única explicación = su propio estado).
select is((select count(*)::int from result_call1_rows where id = '00000000-0000-0000-0000-000000530306'), 0,
  'CALL1_ELEG3_ad_draft_no_sale');
select is((select count(*)::int from result_call1_rows where id = '00000000-0000-0000-0000-000000530307'), 0,
  'CALL1_ELEG4_ad_pending_review_no_sale');
select is((select count(*)::int from result_call1_rows where id = '00000000-0000-0000-0000-000000530308'), 0,
  'CALL1_ELEG5_ad_con_vigencia_que_todavia_no_empieza_no_sale');
select is((select count(*)::int from result_call1_rows where id = '00000000-0000-0000-0000-000000530309'), 0,
  'CALL1_ELEG6_ad_con_vigencia_ya_vencida_no_sale');
select is((select count(*)::int from result_call1_rows where id = '00000000-0000-0000-0000-000000530310'), 0,
  'CALL1_ELEG7_ad_con_creativo_uploading_no_sale');
select is((select count(*)::int from result_call1_rows where id = '00000000-0000-0000-0000-000000530311'), 0,
  'CALL1_ELEG8_ad_con_creativo_processing_no_sale');
select is((select count(*)::int from result_call1_rows where id = '00000000-0000-0000-0000-000000530312'), 0,
  'CALL1_ELEG9_ad_con_creativo_failed_no_sale');

-- ── Round-trip de columnas (fuente independiente: los literales sembrados) ──
select is((select title from result_call1_rows where id = '00000000-0000-0000-0000-000000530302'),
  'Ad Colonia A1 53', 'COL1_title_coincide_con_el_literal_sembrado');
select is((select description from result_call1_rows where id = '00000000-0000-0000-0000-000000530302'),
  'Descripción real de la colonia A1, edición 53', 'COL2_description_coincide_con_el_literal_sembrado');
select is((select cta_type from result_call1_rows where id = '00000000-0000-0000-0000-000000530302'),
  'whatsapp', 'COL3_cta_type_coincide_con_el_literal_sembrado');
select is((select cta_value from result_call1_rows where id = '00000000-0000-0000-0000-000000530302'),
  '+5213312345678', 'COL4_cta_value_coincide_con_el_literal_sembrado');
select is((select cloudflare_uid from result_call1_rows where id = '00000000-0000-0000-0000-000000530302'),
  'cf-uid-adszone53-a-ready', 'COL5_cloudflare_uid_viene_del_ad_creatives_correcto');
select is((select agency_name from result_call1_rows where id = '00000000-0000-0000-0000-000000530302'),
  'Agencia Zona A 53', 'COL6_agency_name_coincide_con_agencies_name_del_dueno_del_ad');
select is((select agency_logo_url from result_call1_rows where id = '00000000-0000-0000-0000-000000530302'),
  'https://cdn.urbea.mx/logos/zona-a-53.png', 'COL7_agency_logo_url_coincide_con_agencies_logo_url_del_dueno_del_ad');
select is(
  (select description is null from result_call1_rows where id = '00000000-0000-0000-0000-000000530301'),
  true,
  'COL8_description_NULL_se_preserva_como_NULL_no_se_inventa_texto_vacio'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Precedencia — zona activa DECLARADA gana sobre GPS (colonia y municipio).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 4.1) Colonia declarada, GPS "fuera de todo" -- la colonia sigue sirviendo.
create temp table result_call2 (ok boolean, err_sqlstate text);
create temp table result_call2_rows (id uuid);
do $$
begin
  insert into result_call2_rows
  select id from public.ads_for_zone(1.0, 1.0, (select neighborhood_a1_id from test_ctx_53), null);
  insert into result_call2 values (true, null);
exception when others then
  insert into result_call2 values (false, sqlstate);
end $$;

select is((select ok from result_call2), true, 'CALL2_no_lanza_excepcion');
-- 7, no 3: además de nacional+colonia A1+municipio A, los 4 ads de la
-- sección 8 (530313-530316) TODAVÍA están 'active' en este punto del script
-- (sus transiciones ocurren después) y también están zonados a colonia A1 --
-- correcto que aparezcan aquí también, es la misma colonia declarada.
select is((select count(*)::int from result_call2_rows), 7,
  'CALL2_conteo_exacto_7_nacional_mas_colonia_A1_mas_municipio_A_mas_los_4_ads_aun_activos_de_la_seccion_8');
select is((select count(*)::int from result_call2_rows where id = '00000000-0000-0000-0000-000000530301'), 1,
  'CALL2_PREC1_nacional_presente');
select is((select count(*)::int from result_call2_rows where id = '00000000-0000-0000-0000-000000530302'), 1,
  'CALL2_PREC2_colonia_A1_declarada_gana_sobre_GPS_que_apunta_a_ningun_lado');
select is((select count(*)::int from result_call2_rows where id = '00000000-0000-0000-0000-000000530303'), 1,
  'CALL2_PREC3_municipio_A_tambien_presente_via_la_colonia_declarada');
select is((select count(*)::int from result_call2_rows where id = '00000000-0000-0000-0000-000000530304'), 0,
  'CALL2_PREC4_municipio_B_ausente_la_zona_declarada_es_A1_no_B');
select is((select count(*)::int from result_call2_rows where id = '00000000-0000-0000-0000-000000530305'), 0,
  'CALL2_PREC5_colonia_B1_ausente');

-- ── 4.2) Municipio declarado, GPS DENTRO de colonia A1 -- el municipio
--    declarado gana; también fija "zona declarada que no corresponde a las
--    coordenadas sirve la zona DECLARADA" como comportamiento explícito.
create temp table result_call3 (ok boolean, err_sqlstate text);
create temp table result_call3_rows (id uuid);
do $$
begin
  insert into result_call3_rows
  select id from public.ads_for_zone(19.31, -99.29, null, '53002');
  insert into result_call3 values (true, null);
exception when others then
  insert into result_call3 values (false, sqlstate);
end $$;

select is((select ok from result_call3), true, 'CALL3_no_lanza_excepcion');
select is((select count(*)::int from result_call3_rows), 2,
  'CALL3_conteo_exacto_2_nacional_mas_municipio_B_declarado');
select is((select count(*)::int from result_call3_rows where id = '00000000-0000-0000-0000-000000530301'), 1,
  'CALL3_PREC1_nacional_presente');
select is((select count(*)::int from result_call3_rows where id = '00000000-0000-0000-0000-000000530304'), 1,
  'CALL3_PREC2_municipio_B_declarado_gana_sobre_GPS_que_fisicamente_esta_en_A1'
);
select is((select count(*)::int from result_call3_rows where id = '00000000-0000-0000-0000-000000530302'), 0,
  'CALL3_PREC3_colonia_A1_ausente_pese_a_que_el_GPS_cae_fisicamente_ahi_la_zona_declarada_manda'
);
select is((select count(*)::int from result_call3_rows where id = '00000000-0000-0000-0000-000000530303'), 0,
  'CALL3_PREC4_municipio_A_ausente_mismo_motivo'
);
select is((select count(*)::int from result_call3_rows where id = '00000000-0000-0000-0000-000000530305'), 0,
  'CALL3_PREC5_colonia_B1_ausente_declarar_el_municipio_no_implica_una_colonia_especifica'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Fallback por bbox — punto fuera de TODO polígono pero dentro del bbox
--    del municipio A (el hueco de cobertura DCAH, gotcha de #157) ⇒ municipal
--    + nacional, NUNCA vacío. La colonia NO se sirve (no hay colonia resuelta).
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_call4 (ok boolean, err_sqlstate text);
create temp table result_call4_rows (id uuid);
do $$
begin
  insert into result_call4_rows
  select id from public.ads_for_zone(19.50, -99.45, null, null);
  insert into result_call4 values (true, null);
exception when others then
  insert into result_call4 values (false, sqlstate);
end $$;

select is((select ok from result_call4), true, 'CALL4_no_lanza_excepcion');
select is(
  'nacional:' || (select (count(*) > 0)::text from result_call4_rows where id = '00000000-0000-0000-0000-000000530301')
  || '->vacio:' || (select (count(*) = 0)::text from result_call4_rows),
  'nacional:true->vacio:false',
  'CALL4_INVARIANTE1_el_hueco_del_dataset_NUNCA_se_vuelve_sin_anuncios_hay_al_menos_el_nacional'
);
select is((select count(*)::int from result_call4_rows), 2,
  'CALL4_conteo_exacto_2_nacional_mas_municipio_A_por_bbox');
select is((select count(*)::int from result_call4_rows where id = '00000000-0000-0000-0000-000000530303'), 1,
  'CALL4_BBOX1_municipio_A_presente_via_fallback_de_bbox');
select is((select count(*)::int from result_call4_rows where id = '00000000-0000-0000-0000-000000530302'), 0,
  'CALL4_BBOX2_colonia_A1_ausente_el_punto_esta_fuera_del_poligono_no_hay_colonia_resuelta'
);
select is((select count(*)::int from result_call4_rows where id = '00000000-0000-0000-0000-000000530304'), 0,
  'CALL4_BBOX3_municipio_B_ausente_el_bbox_que_matchea_es_el_de_A');

-- ════════════════════════════════════════════════════════════════════════════
-- 5b) Fallback por bbox — BORDES por eje. El municipio A tiene
--    bbox_min_lat=19.20, bbox_max_lat=19.60, bbox_min_lng=-99.50,
--    bbox_max_lng=-99.00. Puntos a 0.01° del bbox_max de CADA eje por
--    separado (lng fijo en rango cuando se prueba lat, y viceversa), NUNCA
--    dentro de ningún polígono (colonia A1/B1 están lejísimos de estos
--    puntos). Un punto a solo 0.01° del borde muere con CUALQUIER inflado
--    ≥0.05° (todos los reportados: 0.05, 0.10, 0.50, 1.00, 2.00, 5.00,
--    10.00 -- el punto cae DENTRO del bbox inflado en los 7 casos) y, al
--    fijar el otro eje bien adentro del rango, también muere si se borra la
--    condición de ESE eje en particular (el eje fijo sigue matcheando solo).
-- ════════════════════════════════════════════════════════════════════════════

-- ── LAT — justo AFUERA del bbox_max_lat (19.61 > 19.60), lng bien adentro.
create temp table result_call_bbox_lat_out (ok boolean, err_sqlstate text);
create temp table result_call_bbox_lat_out_rows (id uuid);
do $$
begin
  insert into result_call_bbox_lat_out_rows
  select id from public.ads_for_zone(19.61, -99.25, null, null);
  insert into result_call_bbox_lat_out values (true, null);
exception when others then
  insert into result_call_bbox_lat_out values (false, sqlstate);
end $$;

select is((select ok from result_call_bbox_lat_out), true, 'BBOXEDGE_LAT_OUT1_no_lanza_excepcion');
select is((select count(*)::int from result_call_bbox_lat_out_rows), 1,
  'BBOXEDGE_LAT_OUT2_conteo_exacto_1_solo_el_nacional_el_punto_esta_0_01_grados_afuera_del_bbox_max_lat');
select is((select count(*)::int from result_call_bbox_lat_out_rows where id = '00000000-0000-0000-0000-000000530301'), 1,
  'BBOXEDGE_LAT_OUT3_nacional_presente_confirma_que_la_llamada_no_esta_rota');
select is((select count(*)::int from result_call_bbox_lat_out_rows where id = '00000000-0000-0000-0000-000000530303'), 0,
  'BBOXEDGE_LAT_OUT4_municipio_A_ausente_0_01_grados_afuera_del_borde_de_latitud_mata_inflados_de_0_05_a_10_grados_y_borrar_la_condicion_de_latitud'
);

-- ── LAT — justo ADENTRO del bbox_max_lat (19.59 < 19.60), mismo lng.
create temp table result_call_bbox_lat_in (ok boolean, err_sqlstate text);
create temp table result_call_bbox_lat_in_rows (id uuid);
do $$
begin
  insert into result_call_bbox_lat_in_rows
  select id from public.ads_for_zone(19.59, -99.25, null, null);
  insert into result_call_bbox_lat_in values (true, null);
exception when others then
  insert into result_call_bbox_lat_in values (false, sqlstate);
end $$;

select is((select ok from result_call_bbox_lat_in), true, 'BBOXEDGE_LAT_IN1_no_lanza_excepcion');
select is((select count(*)::int from result_call_bbox_lat_in_rows), 2,
  'BBOXEDGE_LAT_IN2_conteo_exacto_2_nacional_mas_municipio_A_el_punto_esta_0_01_grados_adentro_del_bbox_max_lat');
select is((select count(*)::int from result_call_bbox_lat_in_rows where id = '00000000-0000-0000-0000-000000530303'), 1,
  'BBOXEDGE_LAT_IN3_municipio_A_presente_justo_adentro_del_borde_de_latitud');
select is((select count(*)::int from result_call_bbox_lat_in_rows where id = '00000000-0000-0000-0000-000000530301'), 1,
  'BBOXEDGE_LAT_IN4_nacional_tambien_presente');
select is((select count(*)::int from result_call_bbox_lat_in_rows where id = '00000000-0000-0000-0000-000000530302'), 0,
  'BBOXEDGE_LAT_IN5_colonia_A1_ausente_el_punto_sigue_fuera_de_todo_poligono_solo_matchea_el_bbox');

-- ── LNG — justo AFUERA del bbox_max_lng (-98.99 > -99.00), lat bien adentro.
create temp table result_call_bbox_lng_out (ok boolean, err_sqlstate text);
create temp table result_call_bbox_lng_out_rows (id uuid);
do $$
begin
  insert into result_call_bbox_lng_out_rows
  select id from public.ads_for_zone(19.40, -98.99, null, null);
  insert into result_call_bbox_lng_out values (true, null);
exception when others then
  insert into result_call_bbox_lng_out values (false, sqlstate);
end $$;

select is((select ok from result_call_bbox_lng_out), true, 'BBOXEDGE_LNG_OUT1_no_lanza_excepcion');
select is((select count(*)::int from result_call_bbox_lng_out_rows), 1,
  'BBOXEDGE_LNG_OUT2_conteo_exacto_1_solo_el_nacional_el_punto_esta_0_01_grados_afuera_del_bbox_max_lng');
select is((select count(*)::int from result_call_bbox_lng_out_rows where id = '00000000-0000-0000-0000-000000530301'), 1,
  'BBOXEDGE_LNG_OUT3_nacional_presente_confirma_que_la_llamada_no_esta_rota');
select is((select count(*)::int from result_call_bbox_lng_out_rows where id = '00000000-0000-0000-0000-000000530303'), 0,
  'BBOXEDGE_LNG_OUT4_municipio_A_ausente_0_01_grados_afuera_del_borde_de_longitud_mata_inflados_de_0_05_a_10_grados_y_borrar_la_condicion_de_longitud'
);

-- ── LNG — justo ADENTRO del bbox_max_lng (-99.01 < -99.00), misma lat.
create temp table result_call_bbox_lng_in (ok boolean, err_sqlstate text);
create temp table result_call_bbox_lng_in_rows (id uuid);
do $$
begin
  insert into result_call_bbox_lng_in_rows
  select id from public.ads_for_zone(19.40, -99.01, null, null);
  insert into result_call_bbox_lng_in values (true, null);
exception when others then
  insert into result_call_bbox_lng_in values (false, sqlstate);
end $$;

select is((select ok from result_call_bbox_lng_in), true, 'BBOXEDGE_LNG_IN1_no_lanza_excepcion');
select is((select count(*)::int from result_call_bbox_lng_in_rows), 2,
  'BBOXEDGE_LNG_IN2_conteo_exacto_2_nacional_mas_municipio_A_el_punto_esta_0_01_grados_adentro_del_bbox_max_lng');
select is((select count(*)::int from result_call_bbox_lng_in_rows where id = '00000000-0000-0000-0000-000000530303'), 1,
  'BBOXEDGE_LNG_IN3_municipio_A_presente_justo_adentro_del_borde_de_longitud');
select is((select count(*)::int from result_call_bbox_lng_in_rows where id = '00000000-0000-0000-0000-000000530301'), 1,
  'BBOXEDGE_LNG_IN4_nacional_tambien_presente');
select is((select count(*)::int from result_call_bbox_lng_in_rows where id = '00000000-0000-0000-0000-000000530302'), 0,
  'BBOXEDGE_LNG_IN5_colonia_A1_ausente_el_punto_sigue_fuera_de_todo_poligono_solo_matchea_el_bbox');

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Fuera de TODO — ni polígono ni bbox matchean ⇒ SOLO inventario nacional.
--    🔒 Este es el assert central de la subtarea: el hueco del dataset nunca
--    se convierte en "sin anuncios" -- aquí ni siquiera hay municipio.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_call5 (ok boolean, err_sqlstate text);
create temp table result_call5_rows (id uuid);
do $$
begin
  insert into result_call5_rows
  select id from public.ads_for_zone(1.0, 1.0, null, null);
  insert into result_call5 values (true, null);
exception when others then
  insert into result_call5 values (false, sqlstate);
end $$;

select is((select ok from result_call5), true, 'CALL5_no_lanza_excepcion');
select is(
  'nacional:' || (select (count(*) > 0)::text from result_call5_rows where id = '00000000-0000-0000-0000-000000530301')
  || '->municipio_o_colonia:' || (select (count(*) > 0)::text from result_call5_rows
       where id in ('00000000-0000-0000-0000-000000530302','00000000-0000-0000-0000-000000530303',
                    '00000000-0000-0000-0000-000000530304','00000000-0000-0000-0000-000000530305')),
  'nacional:true->municipio_o_colonia:false',
  'CALL5_INVARIANTE2_fuera_de_TODO_poligono_Y_TODO_bbox_solo_queda_el_inventario_NACIONAL_nunca_vacio'
);
select is((select count(*)::int from result_call5_rows), 1,
  'CALL5_conteo_exacto_1_los_otros_3_nacionales_inelegibles_530317_18_19_fueron_filtrados_no_es_que_solo_haya_uno');

-- Los 3 violadores NACIONALES (sin ad_zones, sección 0) deben quedar fuera
-- AQUÍ TAMBIÉN -- es la única llamada 100% nacional del archivo, la que
-- ejercita la rama "not exists ad_zones" contra un ad realmente inelegible.
select is((select count(*)::int from result_call5_rows where id = '00000000-0000-0000-0000-000000530317'), 0,
  'CALL5_ELEG10_ad_nacional_pending_review_no_sale_ni_en_la_rama_100_nacional');
select is((select count(*)::int from result_call5_rows where id = '00000000-0000-0000-0000-000000530318'), 0,
  'CALL5_ELEG11_ad_nacional_vigencia_vencida_no_sale_ni_en_la_rama_100_nacional');
select is((select count(*)::int from result_call5_rows where id = '00000000-0000-0000-0000-000000530319'), 0,
  'CALL5_ELEG12_ad_nacional_creativo_failed_no_sale_ni_en_la_rama_100_nacional');

-- ANCLAJE DE FIXTURE (hallazgo F01 del guardián, 2do arbitraje): sin esto, borrar
-- los INSERT de 530317/318/319 deja los 3 asserts de arriba en VERDE -- afirmarían
-- una defensa sobre ads que no existen. Es el antipatrón que ya mordió 7 veces en
-- esta épica. Se ancla la EXISTENCIA y el MECANISMO que hace inelegible a cada uno,
-- con el mismo patrón que TRANS1-4.
select is((select status::text from public.ads where id = '00000000-0000-0000-0000-000000530317'),
  'pending_review',
  'FIXTURE_ANCLA1_530317_existe_y_es_pending_review_lo_que_hace_real_a_CALL5_ELEG10');
select is((select (ends_at < now())::boolean from public.ads where id = '00000000-0000-0000-0000-000000530318'),
  true,
  'FIXTURE_ANCLA2_530318_existe_y_su_vigencia_esta_VENCIDA_lo_que_hace_real_a_CALL5_ELEG11');
select is((select c.status::text from public.ads a join public.ad_creatives c on c.id = a.creative_id
           where a.id = '00000000-0000-0000-0000-000000530319'),
  'failed',
  'FIXTURE_ANCLA3_530319_existe_y_su_creativo_esta_failed_lo_que_hace_real_a_CALL5_ELEG12');
select is((select count(*)::int from public.ad_zones
           where ad_id in ('00000000-0000-0000-0000-000000530317',
                           '00000000-0000-0000-0000-000000530318',
                           '00000000-0000-0000-0000-000000530319')), 0,
  'FIXTURE_ANCLA4_los_3_violadores_son_NACIONALES_de_verdad_cero_filas_en_ad_zones_sin_esto_probarian_la_rama_zonada');

-- ════════════════════════════════════════════════════════════════════════════
-- 7) Simetría + "sale en cualquier zona" — ST_Intersects contra la OTRA
--    colonia (B1), confirmando que el nacional se sirve en un SEGUNDO
--    contexto geográfico completamente distinto (no es casualidad de A1).
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_call8 (ok boolean, err_sqlstate text);
create temp table result_call8_rows (id uuid);
do $$
begin
  insert into result_call8_rows
  select id from public.ads_for_zone(20.31, -100.29, null, null);
  insert into result_call8 values (true, null);
exception when others then
  insert into result_call8 values (false, sqlstate);
end $$;

select is((select ok from result_call8), true, 'CALL8_no_lanza_excepcion');
select is((select count(*)::int from result_call8_rows), 3,
  'CALL8_conteo_exacto_3_nacional_mas_colonia_B1_mas_municipio_B');
select is((select count(*)::int from result_call8_rows where id = '00000000-0000-0000-0000-000000530301'), 1,
  'CALL8_NAC1_ad_nacional_sale_TAMBIEN_en_colonia_B1_no_es_casualidad_de_A1');
select is((select count(*)::int from result_call8_rows where id = '00000000-0000-0000-0000-000000530305'), 1,
  'CALL8_SIM1_colonia_B1_presente_ST_Intersects_simetrico_al_de_A1');
select is((select count(*)::int from result_call8_rows where id = '00000000-0000-0000-0000-000000530304'), 1,
  'CALL8_SIM2_municipio_B_presente_via_join_colonia_a_municipio');
select is((select count(*)::int from result_call8_rows where id = '00000000-0000-0000-0000-000000530302'), 0,
  'CALL8_SIM3_colonia_A1_ausente_en_colonia_B1');
select is((select count(*)::int from result_call8_rows where id = '00000000-0000-0000-0000-000000530303'), 0,
  'CALL8_SIM4_municipio_A_ausente_en_colonia_B1');

-- ════════════════════════════════════════════════════════════════════════════
-- 8) Transiciones REALES (antes=activo/visible en CALL1 -> después=status
--    final/ausente) + efecto de #192 (edición de descripción demueve y por
--    lo tanto deja de servirse). Todo bajo el mismo admin identificado
--    (patrón GUC de 48/52_*).
-- ════════════════════════════════════════════════════════════════════════════

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000530003', true);

update public.ads set status = 'paused', paused_at = (select v_now from test_now_53)
 where id = '00000000-0000-0000-0000-000000530313';
select is((select status::text from public.ads where id = '00000000-0000-0000-0000-000000530313'),
  'paused', 'TRANS1_mecanismo_la_transicion_active_a_paused_se_aplico_realmente');

update public.ads set status = 'rejected', rejection_reason = 'Motivo de prueba 53'
 where id = '00000000-0000-0000-0000-000000530314';
select is((select status::text from public.ads where id = '00000000-0000-0000-0000-000000530314'),
  'rejected', 'TRANS2_mecanismo_la_transicion_active_a_rejected_se_aplico_realmente');

update public.ads set status = 'expired'
 where id = '00000000-0000-0000-0000-000000530315';
select is((select status::text from public.ads where id = '00000000-0000-0000-0000-000000530315'),
  'expired', 'TRANS3_mecanismo_la_transicion_active_a_expired_se_aplico_realmente');

-- #192: editar la descripción de un ad active lo demueve a pending_review
-- (trigger ads_description_review, YA desplegado -- 20260818000001).
update public.ads set description = 'Promo nueva colonia A1 53, edición posterior'
 where id = '00000000-0000-0000-0000-000000530316';
select is((select status::text from public.ads where id = '00000000-0000-0000-0000-000000530316'),
  'pending_review', 'TRANS4_mecanismo_192_editar_la_descripcion_de_un_ad_active_lo_demueve_a_pending_review');

-- ── CALL_AFTER: mismos argumentos EXACTOS que CALL1, después de las 4
--    transiciones -- comparación antes(CALL1)->después(CALL_AFTER).
create temp table result_call_after (ok boolean, err_sqlstate text);
create temp table result_call_after_rows (id uuid);
do $$
begin
  insert into result_call_after_rows
  select id from public.ads_for_zone(19.31, -99.29, null, null);
  insert into result_call_after values (true, null);
exception when others then
  insert into result_call_after values (false, sqlstate);
end $$;

select is((select ok from result_call_after), true, 'CALL_AFTER_no_lanza_excepcion');

-- Controles vigentes (nacional/colonia/municipio propios) siguen presentes.
select is((select count(*)::int from result_call_after_rows where id = '00000000-0000-0000-0000-000000530301'), 1,
  'CALL_AFTER_CTRL1_nacional_sigue_presente_las_transiciones_no_lo_tocaron');
select is((select count(*)::int from result_call_after_rows where id = '00000000-0000-0000-0000-000000530302'), 1,
  'CALL_AFTER_CTRL2_colonia_A1_sigue_presente');
select is((select count(*)::int from result_call_after_rows where id = '00000000-0000-0000-0000-000000530303'), 1,
  'CALL_AFTER_CTRL3_municipio_A_sigue_presente');

-- Assert COMPUESTO antes(CALL1)->después(CALL_AFTER) para cada transición.
select is(
  (select (count(*) > 0)::text from result_call1_rows where id = '00000000-0000-0000-0000-000000530313')
  || '->' ||
  (select (count(*) > 0)::text from result_call_after_rows where id = '00000000-0000-0000-0000-000000530313'),
  'true->false',
  'PAUSED1_antes_activo_y_visible_en_CALL1_despues_pausado_y_ausente_en_CALL_AFTER'
);
select is(
  (select (count(*) > 0)::text from result_call1_rows where id = '00000000-0000-0000-0000-000000530314')
  || '->' ||
  (select (count(*) > 0)::text from result_call_after_rows where id = '00000000-0000-0000-0000-000000530314'),
  'true->false',
  'REJECTED1_antes_activo_y_visible_en_CALL1_despues_rejected_y_ausente_en_CALL_AFTER'
);
select is(
  (select (count(*) > 0)::text from result_call1_rows where id = '00000000-0000-0000-0000-000000530315')
  || '->' ||
  (select (count(*) > 0)::text from result_call_after_rows where id = '00000000-0000-0000-0000-000000530315'),
  'true->false',
  'EXPIRED1_antes_activo_y_visible_en_CALL1_despues_expired_y_ausente_en_CALL_AFTER'
);
select is(
  (select (count(*) > 0)::text from result_call1_rows where id = '00000000-0000-0000-0000-000000530316')
  || '->' ||
  (select (count(*) > 0)::text from result_call_after_rows where id = '00000000-0000-0000-0000-000000530316'),
  'true->false',
  'DEMO192_1_antes_activo_y_visible_en_CALL1_despues_de_editar_description_pending_review_y_ausente_en_CALL_AFTER'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 9) Duplicación por ad_zones múltiples — un ad puede tener VARIAS filas en
--    ad_zones (caso real: un anunciante compra la colonia Y su municipio, o
--    varias colonias). Un `left join ad_zones` en vez del `exists` produciría
--    una fila POR CADA fila de ad_zones que matchee -- este ad tiene 2 filas
--    que matchean SIMULTÁNEAMENTE la misma consulta (neighborhood_id=A1 Y
--    municipality_id=53001, y resolver la colonia A1 SIEMPRE resuelve
--    también su municipio -- ver el join de la función). Insertado DESPUÉS
--    de las transiciones de la sección 8 para no alterar sus conteos.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, description, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000530320', '00000000-0000-0000-0000-000000530101',
   '00000000-0000-0000-0000-000000530201', 'Ad Multi Zona Duplicado 53', 'phone', '+5213300000320',
   'active', 'Colonia A1 y municipio A simultaneos 53',
   (select v_now from test_now_53), (select v_now + interval '30 days' from test_now_53));
insert into public.ad_zones (ad_id, neighborhood_id) values
  ('00000000-0000-0000-0000-000000530320', (select neighborhood_a1_id from test_ctx_53));
insert into public.ad_zones (ad_id, municipality_id) values
  ('00000000-0000-0000-0000-000000530320', '53001');

create temp table result_call_dup (ok boolean, err_sqlstate text);
create temp table result_call_dup_rows (id uuid);
do $$
begin
  insert into result_call_dup_rows
  select id from public.ads_for_zone(19.31, -99.29, null, null);
  insert into result_call_dup values (true, null);
exception when others then
  insert into result_call_dup values (false, sqlstate);
end $$;

select is((select ok from result_call_dup), true, 'DUP1_no_lanza_excepcion');
-- 4 = nacional(530301) + colonia_A1(530302) + municipio_A(530303) + el ad
-- multi-zona(530320) -- los 4 ads de la sección 8 YA transicionaron y quedan
-- fuera (paused/rejected/expired/pending_review), igual que en CALL_AFTER.
select is((select count(*)::int from result_call_dup_rows), 4,
  'DUP2_conteo_exacto_4_el_ad_multi_zona_no_se_duplico_pese_a_matchear_DOS_filas_de_ad_zones_a_la_vez');
select is((select count(*)::int from result_call_dup_rows where id = '00000000-0000-0000-0000-000000530320'), 1,
  'DUP3_el_ad_con_neighborhood_A1_Y_municipality_53001_a_la_vez_sale_EXACTAMENTE_UNA_VEZ_no_dos'
);
select is((select count(*)::int from result_call_dup_rows where id = '00000000-0000-0000-0000-000000530301'), 1,
  'DUP4_nacional_sigue_presente_confirma_que_la_llamada_no_esta_rota');

-- ANCLAJE DE FIXTURE (hallazgo F02 del guardián): sin esto, borrar las 2 filas de
-- ad_zones de 530320 deja DUP2/DUP3 en VERDE -- el ad pasaría a NACIONAL, saldría
-- una vez igual, y el test dejaría de probar la no-duplicación sin ponerse rojo.
select is((select count(*)::int from public.ad_zones where ad_id = '00000000-0000-0000-0000-000000530320'), 2,
  'FIXTURE_ANCLA5_530320_matchea_DOS_filas_de_ad_zones_a_la_vez_sin_esto_DUP2_y_DUP3_no_prueban_nada');

select * from finish();
rollback;
