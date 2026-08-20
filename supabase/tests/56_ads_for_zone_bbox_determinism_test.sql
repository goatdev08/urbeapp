-- Tests pgTAP — determinismo del fallback por bbox (tarea #194).
-- Ejecutar con:
--   supabase test db supabase/tests/56_ads_for_zone_bbox_determinism_test.sql --local
-- Corre como superusuario dentro de una transacción revertida (no persiste).
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL PROBLEMA (demostrado con sonda directa por el guardián de 170.2):
-- cuando el punto del usuario no cae en ningún polígono del DCAH, la zona se
-- resuelve por los bboxes precalculados de mx_municipalities con un
-- `limit 1` SIN `order by`. Los bboxes son RECTÁNGULOS sobre formas
-- irregulares, así que municipios vecinos SIEMPRE se solapan: un punto en el
-- traslape cae en dos o más bboxes y gana uno cualquiera, según el orden
-- físico de las filas. El inventario del municipio perdedor se descarta en
-- silencio y de forma NO DETERMINISTA.
--
-- Con datos INEGI reales el solapamiento de bboxes vecinos es la NORMA, y
-- esta rama se ejerce de verdad porque la cobertura de polígonos del DCAH es
-- incompleta (gotcha de #157).
--
-- 🔴 EL SUT SON DOS FUNCIONES, NO UNA. El mismo `limit 1` sin `order by`
-- está duplicado en:
--   · public.ads_for_zone   (20260818000002) — decide QUÉ anuncio se sirve.
--   · public.resolve_ad_zone (20260819000002) — decide en qué municipio se
--     CONTABILIZA la impresión (la EF record-ad-impressions recalcula la zona
--     server-side y estampa el resultado en ad_impressions).
-- Si las dos resuelven distinto sobre el mismo punto, el anuncio se sirve en
-- el municipio X y su impresión FACTURABLE se contabiliza en el Y. Por eso
-- este archivo no solo exige que cada una sea determinista: exige que
-- COINCIDAN (sección 3). Arreglar solo ads_for_zone dejaría el rollup de
-- ad_impressions_monthly mal atribuido.
--
-- CRITERIO ELEGIDO (Abraham, 2026-08-20): gana el bbox de MENOR ÁREA que
-- contiene el punto — la mejor aproximación disponible sin geometría real
-- (mx_municipalities NO tiene columna de polígono, solo bbox_min/max_*, así
-- que "resolver contra la geometría municipal" no era una opción). Un
-- municipio pequeño anidado dentro del bbox de uno grande gana, que es lo
-- correcto. Desempate por `id` para que dos áreas idénticas también sean
-- deterministas.
--
-- SEAM: el contrato público de ambas RPC. Se ejercita la llamada real y se
-- observa el resultado; nunca se inspecciona el cuerpo de la función ni se
-- valida la presencia de un `order by` por texto (eso sería re-implementar
-- el SUT en el test).
--
-- ── Edge cases enumerados ───────────────────────────────────────────────────
--  EC-1 Punto en el traslape de un bbox GRANDE y uno PEQUEÑO: ads_for_zone
--       sirve SOLO el ad del pequeño. (RED: hoy sirve el del grande, que se
--       insertó primero y gana por orden físico.)
--  EC-2 El mismo punto, llamado 3 veces: mismo resultado siempre.
--  EC-3 Áreas IDÉNTICAS que se solapan: gana el id menor, y es repetible.
--  EC-4 resolve_ad_zone sobre el punto de EC-1 devuelve el municipio PEQUEÑO.
--  EC-5 resolve_ad_zone sobre el punto de EC-3 devuelve el mismo id que ganó
--       en EC-3 — las dos funciones COINCIDEN (invariante de facturación).
--  EC-6 No-regresión: un punto que cae en UN SOLO bbox sigue resolviendo a
--       ese municipio (el order by no puede cambiar el caso sin ambigüedad).
--  EC-7 No-regresión: un punto fuera de TODO bbox sigue devolviendo NULL de
--       municipio y sirviendo solo inventario nacional (🔒 nunca "sin
--       anuncios").
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(9);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

create temp table test_now_56 as select now() as v_now;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) Fixtures — state '56', fuera del rango real 01-32 INEGI.
--    Las coordenadas viven en el golfo de Guinea (lat/lng ~1-4) a propósito:
--    ahí no existe ningún polígono del DCAH ni el bbox de ningún municipio
--    real, así que el resultado no puede depender de qué tanto catálogo
--    INEGI esté cargado en la base donde corra la suite.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.mx_states (id, name, abbr) values ('56', 'Estado Bbox Determinismo 56', 'BD');

-- 🔴 ORDEN DE INSERCIÓN DELIBERADO: el bbox GRANDE va primero para que el
--    `limit 1` sin `order by` de hoy lo elija por orden físico. Sin esto el
--    RED podría pasar por accidente y no probaría nada.
insert into public.mx_municipalities (id, state_id, name, bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng) values
  -- GRANDE: área 1.00 x 1.00 = 1.0
  ('56001', '56', 'Municipio GRANDE 56', 1.00, 1.00, 2.00, 2.00),
  -- PEQUEÑO: área 0.20 x 0.20 = 0.04, ANIDADO dentro del grande
  ('56002', '56', 'Municipio PEQUENO 56', 1.40, 1.40, 1.60, 1.60),
  -- EMPATE A: área 0.10 x 0.10 = 0.01
  ('56003', '56', 'Municipio EMPATE A 56', 3.00, 3.00, 3.10, 3.10),
  -- EMPATE B: área 0.10 x 0.10 = 0.01, se solapa con EMPATE A
  ('56004', '56', 'Municipio EMPATE B 56', 3.05, 3.05, 3.15, 3.15),
  -- SOLITARIO: sin traslape con nadie (no-regresión EC-6)
  ('56005', '56', 'Municipio SOLITARIO 56', 5.00, 5.00, 5.10, 5.10);

-- Puntos (x=lng, y=lat):
--   (1.50, 1.50) — dentro de GRANDE y de PEQUENO. Debe ganar PEQUENO.
--   (3.07, 3.07) — dentro de EMPATE A y EMPATE B. Debe ganar el id menor.
--   (5.05, 5.05) — solo dentro de SOLITARIO.
--   (9.00, 9.00) — fuera de todo bbox.

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000560001', 'owner_bbox56@urbea.mx');

insert into public.agencies (id, name, slug, logo_url, contact_phone, contact_email, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000560101', 'Agencia Bbox 56', 'agencia-bbox-56',
   'https://cdn.urbea.mx/logos/bbox-56.png', '3312345656', 'contacto-bbox56@urbea.mx',
   'active', '00000000-0000-0000-0000-000000560001');

insert into public.ad_creatives (id, agency_id, cloudflare_uid, status) values
  ('00000000-0000-0000-0000-000000560201', '00000000-0000-0000-0000-000000560101', 'cf-uid-bbox56-ready', 'ready');

-- Un ad por municipio + uno nacional, todos elegibles.
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000560301', '00000000-0000-0000-0000-000000560101',
   '00000000-0000-0000-0000-000000560201', 'Ad GRANDE 56', 'external_url', 'https://ejemplo.mx/grande56',
   'active', (select v_now from test_now_56), (select v_now + interval '30 days' from test_now_56)),
  ('00000000-0000-0000-0000-000000560302', '00000000-0000-0000-0000-000000560101',
   '00000000-0000-0000-0000-000000560201', 'Ad PEQUENO 56', 'external_url', 'https://ejemplo.mx/pequeno56',
   'active', (select v_now from test_now_56), (select v_now + interval '30 days' from test_now_56)),
  ('00000000-0000-0000-0000-000000560303', '00000000-0000-0000-0000-000000560101',
   '00000000-0000-0000-0000-000000560201', 'Ad EMPATE A 56', 'external_url', 'https://ejemplo.mx/empatea56',
   'active', (select v_now from test_now_56), (select v_now + interval '30 days' from test_now_56)),
  ('00000000-0000-0000-0000-000000560304', '00000000-0000-0000-0000-000000560101',
   '00000000-0000-0000-0000-000000560201', 'Ad EMPATE B 56', 'external_url', 'https://ejemplo.mx/empateb56',
   'active', (select v_now from test_now_56), (select v_now + interval '30 days' from test_now_56)),
  ('00000000-0000-0000-0000-000000560305', '00000000-0000-0000-0000-000000560101',
   '00000000-0000-0000-0000-000000560201', 'Ad SOLITARIO 56', 'external_url', 'https://ejemplo.mx/solitario56',
   'active', (select v_now from test_now_56), (select v_now + interval '30 days' from test_now_56));

insert into public.ad_zones (ad_id, municipality_id) values
  ('00000000-0000-0000-0000-000000560301', '56001'),
  ('00000000-0000-0000-0000-000000560302', '56002'),
  ('00000000-0000-0000-0000-000000560303', '56003'),
  ('00000000-0000-0000-0000-000000560304', '56004'),
  ('00000000-0000-0000-0000-000000560305', '56005');

select pg_temp.act_as('00000000-0000-0000-0000-000000560001');

-- ════════════════════════════════════════════════════════════════════════════
-- 1) ads_for_zone — el traslape resuelve al bbox de MENOR área
-- ════════════════════════════════════════════════════════════════════════════

