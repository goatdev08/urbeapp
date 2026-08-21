-- Tests pgTAP — RPC public.ad_metrics_for_agency (subtarea #171.1, exploración 039
-- "Tarea D", panel del anunciante). Ejecutar con:
--   supabase test db supabase/tests/62_ad_metrics_for_agency_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de una
-- transacción revertida (no persiste). Impersonamos con pg_temp.act_as(uid, role)
-- (mismo patrón que 02/16/25/37/43/44/46/47/48/51/52/53_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba: el contrato PÚBLICO de la RPC — argumentos, columnas de
-- retorno (leídas del catálogo, NUNCA reescritas a mano) y las filas que
-- devuelve para una organización dada, ejercitada con llamadas reales bajo
-- impersonación JWT. NUNCA internals (no se valida un CTE por nombre).
--
-- SUT (AÚN NO EXISTE — RED 2026-08-20): una migración GREEN debe crear
--
--   public.ad_metrics_for_agency(
--     p_agency_id uuid, p_from timestamptz default null, p_to timestamptz default null
--   ) returns table (
--     municipality_id text, neighborhood_id bigint,
--     impressions integer, views integer, cta_taps integer
--   )
--   security definer, set search_path = '' (patrón EXACTO de public.get_lead_stats,
--   20260808000002 — todo el cuerpo calificado por schema, autorización EXPLÍCITA
--   en el cuerpo porque security definer bypassa RLS).
--   revoke execute from public, anon; grant execute to authenticated.
--
--   AUTZ fail-closed, las DOS condiciones (no una):
--     private.agency_role_of(p_agency_id) is not null  -- CUALQUIER rol activo
--       (owner/admin/agent/viewer) sirve — el helper ya filtra status='active'.
--     and private.org_can_advertise(p_agency_id)        -- capacidad encendida,
--       organización activa, no borrada.
--   Sin autorización: 0 FILAS, nunca una excepción (anti-IDOR — el caller no
--   puede distinguir "no existe" de "no es tuya" de "no tiene la capacidad").
--
-- ── D-OTRASZONAS (decisión de diseño del test-author, 2026-08-20, NO estaba
--    fijada por Abraham) — qué zona-bucket usa el colapso de k-anonimato ────
-- Se agrupa por (municipality_id, neighborhood_id). Una zona con MENOS de 5
-- usuarios distintos (count(distinct user_id) < 5) se funde en un bucket
-- "otras zonas" representado por la fila municipality_id IS NULL AND
-- neighborhood_id IS NULL. Las impresiones cuya zona NO resolvió en absoluto
-- (ad_impressions.neighborhood_id/municipality_id ya nacen NULL/NULL —
-- comentario de 20260817000002: "una impresión puede no resolver zona") caen
-- EN EL MISMO bucket por construcción, sin necesidad de un caso especial: ya
-- comparten la llave (NULL, NULL) con las zonas colapsadas por privacidad.
-- Es la decisión correcta de producto, no un atajo: el anunciante no necesita
-- distinguir "no sabemos dónde fue" de "es muy poca gente para mostrarlo
-- sin re-identificar" — ambas son "no es una zona específica". Consecuencia
-- para este RED: EDGE12 (impresiones con neighborhood_id NULL) se prueba
-- verificando que SIEMPRE terminan sumadas dentro de la fila (NULL, NULL),
-- nunca perdidas y nunca como su propia fila "zona desconocida" aparte.
--
-- ── Estrategia RED sin depender de "function does not exist" ────────────────
-- El SUT es una función NUEVA que hoy no existe en ninguna migración. Se
-- SIGUE el patrón YA establecido en 53_ads_for_zone_test.sql/34_lead_stats_
-- rpc_test.sql — NUNCA se crea una migración-stub en supabase/migrations/
-- (ese archivo lo escribe el GREEN): (a) los asserts de catálogo puro
-- (pg_proc/pg_get_function_*) son seguros aunque la función no exista —
-- resuelven a NULL/false y comparan "not ok" sin lanzar; (b) TODA llamada
-- real (`select * from ad_metrics_for_agency(...)`) va dentro de un bloque
-- `do $$ ... exception when others then ... $$` AUTO-PROTEGIDO que escribe
-- su resultado en una tabla temporal (ok/err_sqlstate + las filas), nunca en
-- un SELECT crudo — así el archivo entero corre sin abortar pese al 42883
-- ("function does not exist") de HOY, y las aserciones de valores fallan
-- limpio contra tablas temporales vacías (0 filas / NULL) en vez del real
-- 5/3/2 esperado. DELTA total: absolutamente ninguna aserción de este
-- archivo puede pasar hoy por la razón correcta.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ────────────────
-- Firma pública: catálogo EXACTO (pg_get_function_result/arguments, leído del
--   catálogo real, nunca re-escrito a mano) — tipos correctos (neighborhood_id
--   bigint, NO uuid); security definer; search_path = '' (patrón get_lead_stats).
-- Ancla de fuga (EDGE6): anon no puede ejecutar el RPC (42501 explícito);
--   authenticated dueño legítimo de la agencia SIGUE sin poder leer una sola
--   fila de ad_impressions por SELECT directo (0 filas, RLS sin policies).
-- Autorización, TODA por impersonación JWT real (nunca leyendo la policy):
--   AUTZ1 anti-IDOR: owner de OTRA organización pide las métricas de esta —
--     0 filas, nunca una excepción que confirme que el recurso existe.
--   AUTZ2 viewer activo SÍ lee (rol no-privilegiado, agency_role_of no exige
--     owner/admin).
--   AUTZ3 miembro suspended NO lee (agency_role_of exige status='active').
--   AUTZ4 organización SIN can_advertise NO se lee — ni siquiera para su
--     propio owner activo, y pese a tener impresiones reales sembradas (si el
--     gate de capacidad faltara, esta fila SÍ aparecería — mata ese mutante).
--   AUTZ5 authenticated sin ninguna relación con la organización — 0 filas.
--   AUTZ6/EDGE14 organización SIN ninguna impresión — 0 filas, SIN error
--     (nunca una excepción por "no hay datos").
-- Privacidad (EDGE7): la firma de retorno (catálogo, no una lista propia)
--   NO contiene 'user_id' ni 'session_id' en ningún lado del string.
-- k-anonimato (EDGE8/EDGE9): zona con 4 usuarios distintos colapsa; zona con
--   5 se desglosa (frontera inclusiva en 5). Caso estrella: 1 usuario con 6
--   impresiones en una zona TAMBIÉN colapsa — si un mutante contara filas en
--   vez de usuarios distintos, esta zona pasaría el umbral con n=1 y el RED
--   lo cazaría.
-- Conservación de totales (EDGE10): la fila "otras zonas" trae la SUMA real
--   de las zonas colapsadas (impresiones/vistas/taps), y suma(desglosadas) +
--   otras_zonas == total real sembrado a mano — colapsar no pierde datos.
-- Agregación (EDGE11): los 3 contadores (impresiones=count(*), vistas=
--   viewed=true, taps=cta_tapped_at is not null) cuadran contra fixtures
--   calculados A MANO (nunca la misma expresión SQL que usará el SUT).
-- Zona no resuelta (EDGE12): impresiones con neighborhood_id/municipality_id
--   NULL — ver D-OTRASZONAS arriba, terminan sumadas en la fila (NULL,NULL).
-- Rango p_from/p_to (EDGE13): sin rango = todo. Con rango, filtra por
--   shown_at (decisión de diseño del test-author: es "cuándo se vio el
--   anuncio", el timestamp natural para un reporte de fechas — NUNCA
--   created_at, que es metadata de inserción). Frontera INCLUSIVA en AMBOS
--   extremos, fijada con 2 llamadas de ventana cero (p_from=p_to=el instante
--   exacto) que deben incluir exactamente esa fila y ninguna otra. El
--   k-anonimato se re-evalúa SOBRE el conjunto filtrado por rango (una zona
--   que desgloza sin rango puede colapsar con rango si el filtro la deja con
--   menos de 5 usuarios DENTRO de la ventana).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(53);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) Fixtures — self-contained, prefijo '...0000006200XX'/'...620XXX'/'...6209XX'
--    (fuera del rango de otros archivos: 51 usa '510XXX', 53 usa '530XXX').
--    T0 (2026-07-01) es el "shown_at" de todas las zonas NO relacionadas con
--    la prueba de rango; FROM_TS/TO_TS (2026-08-10) son una ventana aparte de
--    10 minutos, así que un rango [FROM_TS,TO_TS] excluye TODO lo demás por
--    construcción y aísla limpio la prueba de frontera (sección 6).
-- ════════════════════════════════════════════════════════════════════════════

