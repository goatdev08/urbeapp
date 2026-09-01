-- Tests pgTAP — private.municipality_at_point (tarea #235, hardening de 232.1)
-- Ejecutar con:
--   supabase test db supabase/tests/86_municipality_at_point_test.sql --local
-- Corre como superusuario dentro de una transacción revertida (no persiste).
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL PROBLEMA — una regla de negocio con TRES copias
--
-- #194 fijó el criterio del fallback municipal por bbox: cuando el punto del
-- usuario no cae en ningún polígono del DCAH, gana el municipio cuyo bbox
-- precalculado lo contiene con MENOR ÁREA, desempatando por id. Ese `order by`
-- se escribió "palabra por palabra" en dos funciones (#194) y 232.1 agregó la
-- tercera:
--
--   · public.ads_for_zone    — decide en qué municipio se SIRVE el anuncio.
--   · public.resolve_ad_zone — decide en qué municipio se CONTABILIZA la
--     impresión FACTURABLE (record-ad-impressions la usa server-side).
--   · public.place_at_point  — decide a qué zona de catálogo resuelve una
--     dirección geocodificada (buscador unificado de #232).
--
-- #194 ya documentó qué cuesta divergir: el anuncio se sirve en un municipio
-- y se cobra en otro, y el rollup de ad_impressions_monthly —la base de
-- cobro— queda mal atribuido. Con tres copias el riesgo no es hipotético:
-- basta que alguien edite una y no las otras. La regla se extrae a
-- private.municipality_at_point y las tres delegan.
--
-- SEAM PRINCIPAL: el contrato observable de las cuatro funciones. Se ejercita
-- la llamada real y se observa el resultado.
--
-- ⚠️ SEAM SECUNDARIO, DELIBERADO — sección 3. Los asserts de "delegación real"
-- SÍ inspeccionan el cuerpo con pg_get_functiondef. Normalmente eso sería
-- re-implementar el SUT en el test, pero aquí el objeto de la tarea ES la
-- topología del código: un futuro copy-paste que re-triplique el `order by`
-- pasaría TODOS los asserts de comportamiento (haría lo mismo) y volvería a
-- introducir exactamente el defecto que esta tarea elimina. Sin la sección 3
-- la tarea no tiene red de seguridad contra su propia regresión.
--
-- ── Edge cases enumerados ───────────────────────────────────────────────────
--  EC-1  El helper existe con la firma (float8, float8) -> text.
--  EC-2  Es `sql` + `stable` + `security definer` con search_path fijado
--        (patrón de los helpers de `private`: 0008/0010, private.is_admin).
--  EC-3  NO otorga EXECUTE a PUBLIC.
--  EC-4  `authenticated` no puede ejecutarlo (catálogo).
--  EC-5  `anon` no puede ejecutarlo (catálogo).
--  EC-6  `authenticated` recibe 42501 al invocarlo de verdad (runtime, no
--        solo catálogo). El helper NO es un contrato público: los clientes
--        siguen llamando place_at_point / ads_for_zone.
--  EC-7  Traslape GRANDE/PEQUEÑO: gana el de MENOR ÁREA (criterio de #194).
--  EC-8  Áreas IDÉNTICAS que se solapan: gana el id menor.
--  EC-9  Punto en UN SOLO bbox: resuelve a ese municipio (no-regresión).
--  EC-10 Punto fuera de TODO bbox: NULL (🔒 nunca inventa un municipio).
--  EC-11 Coordenada NULL: NULL, sin lanzar.
--  EC-12 Coordenada fuera de rango (lat 999): NULL, sin lanzar.
--  EC-13 Determinismo: tres llamadas idénticas, un solo resultado.
--  EC-14 ads_for_zone DELEGA en el helper (no reimplementa el order by).
--  EC-15 resolve_ad_zone DELEGA.
--  EC-16 place_at_point DELEGA.
--  EC-17 ads_for_zone ya NO contiene la expresión de área del bbox.
--  EC-18 resolve_ad_zone ya NO la contiene.
--  EC-19 place_at_point ya NO la contiene.
--  EC-20 Contrato de ads_for_zone intacto: firma + returns table, columna por
--        columna y en el mismo orden (lo llaman builds instalados).
--  EC-21 Contrato de resolve_ad_zone intacto.
--  EC-22 Contrato de place_at_point intacto.
--  EC-23 ads_for_zone en el traslape sirve SOLO el ad del municipio pequeño.
--  EC-24 resolve_ad_zone en el traslape devuelve el municipio pequeño.
--  EC-25 place_at_point en el traslape devuelve ese mismo municipio.
--  EC-26 Las tres COINCIDEN con el helper en el punto de empate de áreas
--        (invariante de facturación de #194, ahora estructural).
--  EC-27 La rama de COLONIA sigue ganando en place_at_point: el helper es el
--        fallback municipal, no secuestra el polígono del DCAH.
--  EC-28 La rama de COLONIA sigue ganando en ads_for_zone (colonia + su
--        municipio implícito).
--  EC-29 Grants intactos: authenticated conserva EXECUTE sobre ads_for_zone y
--        place_at_point.
--  EC-30 Grant intacto: authenticated sigue SIN EXECUTE sobre resolve_ad_zone
--        (solo service_role).
--  EC-31 ads_for_zone ya NO menciona mx_municipalities. Ancla INDEPENDIENTE
--        DEL FORMATO: EC-17 busca el literal `bbox_max_lat - ` y es evadible
--        partiendo la resta en dos lineas.
--  EC-32 resolve_ad_zone ya NO menciona mx_municipalities.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(32);

-- ── Envoltura RED-safe ──────────────────────────────────────────────────────
-- Mientras private.municipality_at_point no exista, invocarla directamente
-- lanzaría 42883 y ABORTARÍA la transacción, dejando el resto del archivo sin
-- correr: el RED fallaría "por import", no por aserción. Esta envoltura
-- comprueba la EXISTENCIA con to_regprocedure y devuelve un centinela.
-- NO hay bloque `exception`: un error real dentro del helper se propaga tal
-- cual y revienta el test, que es lo que queremos.
create or replace function pg_temp.muni_at(p_lat double precision, p_lng double precision)
returns text language plpgsql as $$
declare
  v_result text;
begin
  if to_regprocedure('private.municipality_at_point(double precision,double precision)') is null then
    return '<<AUSENTE: private.municipality_at_point>>';
  end if;
  execute 'select private.municipality_at_point($1, $2)' into v_result using p_lat, p_lng;
  return v_result;
end $$;

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

create temp table test_now_86 as select now() as v_now;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) Fixtures — clonan la geometría de 56_ads_for_zone_bbox_determinism_test
--    (los fixtures de #194) para que la EQUIVALENCIA sea comparable assert a
--    assert. Estado '86', fuera del rango real 01-32 del INEGI, y coordenadas
--    en el golfo de Guinea (lat/lng ~1-5): ahí no hay ningún polígono del
--    DCAH ni el bbox de ningún municipio real, así que el resultado no
--    depende de cuánto catálogo INEGI esté cargado en esta base (lección
--    #175).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.mx_states (id, name, abbr) values ('86', 'Estado Helper Municipio 86', 'H6');

insert into public.mx_municipalities (id, state_id, name, bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng) values
  -- GRANDE: área 1.00 x 1.00 = 1.0
  ('86001', '86', 'Municipio GRANDE 86',    1.00, 1.00, 2.00, 2.00),
  -- PEQUEÑO: área 0.20 x 0.20 = 0.04, ANIDADO dentro del grande
  ('86002', '86', 'Municipio PEQUENO 86',   1.40, 1.40, 1.60, 1.60),
  -- EMPATE A: área 0.10 x 0.10 = 0.01
  ('86003', '86', 'Municipio EMPATE A 86',  3.00, 3.00, 3.10, 3.10),
  -- EMPATE B: misma área que A, se solapa con A -> el desempate solo puede
  -- ser por id
  ('86004', '86', 'Municipio EMPATE B 86',  3.05, 3.05, 3.15, 3.15),
  -- SOLITARIO: sin traslape con nadie (no-regresión)
  ('86005', '86', 'Municipio SOLITARIO 86', 5.00, 5.00, 5.10, 5.10);

-- Colonia del DCAH dentro del bbox GRANDE pero LEJOS del punto de traslape:
-- así el punto (1.12, 1.12) ejerce la rama de polígono y (1.50, 1.50) la del
-- fallback municipal, en el mismo fixture.
insert into public.mx_neighborhoods (source_key, municipality_id, name, geom) values
  ('test-235-colonia', '86001', 'Colonia Helper 86',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(1.10, 1.10, 1.14, 1.14, 4326))::extensions.geography);

create temp table colonia_86 as
  select id from public.mx_neighborhoods where source_key = 'test-235-colonia';

-- Puntos (x=lng, y=lat):
--   (1.50, 1.50) — dentro de GRANDE y de PEQUENO, fuera de la colonia.
--   (3.07, 3.07) — dentro de EMPATE A y EMPATE B.
--   (5.05, 5.05) — solo dentro de SOLITARIO.
--   (9.00, 9.00) — fuera de todo bbox.
--   (1.12, 1.12) — dentro de la colonia (y del bbox GRANDE).

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000860001', 'owner_helper86@urbea.mx');

insert into public.agencies (id, name, slug, logo_url, contact_phone, contact_email, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000860101', 'Agencia Helper 86', 'agencia-helper-86',
   'https://cdn.urbea.mx/logos/helper-86.png', '3312345686', 'contacto-helper86@urbea.mx',
   'active', '00000000-0000-0000-0000-000000860001');

insert into public.ad_creatives (id, agency_id, cloudflare_uid, status) values
  ('00000000-0000-0000-0000-000000860201', '00000000-0000-0000-0000-000000860101', 'cf-uid-helper86-ready', 'ready');

insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000860301', '00000000-0000-0000-0000-000000860101',
   '00000000-0000-0000-0000-000000860201', 'Ad GRANDE 86', 'external_url', 'https://ejemplo.mx/grande86',
   'active', (select v_now from test_now_86), (select v_now + interval '30 days' from test_now_86)),
  ('00000000-0000-0000-0000-000000860302', '00000000-0000-0000-0000-000000860101',
   '00000000-0000-0000-0000-000000860201', 'Ad PEQUENO 86', 'external_url', 'https://ejemplo.mx/pequeno86',
   'active', (select v_now from test_now_86), (select v_now + interval '30 days' from test_now_86)),
  ('00000000-0000-0000-0000-000000860303', '00000000-0000-0000-0000-000000860101',
   '00000000-0000-0000-0000-000000860201', 'Ad EMPATE A 86', 'external_url', 'https://ejemplo.mx/empatea86',
   'active', (select v_now from test_now_86), (select v_now + interval '30 days' from test_now_86)),
  ('00000000-0000-0000-0000-000000860304', '00000000-0000-0000-0000-000000860101',
   '00000000-0000-0000-0000-000000860201', 'Ad EMPATE B 86', 'external_url', 'https://ejemplo.mx/empateb86',
   'active', (select v_now from test_now_86), (select v_now + interval '30 days' from test_now_86)),
  ('00000000-0000-0000-0000-000000860305', '00000000-0000-0000-0000-000000860101',
   '00000000-0000-0000-0000-000000860201', 'Ad SOLITARIO 86', 'external_url', 'https://ejemplo.mx/solitario86',
   'active', (select v_now from test_now_86), (select v_now + interval '30 days' from test_now_86)),
  ('00000000-0000-0000-0000-000000860306', '00000000-0000-0000-0000-000000860101',
   '00000000-0000-0000-0000-000000860201', 'Ad COLONIA 86', 'external_url', 'https://ejemplo.mx/colonia86',
   'active', (select v_now from test_now_86), (select v_now + interval '30 days' from test_now_86));

insert into public.ad_zones (ad_id, municipality_id) values
  ('00000000-0000-0000-0000-000000860301', '86001'),
  ('00000000-0000-0000-0000-000000860302', '86002'),
  ('00000000-0000-0000-0000-000000860303', '86003'),
  ('00000000-0000-0000-0000-000000860304', '86004'),
  ('00000000-0000-0000-0000-000000860305', '86005');

insert into public.ad_zones (ad_id, neighborhood_id)
  select '00000000-0000-0000-0000-000000860306', id from colonia_86;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) El helper existe y es PRIVADO (EC-1 .. EC-6)
-- ════════════════════════════════════════════════════════════════════════════

-- EC-1
select has_function(
  'private', 'municipality_at_point', array['double precision', 'double precision'],
  'EC-1 private.municipality_at_point(double precision, double precision) existe'
);

-- EC-2: firma de retorno + propiedades. Un helper VOLATILE o SECURITY INVOKER
-- cambiaría la semántica de las tres funciones que lo llaman.
select is(
  (select pg_get_function_result(p.oid) || ' | ' || l.lanname || ' | ' ||
          p.provolatile::text || ' | secdef=' || p.prosecdef::text || ' | ' ||
          coalesce(array_to_string(p.proconfig, ','), '<sin search_path>')
     from pg_proc p
     join pg_language l on l.oid = p.prolang
    where p.oid = to_regprocedure('private.municipality_at_point(double precision,double precision)')),
  'text | sql | s | secdef=true | search_path=public',
  'EC-2 returns text, language sql, STABLE, SECURITY DEFINER y search_path fijado'
);

-- EC-3: la ACL debe existir (o sea, alguien revocó) y NO incluir a PUBLIC
-- (grantee = 0). Si la función no existe, la subconsulta no devuelve filas y
-- el assert falla — que es lo correcto en RED.
select is(
  (select p.proacl is not null
          and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
     from pg_proc p
    where p.oid = to_regprocedure('private.municipality_at_point(double precision,double precision)')),
  true,
  'EC-3 el helper NO otorga EXECUTE a PUBLIC'
);

-- EC-4 / EC-5: coalesce a `true` para que la AUSENCIA de la función también
-- falle el assert en vez de pasar por vacío.
select is(
  (select coalesce(
     has_function_privilege('authenticated',
       to_regprocedure('private.municipality_at_point(double precision,double precision)')::oid, 'EXECUTE'),
     true)),
  false,
  'EC-4 authenticated NO tiene EXECUTE sobre el helper'
);

select is(
  (select coalesce(
     has_function_privilege('anon',
       to_regprocedure('private.municipality_at_point(double precision,double precision)')::oid, 'EXECUTE'),
     true)),
  false,
  'EC-5 anon NO tiene EXECUTE sobre el helper'
);

-- EC-6: el catálogo puede mentir si el schema `private` tuviera un default
-- privilege inesperado. Se comprueba en RUNTIME. 42501 = insufficient_privilege.
set local role authenticated;
select throws_ok(
  $$ select private.municipality_at_point(1.50, 1.50) $$,
  '42501',
  null,
  'EC-6 authenticated recibe permiso denegado (42501) al invocar el helper de verdad'
);
set local role postgres;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Comportamiento del helper = criterio de #194 (EC-7 .. EC-13)
-- ════════════════════════════════════════════════════════════════════════════

-- EC-7
select is(
  pg_temp.muni_at(1.50, 1.50),
  '86002',
  'EC-7 traslape GRANDE/PEQUENO: gana el bbox de MENOR AREA'
);

-- EC-8
select is(
  pg_temp.muni_at(3.07, 3.07),
  '86003',
  'EC-8 areas IDENTICAS: desempata por id menor'
);

-- EC-9
select is(
  pg_temp.muni_at(5.05, 5.05),
  '86005',
  'EC-9 punto en UN SOLO bbox: resuelve a ese municipio'
);

-- EC-10
select is(
  pg_temp.muni_at(9.00, 9.00),
  null::text,
  'EC-10 fuera de TODO bbox: NULL (nunca inventa un municipio)'
);

-- EC-11
select is(
  pg_temp.muni_at(null, 1.50),
  null::text,
  'EC-11 latitud NULL: NULL, sin lanzar'
);

-- EC-12
select is(
  pg_temp.muni_at(999.0, -999.0),
  null::text,
  'EC-12 coordenada fuera de rango: NULL, sin lanzar'
);

-- EC-13
-- string_agg(distinct …) y no count(distinct …)=1: con el conteo, tres
-- respuestas IGUALES pero EQUIVOCADAS pasarían el assert (y en RED pasaba por
-- vacío, con las tres devolviendo el centinela de ausencia). Así el assert
-- exige a la vez estabilidad y el valor correcto.
select is(
  (select string_agg(distinct v, ' | ') from (
     select pg_temp.muni_at(1.50, 1.50) as v
     union all select pg_temp.muni_at(1.50, 1.50)
     union all select pg_temp.muni_at(1.50, 1.50)
   ) s),
  '86002',
  'EC-13 tres llamadas identicas devuelven el MISMO municipio (86002)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) 🔴 DELEGACIÓN REAL — el ancla anti re-triplicación (EC-14 .. EC-19)
--    Estos asserts miran el CUERPO a propósito (ver nota de arriba): un
--    copy-paste que reintrodujera el `order by` pasaría todos los asserts de
--    comportamiento y volvería a crear el defecto de #194.
-- ════════════════════════════════════════════════════════════════════════════

-- EC-14
select is(
  (select position('municipality_at_point' in pg_get_functiondef(
     to_regprocedure('public.ads_for_zone(double precision,double precision,bigint,text)')::oid)) > 0),
  true,
  'EC-14 public.ads_for_zone DELEGA en private.municipality_at_point'
);

-- EC-15
select is(
  (select position('municipality_at_point' in pg_get_functiondef(
     to_regprocedure('public.resolve_ad_zone(double precision,double precision)')::oid)) > 0),
  true,
  'EC-15 public.resolve_ad_zone DELEGA en private.municipality_at_point'
);

-- EC-16
select is(
  (select position('municipality_at_point' in pg_get_functiondef(
     to_regprocedure('public.place_at_point(double precision,double precision)')::oid)) > 0),
  true,
  'EC-16 public.place_at_point DELEGA en private.municipality_at_point'
);

-- EC-17 .. EC-19: la expresión de área del bbox — `bbox_max_lat - ` — ya no
-- puede aparecer en ninguna de las tres. (place_at_point sigue DEVOLVIENDO las
-- columnas bbox_*, pero sin restarlas.)
select is(
  (select position('bbox_max_lat - ' in pg_get_functiondef(
     to_regprocedure('public.ads_for_zone(double precision,double precision,bigint,text)')::oid))),
  0,
  'EC-17 ads_for_zone ya NO reimplementa la expresion de area del bbox'
);

select is(
  (select position('bbox_max_lat - ' in pg_get_functiondef(
     to_regprocedure('public.resolve_ad_zone(double precision,double precision)')::oid))),
  0,
  'EC-18 resolve_ad_zone ya NO reimplementa la expresion de area del bbox'
);

select is(
  (select position('bbox_max_lat - ' in pg_get_functiondef(
     to_regprocedure('public.place_at_point(double precision,double precision)')::oid))),
  0,
  'EC-19 place_at_point ya NO reimplementa la expresion de area del bbox'
);

-- 🔴 EC-31 / EC-32 — ANCLA INDEPENDIENTE DEL FORMATO.
-- EC-14..EC-19 son evadibles y no basta con ellos: un mutante que RECOPIE el
-- order by pasa EC-14..EC-16 con solo dejar un comentario que nombre el helper,
-- y pasa EC-17..EC-19 partiendo la resta en dos lineas —
-- `(m.bbox_max_lat\n - m.bbox_min_lat)`— porque esos asserts buscan el LITERAL
-- 'bbox_max_lat - '. Un assert que se rompe con un salto de linea no es un ancla.
--
-- El invariante que no depende del formato es mas fuerte y mas simple: despues
-- de la extraccion, ads_for_zone y resolve_ad_zone NO TIENEN NADA QUE HACER con
-- la tabla de municipios —resuelven la colonia y delegan todo lo demas—, asi
-- que basta con NOMBRARLA para que salten. Cualquier reimplementacion del
-- fallback tiene que leer mx_municipalities: no hay forma de recopiar el order
-- by sin mencionarla.
--
-- place_at_point queda FUERA a proposito: si lee mx_municipalities de forma
-- legitima, para devolver el nombre y el bbox del municipio ganador. Ahi el
-- ancla es EC-16 + EC-19.
select is(
  (select position('mx_municipalities' in pg_get_functiondef(
     to_regprocedure('public.ads_for_zone(double precision,double precision,bigint,text)')::oid))),
  0,
  'EC-31 ads_for_zone ya NO toca mx_municipalities: delega el fallback municipal'
);

select is(
  (select position('mx_municipalities' in pg_get_functiondef(
     to_regprocedure('public.resolve_ad_zone(double precision,double precision)')::oid))),
  0,
  'EC-32 resolve_ad_zone ya NO toca mx_municipalities: delega el fallback municipal'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) 🔴 CONTRATO PUBLICADO INTACTO (EC-20 .. EC-22)
--    §0.5 producción viva: los builds instalados llaman estas RPC por nombre y
--    leen las columnas por posición/nombre. Refactorizar el cuerpo NO puede
--    mover una columna ni cambiar un tipo.
-- ════════════════════════════════════════════════════════════════════════════

-- EC-20
select is(
  (select pg_get_function_identity_arguments(oid) || ' -> ' || pg_get_function_result(oid)
     from pg_proc where oid = to_regprocedure('public.ads_for_zone(double precision,double precision,bigint,text)')),
  'p_lat double precision, p_lng double precision, p_neighborhood_id bigint, p_municipality_id text'
  || ' -> TABLE(id uuid, creative_id uuid, title text, description text, cta_type ad_cta_type,'
  || ' cta_value text, cloudflare_uid text, agency_name text, agency_logo_url text)',
  'EC-20 contrato de ads_for_zone intacto (firma + returns table, mismo orden)'
);

-- EC-21
select is(
  (select pg_get_function_identity_arguments(oid) || ' -> ' || pg_get_function_result(oid)
     from pg_proc where oid = to_regprocedure('public.resolve_ad_zone(double precision,double precision)')),
  'p_lat double precision, p_lng double precision'
  || ' -> TABLE(municipality_id text, neighborhood_id bigint)',
  'EC-21 contrato de resolve_ad_zone intacto'
);

-- EC-22
select is(
  (select pg_get_function_identity_arguments(oid) || ' -> ' || pg_get_function_result(oid)
     from pg_proc where oid = to_regprocedure('public.place_at_point(double precision,double precision)')),
  'p_lat double precision, p_lng double precision'
  || ' -> TABLE(kind text, id text, name text, context text, min_lat double precision,'
  || ' min_lng double precision, max_lat double precision, max_lng double precision)',
  'EC-22 contrato de place_at_point intacto'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) EQUIVALENCIA END-TO-END: las tres siguen resolviendo lo mismo que #194
--    (EC-23 .. EC-26)
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000860001');

-- EC-23
select set_eq(
  $$ select title from public.ads_for_zone(1.50, 1.50) where title like 'Ad %86' $$,
  $$ values ('Ad PEQUENO 86') $$,
  'EC-23 ads_for_zone en el traslape sirve SOLO el ad del bbox de menor area'
);

-- EC-25 (con el rol del cliente, que sí puede llamar place_at_point)
select results_eq(
  $$ select kind, id from public.place_at_point(1.50, 1.50) $$,
  $$ values ('municipality'::text, '86002'::text) $$,
  'EC-25 place_at_point en el traslape devuelve el municipio de menor area'
);

-- EC-27: la rama de COLONIA gana sobre el fallback municipal. Si el helper
-- secuestrara la resolución, este punto devolvería 'municipality'/86001.
select results_eq(
  $$ select kind, id from public.place_at_point(1.12, 1.12) $$,
  $$ select 'neighborhood'::text,
            (select id::text from public.mx_neighborhoods where source_key = 'test-235-colonia') $$,
  'EC-27 place_at_point: el poligono del DCAH sigue ganando sobre el bbox'
);

-- EC-28: ads_for_zone en la colonia sirve el ad de la colonia Y el de su
-- municipio implícito (86001), y NO el del municipio pequeño.
select set_eq(
  $$ select title from public.ads_for_zone(1.12, 1.12) where title like 'Ad %86' $$,
  $$ values ('Ad COLONIA 86'), ('Ad GRANDE 86') $$,
  'EC-28 ads_for_zone: la colonia sigue ganando y arrastra su municipio'
);

set local role postgres;  -- resolve_ad_zone solo la invoca service_role

-- EC-24
select is(
  (select municipality_id from public.resolve_ad_zone(1.50, 1.50)),
  '86002',
  'EC-24 resolve_ad_zone en el traslape devuelve el municipio de menor area'
);

-- EC-26: invariante de facturación de #194 — las tres COINCIDEN con el helper
-- sobre el punto de empate de áreas. Ya no por copia disciplinada del texto,
-- sino porque comparten la implementación.
select is(
  (select string_agg(distinct v, ' | ') from (
     select pg_temp.muni_at(3.07, 3.07) as v
     union all select (select municipality_id from public.resolve_ad_zone(3.07, 3.07))
     union all select (select id from public.place_at_point(3.07, 3.07))
   ) s),
  '86003',
  'EC-26 helper, resolve_ad_zone y place_at_point COINCIDEN en el empate de areas (86003)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) GRANTS DE LAS TRES FUNCIONES INTACTOS (EC-29, EC-30)
-- ════════════════════════════════════════════════════════════════════════════

-- EC-29
select is(
  (select has_function_privilege('authenticated',
            to_regprocedure('public.ads_for_zone(double precision,double precision,bigint,text)')::oid, 'EXECUTE')
       and has_function_privilege('authenticated',
            to_regprocedure('public.place_at_point(double precision,double precision)')::oid, 'EXECUTE')),
  true,
  'EC-29 authenticated conserva EXECUTE sobre ads_for_zone y place_at_point'
);

-- EC-30
select is(
  (select has_function_privilege('authenticated',
            to_regprocedure('public.resolve_ad_zone(double precision,double precision)')::oid, 'EXECUTE')),
  false,
  'EC-30 authenticated sigue SIN EXECUTE sobre resolve_ad_zone (solo service_role)'
);

select * from finish();
rollback;