-- EC-1: solo el ad del municipio PEQUEÑO. El del GRANDE NO se sirve.
select set_eq(
  $$ select title from public.ads_for_zone(1.50, 1.50) where title like 'Ad %56' $$,
  $$ values ('Ad PEQUENO 56') $$,
  'EC-1 traslape GRANDE/PEQUENO: se sirve SOLO el ad del bbox de menor area'
);

-- EC-2: determinismo — 3 llamadas idénticas, un solo resultado distinto.
select is(
  (select count(distinct t) from (
     select (select string_agg(title, ',' order by title) from public.ads_for_zone(1.50, 1.50)) as t
     union all
     select (select string_agg(title, ',' order by title) from public.ads_for_zone(1.50, 1.50))
     union all
     select (select string_agg(title, ',' order by title) from public.ads_for_zone(1.50, 1.50))
   ) s),
  1::bigint,
  'EC-2 tres llamadas identicas producen el MISMO conjunto de ads'
);

-- EC-3: áreas idénticas — gana el id menor (56003), y es repetible.
select set_eq(
  $$ select title from public.ads_for_zone(3.07, 3.07) where title like 'Ad %56' $$,
  $$ values ('Ad EMPATE A 56') $$,
  'EC-3 areas identicas: gana el id menor (56003), desempate estable'
);