create temp table test_ts_62 as
select
  '2026-07-01 08:00:00+00'::timestamptz as t0,
  '2026-08-10 00:00:00+00'::timestamptz as from_ts,
  '2026-08-10 00:10:00+00'::timestamptz as to_ts,
  '2026-08-10 00:05:00+00'::timestamptz as mid_ts,
  '2026-08-09 23:59:59+00'::timestamptz as before_ts,
  '2026-08-10 00:10:01+00'::timestamptz as after_ts;
-- GOTCHA idéntico al ya documentado en 51_ad_impressions_test.sql:141-146: la
-- sección 6 lee (select from_ts/to_ts from test_ts_62) DENTRO de bloques `do
-- $$ ... $$` ejecutados bajo `pg_temp.act_as(..., 'authenticated')` (SET
-- LOCAL ROLE). Un DO anónimo corre SECURITY INVOKER siempre -- sin este
-- GRANT, 'authenticated' (no superuser, rolbypassrls=false, sin membresía
-- de 'postgres') recibe 42501 "permission denied for table test_ts_62" al
-- EVALUAR LOS ARGUMENTOS del RPC, antes de que la función se invoque
-- siquiera -- falla igual sin importar qué tan correcto sea el SUT. Fix
-- agregado en GREEN (171.1, supabase agent) tras reproducirlo manualmente
-- (docker exec psql, sqlstate 42501 confirmado); NO toca ninguna aserción
-- ni valor esperado, es scaffolding puro (mismo patrón que la línea 146 de
-- 51_ad_impressions_test.sql).
grant select on test_ts_62 to public;

-- ── Actores (auth.users; agency_role_of NO exige nada de public.users.role,
--    solo agency_members -- sin necesidad de tocar public.users) ────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000620001', 'owner_a_admetrics62@urbea.mx'),
  ('00000000-0000-0000-0000-000000620002', 'viewer_a_admetrics62@urbea.mx'),
  ('00000000-0000-0000-0000-000000620003', 'suspended_a_admetrics62@urbea.mx'),
  ('00000000-0000-0000-0000-000000620004', 'owner_b_admetrics62@urbea.mx'),
  ('00000000-0000-0000-0000-000000620005', 'owner_c_admetrics62@urbea.mx'),
  ('00000000-0000-0000-0000-000000620006', 'stranger_admetrics62@urbea.mx'),
  ('00000000-0000-0000-0000-000000620007', 'owner_d_admetrics62@urbea.mx');