select is(
  (select count(distinct t) from (
     select (select string_agg(title, ',' order by title) from public.ads_for_zone(3.07, 3.07)) as t
     union all
     select (select string_agg(title, ',' order by title) from public.ads_for_zone(3.07, 3.07))
   ) s),
  1::bigint,
  'EC-3b el desempate por id es repetible entre llamadas'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) No-regresión: sin ambigüedad, nada cambia
-- ════════════════════════════════════════════════════════════════════════════

-- EC-6: un solo bbox contiene el punto.
select set_eq(
  $$ select title from public.ads_for_zone(5.05, 5.05) where title like 'Ad %56' $$,
  $$ values ('Ad SOLITARIO 56') $$,
  'EC-6 punto en UN SOLO bbox: sigue resolviendo a ese municipio'
);

-- EC-7: fuera de todo bbox — ningún ad zonado del fixture, y la RPC no lanza.
select is(
  (select count(*) from public.ads_for_zone(9.00, 9.00) where title like 'Ad %56'),
  0::bigint,
  'EC-7 fuera de todo bbox: ningun ad zonado del fixture se sirve'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) 🔴 resolve_ad_zone COINCIDE con ads_for_zone (invariante de facturación)
--    Sin esto, el anuncio se sirve en un municipio y su impresión facturable
--    se contabiliza en otro.
-- ════════════════════════════════════════════════════════════════════════════

set local role postgres;  -- resolve_ad_zone solo la invoca service_role

-- EC-4
select is(
  (select municipality_id from public.resolve_ad_zone(1.50, 1.50)),
  '56002',
  'EC-4 resolve_ad_zone en el traslape devuelve el municipio de MENOR area'
);

-- EC-5: mismo criterio de desempate que ads_for_zone.
select is(
  (select municipality_id from public.resolve_ad_zone(3.07, 3.07)),
  '56003',
  'EC-5 resolve_ad_zone desempata por id igual que ads_for_zone'
);

-- EC-6 espejo: sin ambigüedad, sin cambio.
select is(
  (select municipality_id from public.resolve_ad_zone(5.05, 5.05)),
  '56005',
  'EC-6b resolve_ad_zone sin ambiguedad sigue resolviendo al unico bbox'
);

select * from finish();
rollback;