-- ── Organizaciones ───────────────────────────────────────────────────────────
-- AGENCY_A: sujeto principal del RED, can_advertise=true, activa.
-- AGENCY_B: capacidad OK pero CERO impresiones (EDGE14/AUTZ6).
-- AGENCY_C: can_advertise=FALSE pese a tener impresiones reales (AUTZ4).
insert into public.agencies (id, name, slug, status, can_advertise, advertiser_category, created_by_user_id) values
  ('00000000-0000-0000-0000-000000620101', 'Agencia Metrics A 62', 'agencia-metrics-a-62', 'active', true, 'otro', '00000000-0000-0000-0000-000000620001'),
  ('00000000-0000-0000-0000-000000620102', 'Agencia Metrics B 62', 'agencia-metrics-b-62', 'active', true, 'otro', '00000000-0000-0000-0000-000000620004'),
  ('00000000-0000-0000-0000-000000620103', 'Agencia Metrics C 62', 'agencia-metrics-c-62', 'active', false, null, '00000000-0000-0000-0000-000000620005'),
  -- AGENCY_D (EDGE12b, hallazgo del guardián 171.1): zona NO RESUELTA con
  -- k>=5. El fixture de AGENCY_A deja UNRESOLVED en 3 usuarios, o sea
  -- SIEMPRE del lado 'colapsa'; la rama complementaria nunca se ejercitaba.
  ('00000000-0000-0000-0000-000000620104', 'Agencia Metrics D 62', 'agencia-metrics-d-62', 'active', true, 'otro', '00000000-0000-0000-0000-000000620007');

insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620001', 'owner', 'active'),   -- OWNER_A
  ('00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620002', 'viewer', 'active'),  -- VIEWER_A (AUTZ2)
  ('00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620003', 'agent', 'suspended'),-- SUSPENDED_A (AUTZ3)
  ('00000000-0000-0000-0000-000000620102', '00000000-0000-0000-0000-000000620004', 'owner', 'active'),   -- OWNER_B (agencia SIN relación con A -- AUTZ1)
  ('00000000-0000-0000-0000-000000620103', '00000000-0000-0000-0000-000000620005', 'owner', 'active'),   -- OWNER_C (agencia SIN can_advertise -- AUTZ4)
  ('00000000-0000-0000-0000-000000620104', '00000000-0000-0000-0000-000000620007', 'owner', 'active');  -- OWNER_D (EDGE12b)
-- STRANGER (620006) NO tiene NINGUNA fila en agency_members (AUTZ5).

-- ── Geo mínima: SOLO lo que exige la FK de neighborhood_id. municipality_id
--    en ad_impressions es TEXT SIN FK (20260817000002) -- el resto de las
--    "zonas" de este archivo son texto libre, no necesitan fila en
--    mx_municipalities. ────────────────────────────────────────────────────
insert into public.mx_states (id, name, abbr) values ('62', 'Estado Ad Metrics Test 62', 'AM');
insert into public.mx_municipalities (id, state_id, name) values ('62001', '62', 'Municipio Ad Metrics 62001');
insert into public.mx_neighborhoods (source_key, municipality_id, name, geom) values
  ('test-admetrics-62-n1', '62001', 'Colonia Ad Metrics 62',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-99.90, 19.90, -99.88, 19.92, 4326))::extensions.geography);

create temp table test_ctx_62 as
select (select id from public.mx_neighborhoods where source_key = 'test-admetrics-62-n1') as neighborhood_id;

-- ── Creativo + ad por organización (ad_impressions.ad_id NOT NULL -> ads) ──
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000620201', '00000000-0000-0000-0000-000000620101', 'ready'),
  ('00000000-0000-0000-0000-000000620202', '00000000-0000-0000-0000-000000620103', 'ready'),
  ('00000000-0000-0000-0000-000000620203', '00000000-0000-0000-0000-000000620104', 'ready');

insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101',
   '00000000-0000-0000-0000-000000620201', 'Ad Metrics A 62', 'phone', '+5213300006201',
   'active', (select t0 from test_ts_62), (select t0 + interval '30 days' from test_ts_62)),
  ('00000000-0000-0000-0000-000000620302', '00000000-0000-0000-0000-000000620103',
   '00000000-0000-0000-0000-000000620202', 'Ad Metrics C 62', 'phone', '+5213300006202',
   'active', (select t0 from test_ts_62), (select t0 + interval '30 days' from test_ts_62)),
  ('00000000-0000-0000-0000-000000620303', '00000000-0000-0000-0000-000000620104',
   '00000000-0000-0000-0000-000000620203', 'Ad Metrics D 62', 'phone', '+5213300006203',
   'active', (select t0 from test_ts_62), (select t0 + interval '30 days' from test_ts_62));

-- ── Impresiones. Los "usuarios" (user_id) NO tienen FK en ad_impressions
--    (columna uuid libre) -- no requieren fila en auth.users/public.users.
--    watched_ms/completed son irrelevantes al contrato de esta RPC (los 3
--    contadores son impressions=count(*), views=viewed, cta_taps=
--    cta_tapped_at is not null) -- se fijan a valores neutros.
--
--    ZONA MUNI_5   (62001, NULL)      -- 5 usuarios distintos -> DESGLOSA.
--      impresiones=5 views=3(u1,u2,u4) cta=2(u1,u5) -- calculado a mano.
--    ZONA MUNI_4   (62002, NULL)      -- 4 usuarios distintos -> COLAPSA.
--      impresiones=4 views=2(u6,u8) cta=1(u6)
--    ZONA SINGLE_6 (62003, NULL)      -- 1 usuario, 6 impresiones -> COLAPSA
--      (EDGE9, el caso que distingue "5 usuarios" de "5 impresiones").
--      impresiones=6 views=4 cta=3
--    ZONA NEIGH    (62001, neigh_id)  -- 5 usuarios distintos -> DESGLOSA
--      (misma municipality_id que MUNI_5, neighborhood_id distinto -> prueba
--      que la llave de agrupación es el PAR, no solo el municipio).
--      impresiones=5 views=3(u11,u12,u14) cta=2(u11,u14)
--    ZONA UNRESOLVED (NULL, NULL)     -- zona no resuelta, EDGE12.
--      impresiones=3 views=2(u16,u18) cta=1(u16)
--    ZONA BOUNDARY (62009, NULL)      -- 5 usuarios con shown_at distintos,
--      usada por la sección 6 (rango). Sin rango: 5 usuarios -> DESGLOSA.
--      impresiones=5 views=5 cta=0
--
--    TOTAL AGENCIA A sin rango: impresiones=5+4+6+5+3+5=28
--                               views=3+2+4+3+2+5=19
--                               cta=2+1+3+2+1+0=9
--    Desglosadas (MUNI_5+NEIGH+BOUNDARY): impresiones=15 views=11 cta=4
--    "otras zonas" (MUNI_4+SINGLE_6+UNRESOLVED): impresiones=13 views=8 cta=5
--    (15+13=28 ✓, 11+8=19 ✓, 4+5=9 ✓ -- EDGE10, conservación de totales)

insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  -- MUNI_5
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620911', gen_random_uuid(), '62001', null, (select t0 from test_ts_62), 4000, true,  false, (select t0 from test_ts_62)),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620912', gen_random_uuid(), '62001', null, (select t0 from test_ts_62), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620913', gen_random_uuid(), '62001', null, (select t0 from test_ts_62),  800, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620914', gen_random_uuid(), '62001', null, (select t0 from test_ts_62), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620915', gen_random_uuid(), '62001', null, (select t0 from test_ts_62),  800, false, false, (select t0 from test_ts_62)),
  -- MUNI_4
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620921', gen_random_uuid(), '62002', null, (select t0 from test_ts_62), 4000, true,  false, (select t0 from test_ts_62)),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620922', gen_random_uuid(), '62002', null, (select t0 from test_ts_62),  800, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620923', gen_random_uuid(), '62002', null, (select t0 from test_ts_62), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620924', gen_random_uuid(), '62002', null, (select t0 from test_ts_62),  800, false, false, null),
  -- SINGLE_6 -- MISMO user_id en las 6 filas a propósito (EDGE9).
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620931', gen_random_uuid(), '62003', null, (select t0 from test_ts_62), 4000, true,  false, (select t0 from test_ts_62)),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620931', gen_random_uuid(), '62003', null, (select t0 from test_ts_62), 4000, true,  false, (select t0 from test_ts_62)),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620931', gen_random_uuid(), '62003', null, (select t0 from test_ts_62), 4000, true,  false, (select t0 from test_ts_62)),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620931', gen_random_uuid(), '62003', null, (select t0 from test_ts_62), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620931', gen_random_uuid(), '62003', null, (select t0 from test_ts_62),  800, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620931', gen_random_uuid(), '62003', null, (select t0 from test_ts_62),  800, false, false, null),
  -- NEIGH (mismo '62001' que MUNI_5, pero con neighborhood_id real -> par distinto)
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620941', gen_random_uuid(), '62001', (select neighborhood_id from test_ctx_62), (select t0 from test_ts_62), 4000, true,  false, (select t0 from test_ts_62)),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620942', gen_random_uuid(), '62001', (select neighborhood_id from test_ctx_62), (select t0 from test_ts_62), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620943', gen_random_uuid(), '62001', (select neighborhood_id from test_ctx_62), (select t0 from test_ts_62),  800, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620944', gen_random_uuid(), '62001', (select neighborhood_id from test_ctx_62), (select t0 from test_ts_62), 4000, true,  false, (select t0 from test_ts_62)),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620945', gen_random_uuid(), '62001', (select neighborhood_id from test_ctx_62), (select t0 from test_ts_62),  800, false, false, null),
  -- UNRESOLVED (NULL, NULL) -- zona no resuelta, EDGE12
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620951', gen_random_uuid(), null, null, (select t0 from test_ts_62), 4000, true,  false, (select t0 from test_ts_62)),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620952', gen_random_uuid(), null, null, (select t0 from test_ts_62),  800, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620953', gen_random_uuid(), null, null, (select t0 from test_ts_62), 4000, true,  false, null);

-- BOUNDARY (62009, NULL) -- shown_at controlado por usuario, sección 6.
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620961', gen_random_uuid(), '62009', null, (select from_ts  from test_ts_62), 4000, true, false, null), -- b1: EXACTO p_from
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620962', gen_random_uuid(), '62009', null, (select before_ts from test_ts_62), 4000, true, false, null), -- b2: 1s ANTES de p_from -> excluido
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620963', gen_random_uuid(), '62009', null, (select to_ts    from test_ts_62), 4000, true, false, null), -- b3: EXACTO p_to
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620964', gen_random_uuid(), '62009', null, (select after_ts  from test_ts_62), 4000, true, false, null), -- b4: 1s DESPUES de p_to -> excluido
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620301', '00000000-0000-0000-0000-000000620101', '00000000-0000-0000-0000-000000620965', gen_random_uuid(), '62009', null, (select mid_ts   from test_ts_62), 4000, true, false, null); -- b5: punto medio -> incluido

-- AGENCY_C: capacidad OFF pero impresiones REALES (5 usuarios, desglozaría si
-- el gate de can_advertise faltara -- mata ese mutante, AUTZ4).
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620302', '00000000-0000-0000-0000-000000620103', '00000000-0000-0000-0000-000000620971', gen_random_uuid(), '62099', null, (select t0 from test_ts_62), 4000, true, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620302', '00000000-0000-0000-0000-000000620103', '00000000-0000-0000-0000-000000620972', gen_random_uuid(), '62099', null, (select t0 from test_ts_62), 4000, true, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620302', '00000000-0000-0000-0000-000000620103', '00000000-0000-0000-0000-000000620973', gen_random_uuid(), '62099', null, (select t0 from test_ts_62), 4000, true, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620302', '00000000-0000-0000-0000-000000620103', '00000000-0000-0000-0000-000000620974', gen_random_uuid(), '62099', null, (select t0 from test_ts_62), 4000, true, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620302', '00000000-0000-0000-0000-000000620103', '00000000-0000-0000-0000-000000620975', gen_random_uuid(), '62099', null, (select t0 from test_ts_62), 4000, true, false, null);

-- ── EDGE12b (hallazgo del guardián 171.1) — zona NO RESUELTA con k>=5 ──────
-- ad_impressions.municipality_id/neighborhood_id nacen NULL cuando la zona
-- no resuelve (GPS apagado, punto fuera de polígono). Con MENOS de 5
-- usuarios caen en el bucket por la rama de colapso; con 5 O MÁS salían
-- ADEMÁS por la rama de desglose, produciendo DOS filas con la MISMA llave
-- (NULL, NULL). No se pierden datos, pero contradice la enumeración de
-- EDGE12 ('nunca como su propia fila aparte') y le entrega al cliente una
-- llave duplicada — el gotcha de FlatList 'same key' ya pagado en este repo.
-- AGENCY_D: 5 usuarios sin zona + 2 usuarios en 62D01 (colapsa) + 5 en
-- 62D02 (desglosa). Contrato esperado: 2 filas -> 62D02 con 5, y UNA sola
-- (NULL,NULL) con 5+2=7.
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620303', '00000000-0000-0000-0000-000000620104', '00000000-0000-0000-0000-000000620981', gen_random_uuid(), null, null, (select t0 from test_ts_62), 4000, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620303', '00000000-0000-0000-0000-000000620104', '00000000-0000-0000-0000-000000620982', gen_random_uuid(), null, null, (select t0 from test_ts_62), 4000, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620303', '00000000-0000-0000-0000-000000620104', '00000000-0000-0000-0000-000000620983', gen_random_uuid(), null, null, (select t0 from test_ts_62), 4000, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620303', '00000000-0000-0000-0000-000000620104', '00000000-0000-0000-0000-000000620984', gen_random_uuid(), null, null, (select t0 from test_ts_62), 4000, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620303', '00000000-0000-0000-0000-000000620104', '00000000-0000-0000-0000-000000620985', gen_random_uuid(), null, null, (select t0 from test_ts_62), 4000, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620303', '00000000-0000-0000-0000-000000620104', '00000000-0000-0000-0000-000000620986', gen_random_uuid(), '62D01', null, (select t0 from test_ts_62), 4000, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620303', '00000000-0000-0000-0000-000000620104', '00000000-0000-0000-0000-000000620987', gen_random_uuid(), '62D01', null, (select t0 from test_ts_62), 4000, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620303', '00000000-0000-0000-0000-000000620104', '00000000-0000-0000-0000-000000620988', gen_random_uuid(), '62D02', null, (select t0 from test_ts_62), 4000, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620303', '00000000-0000-0000-0000-000000620104', '00000000-0000-0000-0000-000000620989', gen_random_uuid(), '62D02', null, (select t0 from test_ts_62), 4000, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620303', '00000000-0000-0000-0000-000000620104', '00000000-0000-0000-0000-000000620990', gen_random_uuid(), '62D02', null, (select t0 from test_ts_62), 4000, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620303', '00000000-0000-0000-0000-000000620104', '00000000-0000-0000-0000-000000620991', gen_random_uuid(), '62D02', null, (select t0 from test_ts_62), 4000, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000620303', '00000000-0000-0000-0000-000000620104', '00000000-0000-0000-0000-000000620992', gen_random_uuid(), '62D02', null, (select t0 from test_ts_62), 4000, false, false, null);

-- ── FIXTURE_ANCHOR: protege el archivo de derivar mal sus propios totales si
--    alguien edita las impresiones de arriba sin actualizar los comentarios
--    de EXPECTATIVA -- ancla independiente del SUT (cuenta cruda, superusuario).
select is(
  (select count(*)::int from public.ad_impressions where agency_id = '00000000-0000-0000-0000-000000620101'),
  28,
  'FIXTURE_ANCHOR1_agencia_A_tiene_exactamente_28_impresiones_sembradas'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Firma pública — catálogo EXACTO (pg_get_function_result/arguments), leído
--    del catálogo real, nunca reescrito a mano.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_sig_62 (ok boolean, result_sig text, args_sig text, err_sqlstate text);
do $$
declare
  v_oid oid;
begin
  v_oid := to_regprocedure('public.ad_metrics_for_agency(uuid, timestamptz, timestamptz)');
  if v_oid is null then
    insert into result_sig_62 values (false, null, null, 'function_not_found');
  else
    insert into result_sig_62
    select true, pg_get_function_result(v_oid), pg_get_function_arguments(v_oid), null;
  end if;
exception when others then
  insert into result_sig_62 values (false, null, null, sqlstate);
end $$;

select is((select ok from result_sig_62), true,
  'SIG1_la_funcion_resuelve_por_catalogo_con_la_firma_p_agency_id_uuid_p_from_p_to_timestamptz');

select is(
  (select result_sig from result_sig_62),
  'TABLE(municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer)',
  'SIG2_firma_de_retorno_EXACTA_neighborhood_id_es_bigint_NO_uuid_5_columnas_y_nada_mas'
);

select is(
  (select args_sig from result_sig_62),
  'p_agency_id uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone',
  'SIG3_argumentos_EXACTOS_p_from_p_to_opcionales_default_null'
);

select is(
  (select prosecdef from pg_proc where proname = 'ad_metrics_for_agency' and pronamespace = 'public'::regnamespace),
  true,
  'SIG4_es_security_definer'
);

select is(
  (select proconfig from pg_proc where proname = 'ad_metrics_for_agency' and pronamespace = 'public'::regnamespace),
  array['search_path=""']::text[],
  'SIG5_search_path_vacio_fijo_patron_get_lead_stats'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Ancla de fuga (EDGE6) — ni el dueño legítimo lee ad_impressions directo;
--    anon no puede ejecutar el RPC.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000620001', 'authenticated'); -- OWNER_A
select is(
  (select count(*)::int from public.ad_impressions),
  0,
  'LEAK1_ni_el_dueno_legitimo_de_la_agencia_lee_una_sola_fila_de_ad_impressions_por_select_directo'
);
reset role;

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select * from public.ad_metrics_for_agency('00000000-0000-0000-0000-000000620101'::uuid, null, null) $$,
  '42501', null,
  'LEAK2_anon_no_puede_ejecutar_el_rpc_42501'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Autorización por impersonación — anti-IDOR, matriz de membresía,
--    capacidad de la organización, y organización sin datos (EDGE1-5,14).
-- ════════════════════════════════════════════════════════════════════════════

-- AUTZ1: OWNER_B (dueño de OTRA organización) pide las métricas de AGENCY_A.
create temp table result_autz1_62 (ok boolean, err_sqlstate text);
create temp table result_autz1_62_rows (municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer);
grant all on result_autz1_62, result_autz1_62_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000620004', 'authenticated'); -- OWNER_B
do $$
begin
  insert into result_autz1_62_rows
  select * from public.ad_metrics_for_agency('00000000-0000-0000-0000-000000620101'::uuid, null, null);
  insert into result_autz1_62 values (true, null);
exception when others then
  insert into result_autz1_62 values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_autz1_62), true, 'AUTZ1a_owner_de_otra_organizacion_no_lanza_excepcion_anti_idor');
select is((select count(*)::int from result_autz1_62_rows), 0, 'AUTZ1b_owner_de_otra_organizacion_recibe_0_filas_nunca_un_403_informativo');

-- AUTZ2: VIEWER_A (miembro viewer ACTIVO de AGENCY_A) SÍ lee -- 4 filas
-- esperadas (MUNI_5, NEIGH, BOUNDARY, otras_zonas). El detalle por zona se
-- verifica con OWNER_A en la sección 5 -- aquí solo se prueba que un rol
-- NO privilegiado (viewer) no está bloqueado.
create temp table result_autz2_62 (ok boolean, err_sqlstate text);
create temp table result_autz2_62_rows (municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer);
grant all on result_autz2_62, result_autz2_62_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000620002', 'authenticated'); -- VIEWER_A
do $$
begin
  insert into result_autz2_62_rows
  select * from public.ad_metrics_for_agency('00000000-0000-0000-0000-000000620101'::uuid, null, null);
  insert into result_autz2_62 values (true, null);
exception when others then
  insert into result_autz2_62 values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_autz2_62), true, 'AUTZ2a_viewer_activo_no_lanza_excepcion');
select is((select count(*)::int from result_autz2_62_rows), 4, 'AUTZ2b_viewer_activo_SI_lee_4_filas_3_desglosadas_mas_otras_zonas');

-- AUTZ3: SUSPENDED_A (miembro suspended de AGENCY_A) NO lee.
create temp table result_autz3_62 (ok boolean, err_sqlstate text);
create temp table result_autz3_62_rows (municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer);
grant all on result_autz3_62, result_autz3_62_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000620003', 'authenticated'); -- SUSPENDED_A
do $$
begin
  insert into result_autz3_62_rows
  select * from public.ad_metrics_for_agency('00000000-0000-0000-0000-000000620101'::uuid, null, null);
  insert into result_autz3_62 values (true, null);
exception when others then
  insert into result_autz3_62 values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_autz3_62), true, 'AUTZ3a_suspended_no_lanza_excepcion_tambien_anti_idor');
select is((select count(*)::int from result_autz3_62_rows), 0, 'AUTZ3b_miembro_suspended_NO_lee_0_filas');

-- AUTZ4: OWNER_C, dueño ACTIVO de AGENCY_C, pero can_advertise=false. Tiene
-- 5 impresiones REALES sembradas -- si el gate de capacidad faltara, esta
-- llamada traería una fila real.
create temp table result_autz4_62 (ok boolean, err_sqlstate text);
create temp table result_autz4_62_rows (municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer);
grant all on result_autz4_62, result_autz4_62_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000620005', 'authenticated'); -- OWNER_C
do $$
begin
  insert into result_autz4_62_rows
  select * from public.ad_metrics_for_agency('00000000-0000-0000-0000-000000620103'::uuid, null, null);
  insert into result_autz4_62 values (true, null);
exception when others then
  insert into result_autz4_62 values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_autz4_62), true, 'AUTZ4a_owner_sin_can_advertise_no_lanza_excepcion');
select is((select count(*)::int from result_autz4_62_rows), 0, 'AUTZ4b_organizacion_sin_can_advertise_NO_se_lee_pese_a_tener_impresiones_reales');

-- AUTZ5: STRANGER, authenticated sin NINGUNA relación con AGENCY_A.
create temp table result_autz5_62 (ok boolean, err_sqlstate text);
create temp table result_autz5_62_rows (municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer);
grant all on result_autz5_62, result_autz5_62_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000620006', 'authenticated'); -- STRANGER
do $$
begin
  insert into result_autz5_62_rows
  select * from public.ad_metrics_for_agency('00000000-0000-0000-0000-000000620101'::uuid, null, null);
  insert into result_autz5_62 values (true, null);
exception when others then
  insert into result_autz5_62 values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_autz5_62), true, 'AUTZ5a_authenticated_sin_relacion_no_lanza_excepcion');
select is((select count(*)::int from result_autz5_62_rows), 0, 'AUTZ5b_authenticated_sin_relacion_con_la_organizacion_recibe_0_filas');

-- AUTZ6/EDGE14: OWNER_B pide las métricas de SU PROPIA agencia (AGENCY_B),
-- que no tiene NINGUNA impresión -- 0 filas, SIN error.
create temp table result_autz6_62 (ok boolean, err_sqlstate text);
create temp table result_autz6_62_rows (municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer);
grant all on result_autz6_62, result_autz6_62_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000620004', 'authenticated'); -- OWNER_B
do $$
begin
  insert into result_autz6_62_rows
  select * from public.ad_metrics_for_agency('00000000-0000-0000-0000-000000620102'::uuid, null, null);
  insert into result_autz6_62 values (true, null);
exception when others then
  insert into result_autz6_62 values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_autz6_62), true, 'AUTZ6a_organizacion_sin_impresiones_no_lanza_excepcion');
select is((select count(*)::int from result_autz6_62_rows), 0, 'AUTZ6b_organizacion_autorizada_sin_impresiones_devuelve_vacio_EDGE14');

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Privacidad (EDGE7) — la firma de retorno REAL (catálogo, sección 1) no
--    contiene user_id ni session_id en ningún lado del string.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select (result_sig not like '%user_id%' and result_sig not like '%session_id%') from result_sig_62),
  true,
  'PRIV1_la_firma_de_retorno_real_no_menciona_user_id_ni_session_id_ni_siquiera_hasheados'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Agregación + k-anonimato (EDGE8/9/10/11/12) — llamada SIN rango como
--    OWNER_A, verificada contra los totales calculados A MANO en la sección 0
--    (fuente independiente, nunca la misma expresión SQL que usará el SUT).
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_owner_62 (ok boolean, err_sqlstate text);
create temp table result_owner_62_rows (municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer);
grant all on result_owner_62, result_owner_62_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000620001', 'authenticated'); -- OWNER_A
do $$
begin
  insert into result_owner_62_rows
  select * from public.ad_metrics_for_agency('00000000-0000-0000-0000-000000620101'::uuid, null, null);
  insert into result_owner_62 values (true, null);
exception when others then
  insert into result_owner_62 values (false, sqlstate);
end $$;
reset role;

select is((select ok from result_owner_62), true, 'AGG0_la_llamada_del_dueno_no_lanza_excepcion');
select is((select count(*)::int from result_owner_62_rows), 4,
  'AGG1_4_filas_MUNI_5_NEIGH_BOUNDARY_desglosadas_mas_UNA_fila_otras_zonas');

-- MUNI_5 (62001, NULL) -- 5 usuarios -> desglosa.
select is((select impressions from result_owner_62_rows where municipality_id = '62001' and neighborhood_id is null), 5, 'AGG2a_MUNI_5_impresiones_5');
select is((select views       from result_owner_62_rows where municipality_id = '62001' and neighborhood_id is null), 3, 'AGG2b_MUNI_5_vistas_3');
select is((select cta_taps    from result_owner_62_rows where municipality_id = '62001' and neighborhood_id is null), 2, 'AGG2c_MUNI_5_cta_taps_2');

-- NEIGH (62001, neighborhood_id real) -- mismo municipio que MUNI_5, colonia
-- resuelta distinta -> fila PROPIA (prueba que la llave es el par completo).
select is((select neighborhood_id from result_owner_62_rows where municipality_id = '62001' and neighborhood_id is not null), (select neighborhood_id from test_ctx_62), 'AGG3a_NEIGH_neighborhood_id_es_el_real_de_mx_neighborhoods_no_uuid');
select is((select impressions from result_owner_62_rows where municipality_id = '62001' and neighborhood_id is not null), 5, 'AGG3b_NEIGH_impresiones_5');
select is((select views       from result_owner_62_rows where municipality_id = '62001' and neighborhood_id is not null), 3, 'AGG3c_NEIGH_vistas_3');
select is((select cta_taps    from result_owner_62_rows where municipality_id = '62001' and neighborhood_id is not null), 2, 'AGG3d_NEIGH_cta_taps_2');

-- BOUNDARY (62009, NULL) -- sin rango, sus 5 usuarios cuentan completos -> desglosa.
select is((select impressions from result_owner_62_rows where municipality_id = '62009'), 5, 'AGG4_BOUNDARY_sin_rango_desglosa_con_sus_5_usuarios_impresiones_5');

-- MUNI_4 (62002) -- 4 usuarios -> NO tiene fila propia (colapsó, EDGE8 lado "4").
select is((select count(*)::int from result_owner_62_rows where municipality_id = '62002'), 0,
  'AGG5_MUNI_4_con_4_usuarios_distintos_NO_tiene_fila_propia_colapso');

-- SINGLE_6 (62003) -- 1 usuario con 6 impresiones -> NO tiene fila propia
-- (EDGE9, el assert estrella: por IMPRESIONES pasaría el umbral de 5, por
-- USUARIOS DISTINTOS no).
select is((select count(*)::int from result_owner_62_rows where municipality_id = '62003'), 0,
  'AGG6_SINGLE_USUARIO_con_6_impresiones_NO_tiene_fila_propia_colapso_por_usuarios_no_por_impresiones');

-- "otras zonas" (NULL, NULL) -- colapso de MUNI_4 + SINGLE_6 + UNRESOLVED,
-- conserva los totales exactos (EDGE10, EDGE12).
select is((select impressions from result_owner_62_rows where municipality_id is null and neighborhood_id is null), 13, 'AGG7a_otras_zonas_impresiones_13_4_mas_6_mas_3');
select is((select views       from result_owner_62_rows where municipality_id is null and neighborhood_id is null),  8, 'AGG7b_otras_zonas_vistas_8_2_mas_4_mas_2');
select is((select cta_taps    from result_owner_62_rows where municipality_id is null and neighborhood_id is null),  5, 'AGG7c_otras_zonas_cta_taps_5_1_mas_3_mas_1');

-- Conservación GLOBAL: suma de TODAS las filas devueltas == el total real
-- sembrado a mano en la sección 0 (28/19/9) -- colapsar no pierde impresiones.
select is((select sum(impressions)::int from result_owner_62_rows), 28, 'AGG8a_suma_de_TODAS_las_filas_impresiones_28_igual_al_total_real_sembrado');
select is((select sum(views)::int       from result_owner_62_rows), 19, 'AGG8b_suma_de_TODAS_las_filas_vistas_19_igual_al_total_real_sembrado');
select is((select sum(cta_taps)::int    from result_owner_62_rows),  9, 'AGG8c_suma_de_TODAS_las_filas_cta_taps_9_igual_al_total_real_sembrado');

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Rango p_from/p_to (EDGE13) — filtra por shown_at, frontera INCLUSIVA en
--    ambos extremos. Fuera de la ventana [FROM_TS,TO_TS] no hay NADA más que
--    la zona BOUNDARY (el resto vive en T0, 2026-07-01) -- aísla la prueba.
-- ════════════════════════════════════════════════════════════════════════════

-- 6a) Ventana completa [FROM_TS,TO_TS]: b1,b3,b5 caen DENTRO (3 usuarios),
-- b2/b4 quedan FUERA -> con rango la zona BOUNDARY pasa de desglosar (5, sin
-- rango) a COLAPSAR (3 usuarios < 5) -- el k-anonimato se re-evalua sobre el
-- conjunto YA filtrado por rango, no sobre el total histórico.
create temp table result_rng_full_62 (ok boolean, err_sqlstate text);
create temp table result_rng_full_62_rows (municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer);
grant all on result_rng_full_62, result_rng_full_62_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000620001', 'authenticated'); -- OWNER_A
do $$
begin
  insert into result_rng_full_62_rows
  select * from public.ad_metrics_for_agency(
    '00000000-0000-0000-0000-000000620101'::uuid,
    (select from_ts from test_ts_62),
    (select to_ts   from test_ts_62)
  );
  insert into result_rng_full_62 values (true, null);
exception when others then
  insert into result_rng_full_62 values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_rng_full_62), true, 'RNG0_la_llamada_con_rango_no_lanza_excepcion');
select is((select count(*)::int from result_rng_full_62_rows), 1,
  'RNG1_con_rango_solo_queda_UNA_fila_otras_zonas_todo_lo_demas_vive_fuera_de_la_ventana');
select is(
  (select (municipality_id is null and neighborhood_id is null) from result_rng_full_62_rows limit 1),
  true,
  'RNG2_la_unica_fila_con_rango_es_el_bucket_otras_zonas_BOUNDARY_colapso_con_3_usuarios'
);
select is((select impressions from result_rng_full_62_rows), 3, 'RNG3_impresiones_3_b1_b3_b5_b2_y_b4_quedan_fuera_del_rango');
select is((select views       from result_rng_full_62_rows), 3, 'RNG4_vistas_3');
select is((select cta_taps    from result_rng_full_62_rows), 0, 'RNG5_cta_taps_0');

-- 6b) Ventana de ancho CERO exactamente en p_from (FROM_TS,FROM_TS): SOLO b1
-- (frontera INFERIOR inclusiva).
create temp table result_rng_lower_62 (ok boolean, err_sqlstate text);
create temp table result_rng_lower_62_rows (municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer);
grant all on result_rng_lower_62, result_rng_lower_62_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000620001', 'authenticated'); -- OWNER_A
do $$
begin
  insert into result_rng_lower_62_rows
  select * from public.ad_metrics_for_agency(
    '00000000-0000-0000-0000-000000620101'::uuid,
    (select from_ts from test_ts_62),
    (select from_ts from test_ts_62)
  );
  insert into result_rng_lower_62 values (true, null);
exception when others then
  insert into result_rng_lower_62 values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_rng_lower_62), true, 'RNG6_ventana_cero_en_p_from_no_lanza_excepcion');
select is((select sum(impressions)::int from result_rng_lower_62_rows), 1,
  'RNG7_ventana_cero_exacta_en_p_from_incluye_EXACTAMENTE_b1_frontera_inferior_inclusiva');

-- 6c) Ventana de ancho CERO exactamente en p_to (TO_TS,TO_TS): SOLO b3
-- (frontera SUPERIOR inclusiva).
create temp table result_rng_upper_62 (ok boolean, err_sqlstate text);
create temp table result_rng_upper_62_rows (municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer);
grant all on result_rng_upper_62, result_rng_upper_62_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000620001', 'authenticated'); -- OWNER_A
do $$
begin
  insert into result_rng_upper_62_rows
  select * from public.ad_metrics_for_agency(
    '00000000-0000-0000-0000-000000620101'::uuid,
    (select to_ts from test_ts_62),
    (select to_ts from test_ts_62)
  );
  insert into result_rng_upper_62 values (true, null);
exception when others then
  insert into result_rng_upper_62 values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_rng_upper_62), true, 'RNG8_ventana_cero_en_p_to_no_lanza_excepcion');
select is((select sum(impressions)::int from result_rng_upper_62_rows), 1,
  'RNG9_ventana_cero_exacta_en_p_to_incluye_EXACTAMENTE_b3_frontera_superior_inclusiva');

-- ── EDGE12b: la zona sin resolver con k>=5 NO puede producir su propia fila ──
create temp table result_edge12b_62 as select false as ok, ''::text as err;
create temp table result_edge12b_62_rows (municipality_id text, neighborhood_id bigint, impressions int, views int, cta_taps int);
grant all on result_edge12b_62 to public;
grant all on result_edge12b_62_rows to public;

do $$
begin
  perform pg_temp.act_as('00000000-0000-0000-0000-000000620007', 'authenticated');
  insert into result_edge12b_62_rows
    select * from public.ad_metrics_for_agency('00000000-0000-0000-0000-000000620104');
  update result_edge12b_62 set ok = true;
exception when others then
  update result_edge12b_62 set ok = false, err = sqlstate;
end $$;
reset role;

select is((select ok from result_edge12b_62), true, 'EDGE12b0_la_llamada_de_agency_d_no_lanza_excepcion');

select is(
  (select count(*)::int from result_edge12b_62_rows
    where municipality_id is null and neighborhood_id is null),
  1,
  'EDGE12b1_zona_sin_resolver_con_5_usuarios_NO_genera_una_SEGUNDA_fila_null_null_llave_duplicada');

-- sum() y no un escalar directo: mientras el defecto viva, hay DOS filas
-- (NULL,NULL) y una subquery escalar ABORTARÍA el archivo entero antes de
-- llegar a los asserts siguientes. Con el fix hay una sola fila y sum()==ella.
select is(
  (select sum(impressions)::int from result_edge12b_62_rows
    where municipality_id is null and neighborhood_id is null),
  7,
  'EDGE12b2_la_unica_fila_null_null_funde_las_5_sin_zona_mas_las_2_colapsadas_sin_perder_nada');

select is((select count(*)::int from result_edge12b_62_rows), 2,
  'EDGE12b3_en_total_2_filas_62D02_desglosada_mas_UNA_otras_zonas');

select * from finish();
rollback;
