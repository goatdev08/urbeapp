-- Tests pgTAP — 3 RPCs de lectura POR ANUNCIO para el dashboard #212
-- (subtarea #212.1, tarea 212, dependiente de #201). Ejecutar con:
--   supabase test db supabase/tests/70_ad_stats_per_ad_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de
-- una transacción revertida (no persiste). Impersonamos con
-- pg_temp.act_as(uid, role) (mismo patrón que 02/16/25/37/43/44/46/47/48/51/
-- 52/53/62/63/64/68/69_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba: el contrato PÚBLICO de 3 RPCs NUEVAS (AÚN NO EXISTEN —
-- RED 2026-08-23), calcando el patrón anti-IDOR/dos-fuentes de
-- public.ad_metrics_for_agency (20260821000001/20260823000005) pero
-- desglosado POR ANUNCIO en vez de por agencia:
--
--   public.ad_stats_totals(p_ad_id uuid, p_from timestamptz default null,
--     p_to timestamptz default null)
--     returns table (impressions integer, views integer, cta_taps integer)
--
--   public.ad_stats_daily(p_ad_id uuid, p_from timestamptz default null,
--     p_to timestamptz default null)
--     returns table (day date, impressions integer, views integer, cta_taps integer)
--
--   public.ad_stats_zones(p_ad_id uuid, p_from timestamptz default null,
--     p_to timestamptz default null)
--     returns table (municipality_id text, neighborhood_id bigint,
--       impressions integer, views integer, cta_taps integer)
--
-- Las 3: security definer, set search_path = '', revoke execute from public,
-- anon; grant execute to authenticated (el anti-IDOR interno es el gate, no
-- el grant). Autorización: resuelven v_agency_id := (select agency_id from
-- public.ads where id = p_ad_id) — un p_ad_id inexistente deja v_agency_id
-- NULL — y exigen private.agency_role_of(v_agency_id) is not null AND
-- private.org_can_advertise(v_agency_id), EXACTAMENTE como
-- ad_metrics_for_agency. Sin autorización: 0 FILAS, nunca una excepción.
--
-- ── D-TOTALS/D-ZONES (heredan el patrón EXACTO de 20260823000005) ──────────
-- Dos fuentes sin doble contar: un mes es ELEGIBLE ⟺ su inicio >= now() - 90
-- días (misma constante c_retention_days=90 que purge_ad_impressions /
-- rollup_ad_impressions_monthly / ad_metrics_for_agency). El crudo
-- (ad_impressions) aporta SOLO meses elegibles; monthly
-- (ad_impressions_monthly) aporta SOLO meses NO elegibles — INCONDICIONAL,
-- independiente de p_from/p_to. D-RANGO-MONTHLY: una fila monthly con
-- year_month=M se incluye sii [M, M+1 mes) se traslapa con [p_from,p_to]
-- (frontera inclusiva). D-MEZCLA (k-anonimato al mezclar, MISMA regla que
-- 20260823000005 pero evaluada POR (ad_id, zona) — monthly ya viene
-- filtrado por k POR AD desde 201.1, así que sus filas de zona real son
-- SIEMPRE de fiar; el crudo sigue evaluando su PROPIO count(distinct
-- user_id) >= 5 sobre el conjunto (ad_id, zona) — una zona con AMBOS
-- orígenes y crudo sub-umbral muestra SOLO la porción monthly (el crudo se
-- funde al bucket, nunca se suma a la zona — anti-differencing); si el
-- crudo SÍ pasa su propio k, se suma limpio con la porción monthly.
--
-- ── D-DAILY-ELIGIBLE (decisión de contrato de este RED, NO fijada por el
--    orquestador) — ad_stats_daily es SOLO del crudo, pero el crudo se
--    filtra con la MISMA compuerta de elegibilidad (date_trunc('month',
--    shown_at) >= now() - 90 días) que usan totals/zones para decidir
--    crudo-vs-monthly ────────────────────────────────────────────────────
-- Razón: un remanente de crudo que sobrevive para un mes YA consolidado en
-- monthly (purga rezagada, el mismo escenario "stray" de FRONT2/68) no debe
-- aparecer como un día huérfano en la serie diaria — ese mes ya está
-- "congelado" (representado por su fila monthly en totals/zones, sin
-- granularidad diaria) y mostrar un día suelto de él en el gráfico de línea
-- sería inconsistente con lo que el selector "Máximo" reporta como total
-- para ese mismo periodo. Consecuencia observable y ASIMÉTRICA (documentada
-- en el plan 212.1): un mes ELEGIBLE aporta sus días normalmente; un mes NO
-- elegible aporta CERO días a la serie diaria, aunque SÍ aporte su cifra
-- consolidada a totals/zones — el cliente nunca ve una línea de tiempo para
-- periodos históricos, solo el número agregado del selector "Máximo".
-- ad_stats_daily NUNCA aplica umbral k (regla fija de Abraham "zona ⇒ k≥5;
-- sin zona ⇒ libre" — la serie diaria no tiene dimensión geográfica, así que
-- no hay zona que anonimizar; un día con una sola persona SÍ aparece).
--
-- ── D-GRANULARIDAD-AD (decisión de contrato de este RED) — el k-anonimato
--    de ad_stats_zones se evalúa POR (ad_id, zona), NUNCA por (agencia,
--    zona) ────────────────────────────────────────────────────────────────
-- A diferencia de ad_metrics_for_agency (agrega TODOS los anuncios de la
-- agencia), esta RPC filtra por un p_ad_id específico desde el principio —
-- el count(distinct user_id) del crudo debe contarse SOLO sobre las filas de
-- ESE anuncio. Un anuncio hermano de la MISMA agencia con usuarios propios
-- en la MISMA zona NUNCA debe sumarse al conteo de distintos de este anuncio
-- (ISO1/ISO2/ISO3 abajo) — mataría el k-anonimato por AD que el plan exige
-- ("mejor aún que en la de agencia").
--
-- ── Estrategia RED sin depender de "function does not exist" (patrón YA
--    establecido en 51/53/62/63/68/69_*) ─────────────────────────────────
-- NUNCA se crea una migración-stub en supabase/migrations/ (ese archivo lo
-- escribe el GREEN). (a) los asserts de catálogo puro (to_regprocedure,
-- pg_proc, pg_get_function_*, has_function_privilege vía join a pg_proc.oid
-- — NUNCA la forma 'firma(text)' que hace un cast interno y lanza 42883 sin
-- protección, gotcha documentado en 67/68) son seguros aunque las funciones
-- no existan — resuelven NULL/false sin lanzar. (b) TODA llamada real va
-- dentro de un bloque `do $$ ... exception when others then ... $$`
-- AUTO-PROTEGIDO que escribe su resultado en una tabla temporal — el archivo
-- entero corre sin abortar pese al 42883 de HOY, y las aserciones de valores
-- fallan limpio contra tablas vacías (0 filas / NULL) en vez de las cifras
-- reales esperadas. DELTA total: ninguna aserción de este archivo puede
-- pasar hoy por la razón correcta.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ────────────────
-- CATALOGO: las 3 existen por catálogo (firma exacta uuid/timestamptz x2),
--   security definer, search_path = '', authenticated CON EXECUTE estático,
--   anon SIN EXECUTE estático + throws_ok 42501 funcional.
-- ANTI-IDOR fail-closed (10 escenarios, ok=true nunca excepción + 0 filas):
--   TOT_STRANGER/TOT_NOCAP/TOT_OTHERAG/TOT_NOADID (matriz completa en
--   totals) — stranger sin ninguna membresía; organización con
--   can_advertise=false (con datos reales sembrados — el gate bloquea aunque
--   haya algo que mostrar); owner LEGÍTIMO de OTRA agencia con
--   can_advertise=true (el ad debe pertenecer a SU agencia, no basta ser
--   anunciante en general); p_ad_id que no existe en absoluto.
--   DAILY_STRANGER/DAILY_NOCAP/DAILY_NOADID y ZONES_STRANGER/
--   ZONES_OTHERAG/ZONES_NOADID — subconjunto representativo en las otras 2
--   RPCs (el archivo 69 ya cubrió exhaustivamente la matriz completa a nivel
--   agencia; aquí se re-verifica que el MISMO gate, reimplementado 3 veces,
--   no se rompe en ninguna).
-- TOTALS: NORANGE mezcla ambas fuentes sin doblar (FRONT1 análogo — mes
--   elegible ignora monthly duplicado); RNG1 rango explícito con frontera
--   INCLUSIVA en AMBOS extremos (p_from == shown_at de la primera fila,
--   p_to == shown_at de la última — si la frontera fuera estricta el total
--   cambiaría); RNG_FROZEN rango dentro del mes congelado (solo monthly).
-- DAILY: una fila por día CON actividad (sin relleno de ceros); SIN umbral
--   (día con 1 usuario SÍ aparece, DAILY_D); orden day ascendente
--   (DAILY_ORDER, verificado contra el orden de INSERCIÓN real de la RPC,
--   no reordenado a mano); el remanente "stray" de un mes YA congelado NO
--   aparece como día (D-DAILY-ELIGIBLE); asimetría dura: RNG_FROZEN da 0
--   FILAS en daily pese a que ese mismo rango SÍ tiene datos en
--   totals/zones (vía monthly).
-- ZONES: k>=5 por count(distinct user_id) A NIVEL (ad_id, zona) — NO a nivel
--   agencia (ISO1 zona bajo el umbral para ESTE ad pese a que un ad HERMANO
--   de la MISMA agencia tiene usuarios propios en la MISMA zona; ISO3
--   confirma en la dirección opuesta que ad_stats_totals(AD_B) NUNCA incluye
--   los datos de AD_A); bucket (NULL,NULL) funde 3 orígenes (sin zona +
--   zona sub-umbral + bucket monthly congelado) en UNA sola fila; D-MEZCLA
--   (zona con ambos orígenes y crudo bajo el umbral vs. zona con ambos
--   orígenes y crudo que SÍ pasa su propio k); DEDUPE (ninguna llave se
--   repite); bajo RNG1 una zona cuya única fuente confiable era monthly
--   desaparece (el monthly no traslapa el rango), mientras otra zona sigue
--   apareciendo con SOLO su valor crudo (prueba que el crudo evalúa su
--   propio k de forma independiente del rango); bajo RNG_FROZEN todo sale
--   de monthly, cero crudo (ni siquiera el que pasaría su propio k).
-- COHERENCIA cruzada entre las 3 RPCs (mismo fixture, misma llamada): la
--   suma de TODAS las filas de zones == totals; totals == suma de daily
--   MÁS el total de un rango acotado al mes congelado (monthly) — la
--   descomposición "serie diaria (crudo) + histórico (monthly)" que arma el
--   selector "Máximo" del panel debe cuadrar exactamente con dinero (#172).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(82);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- Helper genérico: ejecuta cualquiera de las 3 RPCs por NOMBRE vía SQL
-- dinámico y solo captura ok/rowcount -- usado por la matriz anti-IDOR
-- (que no necesita comparar valores, solo "0 filas, nunca una excepción").
-- Las secciones de comportamiento (3-5) SIGUEN llamando cada RPC de forma
-- literal y tipada para verificar valores exactos -- este helper NUNCA
-- reemplaza esas llamadas.
create or replace function pg_temp.call_stats_count(p_fn text, p_ad_id uuid, p_from timestamptz, p_to timestamptz)
returns table(ok boolean, err_sqlstate text, row_count integer)
language plpgsql as $$
declare
  v_count integer;
begin
  execute format('select count(*) from public.%I($1, $2, $3)', p_fn)
    into v_count
    using p_ad_id, p_from, p_to;
  return query select true, null::text, v_count;
exception when others then
  return query select false, sqlstate, null::integer;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) Fixtures — self-contained, prefijo '700XXX' (fuera del rango de otros
--    archivos: 51='510XXX', 62='620XXX', 63='630XXX', 68='680XXX',
--    69='690XXX'). Fechas RELATIVAS a now() (lección de 201.1/68/69):
--    month_current SIEMPRE elegible, month_frozen 10 meses atrás (margen
--    amplio, evita fragilidad de fin-de-mes). municipality_id es TEXT SIN FK
--    (20260817000002) -- no hace falta geo real.
-- ════════════════════════════════════════════════════════════════════════════

create temp table test_marks_70 as
select
  date_trunc('month', now())                                              as month_current,
  (date_trunc('month', now()) - interval '10 months')                     as month_frozen,
  date_trunc('month', now()) + interval '5 days 8 hours'                  as day_a,
  date_trunc('month', now()) + interval '6 days 8 hours'                  as day_b,
  date_trunc('month', now()) + interval '7 days 8 hours'                  as day_c,
  date_trunc('month', now()) + interval '8 days 8 hours'                  as day_d,
  date_trunc('month', now()) - interval '10 months' + interval '5 days 8 hours' as frozen_day,
  -- RNG1: frontera INCLUSIVA en ambos extremos -- p_from == shown_at EXACTO
  -- de la primera fila de Z1 (day_a + 0 min), p_to == shown_at EXACTO de la
  -- última fila de Z4 (day_c + 4 min). Excluye day_d y el mes congelado.
  (date_trunc('month', now()) + interval '5 days 8 hours')                 as rng1_from,
  (date_trunc('month', now()) + interval '7 days 8 hours 4 minutes')       as rng1_to,
  -- RNG_FROZEN: ventana angosta DENTRO del mes congelado -- traslapa TODAS
  -- las filas monthly de ese mes (D-RANGO-MONTHLY), excluye todo el crudo
  -- (incondicional -- el crudo de un mes no elegible nunca se lee, ni el
  -- stray) y da 0 días en la serie diaria (asimetría dura).
  (date_trunc('month', now()) - interval '10 months')                      as rng_frozen_from,
  (date_trunc('month', now()) - interval '10 months' + interval '15 days') as rng_frozen_to;
grant select on test_marks_70 to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000700001', 'owner_70@urbea.mx'),
  ('00000000-0000-0000-0000-000000700002', 'stranger_70@urbea.mx'),
  ('00000000-0000-0000-0000-000000700003', 'owner_70_other@urbea.mx'),
  ('00000000-0000-0000-0000-000000700004', 'owner_70_nocap@urbea.mx');

insert into public.agencies (id, name, slug, status, can_advertise, advertiser_category, created_by_user_id) values
  ('00000000-0000-0000-0000-000000700101', 'Agencia Stats 70', 'agencia-stats-70',
   'active', true, 'otro', '00000000-0000-0000-0000-000000700001'),
  ('00000000-0000-0000-0000-000000700102', 'Agencia Stats 70 Otra', 'agencia-stats-70-otra',
   'active', true, 'otro', '00000000-0000-0000-0000-000000700003'),
  ('00000000-0000-0000-0000-000000700103', 'Agencia Stats 70 SinCap', 'agencia-stats-70-sincap',
   'active', false, null, '00000000-0000-0000-0000-000000700004');

insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700001', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000700102', '00000000-0000-0000-0000-000000700003', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000700103', '00000000-0000-0000-0000-000000700004', 'owner', 'active');
-- STRANGER (700002) NO tiene fila en agency_members -- IDOR base.

insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000700201', '00000000-0000-0000-0000-000000700101', 'ready'),
  ('00000000-0000-0000-0000-000000700202', '00000000-0000-0000-0000-000000700101', 'ready'),
  ('00000000-0000-0000-0000-000000700203', '00000000-0000-0000-0000-000000700103', 'ready');

insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101',
   '00000000-0000-0000-0000-000000700201', 'AD_70A (bajo prueba)', 'phone', '+5213300007001',
   'active', '2020-01-01'::timestamptz, '2035-01-01'::timestamptz),
  ('00000000-0000-0000-0000-000000700302', '00000000-0000-0000-0000-000000700101',
   '00000000-0000-0000-0000-000000700202', 'AD_70B (hermano, misma agencia)', 'phone', '+5213300007002',
   'active', '2020-01-01'::timestamptz, '2035-01-01'::timestamptz),
  ('00000000-0000-0000-0000-000000700303', '00000000-0000-0000-0000-000000700103',
   '00000000-0000-0000-0000-000000700203', 'AD_70_NOCAP (organizacion sin can_advertise)', 'phone', '+5213300007003',
   'active', '2020-01-01'::timestamptz, '2035-01-01'::timestamptz);
-- AD_70_INEXISTENTE ('...0000007099ff') NUNCA se inserta -- IDOR "ad no existe".

-- ── AD_70A: Z1 (70001) -- CURRENT mes elegible, 5 usuarios distintos:
--    impresiones=5 views=3(u1,u2,u4) cta=2(u1,u5). Frontera RNG1 EXACTA:
--    primera fila == rng1_from.
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700911', gen_random_uuid(), '70001', null, (select day_a from test_marks_70), 4000, true,  false, (select day_a from test_marks_70)),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700912', gen_random_uuid(), '70001', null, (select day_a + interval '1 minute' from test_marks_70), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700913', gen_random_uuid(), '70001', null, (select day_a + interval '2 minutes' from test_marks_70),  800, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700914', gen_random_uuid(), '70001', null, (select day_a + interval '3 minutes' from test_marks_70), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700915', gen_random_uuid(), '70001', null, (select day_a + interval '4 minutes' from test_marks_70),  800, false, false, (select day_a + interval '4 minutes 30 seconds' from test_marks_70));

-- Monthly duplicado del MISMO mes elegible (999s) -- debe IGNORARSE por
-- completo (análogo FRONT1 de 69): un mes elegible JAMÁS lee monthly.
insert into public.ad_impressions_monthly (agency_id, ad_id, municipality_id, neighborhood_id, year_month, impressions, views, completions, cta_taps) values
  ('00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700301', '70001', null, (select month_current::date from test_marks_70), 999, 999, 999, 999);

-- ── sin zona (NULL,NULL), CURRENT mes: impresiones=2 views=1 cta=0 --------
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700921', gen_random_uuid(), null, null, (select day_a + interval '10 minutes' from test_marks_70), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700922', gen_random_uuid(), null, null, (select day_a + interval '11 minutes' from test_marks_70),  800, false, false, null);

-- ── Z3 (70003) -- MEZCLA bajo el umbral: crudo (day_b, 3 distintos)
--    impresiones=3 views=2(u1,u2) cta=1(u1) + monthly YA seguro (mes
--    congelado) 50/30/12 -- resultado final SOLO la porcion monthly.
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700931', gen_random_uuid(), '70003', null, (select day_b from test_marks_70), 4000, true,  false, (select day_b from test_marks_70)),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700932', gen_random_uuid(), '70003', null, (select day_b + interval '1 minute' from test_marks_70), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700933', gen_random_uuid(), '70003', null, (select day_b + interval '2 minutes' from test_marks_70),  800, false, false, null);

insert into public.ad_impressions_monthly (agency_id, ad_id, municipality_id, neighborhood_id, year_month, impressions, views, completions, cta_taps) values
  ('00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700301', '70003', null, (select month_frozen::date from test_marks_70), 50, 30, 20, 12);

-- ── ISO -- Z_ISO (70005), AD_70A: crudo (day_b, 3 distintos, BAJO el umbral
--    a nivel de ESTE ad) impresiones=3 views=2(u1,u2) cta=1(u1). AD_70B
--    (hermano, MISMA agencia, MISMA zona '70005', usuarios DISTINTOS) tiene
--    su propio crudo -- si el SUT agregara por AGENCIA en vez de por AD, la
--    suma de ambos (6 usuarios) pasaría el umbral y ESTA zona aparecería
--    como fila propia en ad_stats_zones(AD_70A). Correctamente aislado por
--    ad_id, se queda bajo el umbral y va al bucket de AD_70A (ISO1/ISO2).
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700941', gen_random_uuid(), '70005', null, (select day_b + interval '10 minutes' from test_marks_70), 4000, true,  false, (select day_b + interval '10 minutes' from test_marks_70)),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700942', gen_random_uuid(), '70005', null, (select day_b + interval '11 minutes' from test_marks_70), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700943', gen_random_uuid(), '70005', null, (select day_b + interval '12 minutes' from test_marks_70),  800, false, false, null);

-- AD_70B: MISMA zona '70005', usuarios DISTINTOS (700951-953), impresiones=3
-- views=1(u1) cta=0 -- SOLO existe para contaminar si el SUT agregara mal.
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700302', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700951', gen_random_uuid(), '70005', null, (select day_b + interval '20 minutes' from test_marks_70), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700302', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700952', gen_random_uuid(), '70005', null, (select day_b + interval '21 minutes' from test_marks_70),  800, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700302', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700953', gen_random_uuid(), '70005', null, (select day_b + interval '22 minutes' from test_marks_70),  800, false, false, null);

-- ── Z4 (70004) -- MEZCLA que SÍ pasa su propio k: crudo (day_c, 5
--    distintos) impresiones=5 views=4(u1-u4) cta=1(u1) + monthly YA seguro
--    (mes congelado) 20/15/5 -- se SUMAN limpio: 25/19/6. Última fila EXACTA
--    == rng1_to (frontera RNG1 inclusiva superior).
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700961', gen_random_uuid(), '70004', null, (select day_c from test_marks_70), 4000, true,  false, (select day_c from test_marks_70)),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700962', gen_random_uuid(), '70004', null, (select day_c + interval '1 minute' from test_marks_70), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700963', gen_random_uuid(), '70004', null, (select day_c + interval '2 minutes' from test_marks_70), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700964', gen_random_uuid(), '70004', null, (select day_c + interval '3 minutes' from test_marks_70), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700965', gen_random_uuid(), '70004', null, (select day_c + interval '4 minutes' from test_marks_70),  800, false, false, null);

insert into public.ad_impressions_monthly (agency_id, ad_id, municipality_id, neighborhood_id, year_month, impressions, views, completions, cta_taps) values
  ('00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700301', '70004', null, (select month_frozen::date from test_marks_70), 20, 15, 8, 5);

-- ── day_d -- día de BAJO tráfico (1 SOLO usuario distinto): impresiones=1
--    views=1 cta=0 -- SIN umbral en daily, este día DEBE aparecer completo.
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700971', gen_random_uuid(), null, null, (select day_d from test_marks_70), 4000, true, false, null);

-- ── Z2 (70002) -- HISTÓRICO puro: monthly únicamente (40/22/9) + crudo
--    "stray" del MISMO mes congelado (remanente de purga rezagada, NUNCA
--    debería pasar en producción) -- se IGNORA en TODO: totals, zones Y
--    daily (D-DAILY-ELIGIBLE) -- el resultado final es EXACTAMENTE el valor
--    monthly, nunca 42/23/9 ni un día huérfano en la serie.
insert into public.ad_impressions_monthly (agency_id, ad_id, municipality_id, neighborhood_id, year_month, impressions, views, completions, cta_taps) values
  ('00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700301', '70002', null, (select month_frozen::date from test_marks_70), 40, 22, 15, 9);

insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700981', gen_random_uuid(), '70002', null, (select frozen_day from test_marks_70), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700301', '00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700982', gen_random_uuid(), '70002', null, (select frozen_day + interval '1 minute' from test_marks_70),  800, false, false, null);

-- ── Bucket monthly congelado (NULL,NULL), mes NO elegible: 10/6/2 -- se
--    funde con el bucket del crudo elegible en UNA sola fila.
insert into public.ad_impressions_monthly (agency_id, ad_id, municipality_id, neighborhood_id, year_month, impressions, views, completions, cta_taps) values
  ('00000000-0000-0000-0000-000000700101', '00000000-0000-0000-0000-000000700301', null, null, (select month_frozen::date from test_marks_70), 10, 6, 4, 2);

-- ── AD_70_NOCAP: 5 usuarios distintos en zona '70099', CURRENT mes -- datos
--    REALES sembrados para probar que el gate de capacidad bloquea aunque
--    haya algo que mostrar (si el gate faltara, esta zona SÍ pasaría k>=5).
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700303', '00000000-0000-0000-0000-000000700103', '00000000-0000-0000-0000-000000700991', gen_random_uuid(), '70099', null, (select day_a + interval '30 minutes' from test_marks_70), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700303', '00000000-0000-0000-0000-000000700103', '00000000-0000-0000-0000-000000700992', gen_random_uuid(), '70099', null, (select day_a + interval '31 minutes' from test_marks_70), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700303', '00000000-0000-0000-0000-000000700103', '00000000-0000-0000-0000-000000700993', gen_random_uuid(), '70099', null, (select day_a + interval '32 minutes' from test_marks_70), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700303', '00000000-0000-0000-0000-000000700103', '00000000-0000-0000-0000-000000700994', gen_random_uuid(), '70099', null, (select day_a + interval '33 minutes' from test_marks_70), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000700303', '00000000-0000-0000-0000-000000700103', '00000000-0000-0000-0000-000000700995', gen_random_uuid(), '70099', null, (select day_a + interval '34 minutes' from test_marks_70), 4000, true,  false, null);

-- ── FIXTURE_ANCHOR: protege el archivo de derivar mal sus propios totales
--    si alguien edita las impresiones de arriba -- ancla independiente del
--    SUT (cuenta cruda/monthly, superusuario). AD_70A crudo:
--    Z1(5)+sin_zona(2)+Z3(3)+Z_ISO_A(3)+Z4(5)+day_d(1)+Z2_stray(2)=21.
--    AD_70A monthly: Z1dup+Z3+Z4+bucket+Z2=5. AD_70B crudo: 3. NOCAP crudo: 5.
select is(
  (select count(*)::int from public.ad_impressions where ad_id = '00000000-0000-0000-0000-000000700301'),
  21, 'ANCHOR1_AD_70A_tiene_exactamente_21_impresiones_crudas_sembradas'
);
select is(
  (select count(*)::int from public.ad_impressions_monthly where ad_id = '00000000-0000-0000-0000-000000700301'),
  5, 'ANCHOR2_AD_70A_tiene_exactamente_5_filas_monthly_sembradas_a_mano'
);
select is(
  (select count(*)::int from public.ad_impressions where ad_id = '00000000-0000-0000-0000-000000700302'),
  3, 'ANCHOR3_AD_70B_hermano_tiene_exactamente_3_impresiones_de_contaminacion'
);
select is(
  (select count(*)::int from public.ad_impressions where ad_id = '00000000-0000-0000-0000-000000700303'),
  5, 'ANCHOR4_AD_70_NOCAP_tiene_exactamente_5_impresiones_reales_pese_al_gate'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Catálogo — firma EXACTA, security definer, search_path vacío, grants
--    estáticos, las 3 funciones. Seguro aunque ninguna exista hoy.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_sig_70 (fn text, ok boolean, result_sig text, args_sig text);
do $$
declare
  v_oid oid;
  v_sig text;
begin
  foreach v_sig in array array[
    'public.ad_stats_totals(uuid, timestamptz, timestamptz)',
    'public.ad_stats_daily(uuid, timestamptz, timestamptz)',
    'public.ad_stats_zones(uuid, timestamptz, timestamptz)'
  ]
  loop
    v_oid := to_regprocedure(v_sig);
    if v_oid is null then
      insert into result_sig_70 values (v_sig, false, null, null);
    else
      insert into result_sig_70
      select v_sig, true, pg_get_function_result(v_oid), pg_get_function_arguments(v_oid);
    end if;
  end loop;
end $$;

select is((select ok from result_sig_70 where fn = 'public.ad_stats_totals(uuid, timestamptz, timestamptz)'), true,
  'SIG1_ad_stats_totals_resuelve_por_catalogo_con_la_firma_uuid_timestamptz_timestamptz');
select is((select ok from result_sig_70 where fn = 'public.ad_stats_daily(uuid, timestamptz, timestamptz)'), true,
  'SIG2_ad_stats_daily_resuelve_por_catalogo_con_la_firma_uuid_timestamptz_timestamptz');
select is((select ok from result_sig_70 where fn = 'public.ad_stats_zones(uuid, timestamptz, timestamptz)'), true,
  'SIG3_ad_stats_zones_resuelve_por_catalogo_con_la_firma_uuid_timestamptz_timestamptz');

select is(
  (select result_sig from result_sig_70 where fn = 'public.ad_stats_totals(uuid, timestamptz, timestamptz)'),
  'TABLE(impressions integer, views integer, cta_taps integer)',
  'SIG4_ad_stats_totals_retorno_EXACTO_3_columnas_impressions_views_cta_taps'
);
select is(
  (select result_sig from result_sig_70 where fn = 'public.ad_stats_daily(uuid, timestamptz, timestamptz)'),
  'TABLE(day date, impressions integer, views integer, cta_taps integer)',
  'SIG5_ad_stats_daily_retorno_EXACTO_day_date_mas_3_contadores'
);
select is(
  (select result_sig from result_sig_70 where fn = 'public.ad_stats_zones(uuid, timestamptz, timestamptz)'),
  'TABLE(municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer)',
  'SIG6_ad_stats_zones_retorno_EXACTO_neighborhood_id_bigint_NO_uuid_5_columnas'
);

select is(
  (select args_sig from result_sig_70 where fn = 'public.ad_stats_totals(uuid, timestamptz, timestamptz)'),
  'p_ad_id uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone',
  'SIG7_ad_stats_totals_argumentos_EXACTOS_p_ad_id_obligatorio_p_from_p_to_opcionales'
);

select ok(
  (select bool_and(prosecdef) from pg_proc where proname in ('ad_stats_totals','ad_stats_daily','ad_stats_zones') and pronamespace = 'public'::regnamespace),
  'SIG8_las_3_funciones_existentes_son_security_definer_catalogo_puro'
);
select ok(
  (select bool_and(proconfig = array['search_path=""']::text[]) from pg_proc where proname in ('ad_stats_totals','ad_stats_daily','ad_stats_zones') and pronamespace = 'public'::regnamespace),
  'SIG9_las_3_funciones_existentes_tienen_search_path_vacio_patron_ad_metrics_for_agency'
);

select ok(
  (
    select not bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('ad_stats_totals','ad_stats_daily','ad_stats_zones') and p.pronargs = 3
  ) is true,
  'SIG10_anon_NO_tiene_EXECUTE_estatico_en_ninguna_de_las_3_catalogo_puro'
);
select ok(
  (
    select count(*) = 3
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('ad_stats_totals','ad_stats_daily','ad_stats_zones') and p.pronargs = 3
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) is true,
  'SIG11_authenticated_SI_tiene_EXECUTE_estatico_en_las_3_catalogo_puro'
);

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select * from public.ad_stats_totals('00000000-0000-0000-0000-000000700301'::uuid, null, null) $$,
  '42501', null, 'LEAK1_anon_no_puede_ejecutar_ad_stats_totals_42501'
);
select throws_ok(
  $$ select * from public.ad_stats_daily('00000000-0000-0000-0000-000000700301'::uuid, null, null) $$,
  '42501', null, 'LEAK2_anon_no_puede_ejecutar_ad_stats_daily_42501'
);
select throws_ok(
  $$ select * from public.ad_stats_zones('00000000-0000-0000-0000-000000700301'::uuid, null, null) $$,
  '42501', null, 'LEAK3_anon_no_puede_ejecutar_ad_stats_zones_42501'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Anti-IDOR fail-closed — matriz de 10 escenarios funcionales
--    (impersonación JWT real). TOT_* cubre las 4 causas de rechazo
--    (stranger/sin-capacidad/otra-agencia/ad-inexistente); DAILY_*/ZONES_*
--    re-verifican el subconjunto representativo en las otras 2 RPCs.
-- ════════════════════════════════════════════════════════════════════════════

create temp table idor_calls_70 (
  case_id text primary key,
  fn text not null,
  caller uuid not null,
  ad_id uuid not null
);
grant select on idor_calls_70 to public;
insert into idor_calls_70 values
  ('TOT_STRANGER',   'ad_stats_totals', '00000000-0000-0000-0000-000000700002', '00000000-0000-0000-0000-000000700301'),
  ('TOT_NOCAP',      'ad_stats_totals', '00000000-0000-0000-0000-000000700004', '00000000-0000-0000-0000-000000700303'),
  ('TOT_OTHERAG',    'ad_stats_totals', '00000000-0000-0000-0000-000000700003', '00000000-0000-0000-0000-000000700301'),
  ('TOT_NOADID',     'ad_stats_totals', '00000000-0000-0000-0000-000000700001', '00000000-0000-0000-0000-0000007099ff'),
  ('DAILY_STRANGER', 'ad_stats_daily',  '00000000-0000-0000-0000-000000700002', '00000000-0000-0000-0000-000000700301'),
  ('DAILY_NOCAP',    'ad_stats_daily',  '00000000-0000-0000-0000-000000700004', '00000000-0000-0000-0000-000000700303'),
  ('DAILY_NOADID',   'ad_stats_daily',  '00000000-0000-0000-0000-000000700001', '00000000-0000-0000-0000-0000007099ff'),
  ('ZONES_STRANGER', 'ad_stats_zones',  '00000000-0000-0000-0000-000000700002', '00000000-0000-0000-0000-000000700301'),
  ('ZONES_OTHERAG',  'ad_stats_zones',  '00000000-0000-0000-0000-000000700003', '00000000-0000-0000-0000-000000700301'),
  ('ZONES_NOADID',   'ad_stats_zones',  '00000000-0000-0000-0000-000000700001', '00000000-0000-0000-0000-0000007099ff');

create temp table idor_results_70 (case_id text, ok boolean, err_sqlstate text, row_count integer);
grant all on idor_results_70 to public;
do $$
declare
  r record;
  res record;
begin
  for r in select * from idor_calls_70 loop
    perform pg_temp.act_as(r.caller, 'authenticated');
    select * into res from pg_temp.call_stats_count(r.fn, r.ad_id, null, null);
    insert into idor_results_70 values (r.case_id, res.ok, res.err_sqlstate, res.row_count);
    execute 'reset role';
  end loop;
end $$;

select is((select ok from idor_results_70 where case_id = 'TOT_STRANGER'), true, 'IDOR_TOT_STRANGER_ok_sin_membresia_no_lanza_excepcion');
select is((select row_count from idor_results_70 where case_id = 'TOT_STRANGER'), 0, 'IDOR_TOT_STRANGER_0_filas_sin_membresia_en_la_agencia_dueña_del_ad');
select is((select ok from idor_results_70 where case_id = 'TOT_NOCAP'), true, 'IDOR_TOT_NOCAP_ok_organizacion_sin_can_advertise_no_lanza_excepcion');
select is((select row_count from idor_results_70 where case_id = 'TOT_NOCAP'), 0, 'IDOR_TOT_NOCAP_0_filas_pese_a_datos_reales_sembrados_el_gate_de_capacidad_bloquea');
select is((select ok from idor_results_70 where case_id = 'TOT_OTHERAG'), true, 'IDOR_TOT_OTHERAG_ok_owner_de_otra_agencia_no_lanza_excepcion');
select is((select row_count from idor_results_70 where case_id = 'TOT_OTHERAG'), 0, 'IDOR_TOT_OTHERAG_0_filas_owner_legitimo_con_can_advertise_pero_de_OTRA_agencia_no_ve_nada');
select is((select ok from idor_results_70 where case_id = 'TOT_NOADID'), true, 'IDOR_TOT_NOADID_ok_ad_inexistente_no_lanza_excepcion');
select is((select row_count from idor_results_70 where case_id = 'TOT_NOADID'), 0, 'IDOR_TOT_NOADID_0_filas_p_ad_id_que_no_existe_en_absoluto');

select is((select ok from idor_results_70 where case_id = 'DAILY_STRANGER'), true, 'IDOR_DAILY_STRANGER_ok_sin_membresia_no_lanza_excepcion');
select is((select row_count from idor_results_70 where case_id = 'DAILY_STRANGER'), 0, 'IDOR_DAILY_STRANGER_0_filas_sin_membresia');
select is((select ok from idor_results_70 where case_id = 'DAILY_NOCAP'), true, 'IDOR_DAILY_NOCAP_ok_sin_can_advertise_no_lanza_excepcion');
select is((select row_count from idor_results_70 where case_id = 'DAILY_NOCAP'), 0, 'IDOR_DAILY_NOCAP_0_filas_pese_a_datos_reales');
select is((select ok from idor_results_70 where case_id = 'DAILY_NOADID'), true, 'IDOR_DAILY_NOADID_ok_ad_inexistente_no_lanza_excepcion');
select is((select row_count from idor_results_70 where case_id = 'DAILY_NOADID'), 0, 'IDOR_DAILY_NOADID_0_filas_ad_inexistente');

select is((select ok from idor_results_70 where case_id = 'ZONES_STRANGER'), true, 'IDOR_ZONES_STRANGER_ok_sin_membresia_no_lanza_excepcion');
select is((select row_count from idor_results_70 where case_id = 'ZONES_STRANGER'), 0, 'IDOR_ZONES_STRANGER_0_filas_sin_membresia');
select is((select ok from idor_results_70 where case_id = 'ZONES_OTHERAG'), true, 'IDOR_ZONES_OTHERAG_ok_owner_de_otra_agencia_no_lanza_excepcion');
select is((select row_count from idor_results_70 where case_id = 'ZONES_OTHERAG'), 0, 'IDOR_ZONES_OTHERAG_0_filas_owner_de_OTRA_agencia_no_ve_zonas_ajenas');
select is((select ok from idor_results_70 where case_id = 'ZONES_NOADID'), true, 'IDOR_ZONES_NOADID_ok_ad_inexistente_no_lanza_excepcion');
select is((select row_count from idor_results_70 where case_id = 'ZONES_NOADID'), 0, 'IDOR_ZONES_NOADID_0_filas_ad_inexistente');

-- ════════════════════════════════════════════════════════════════════════════
-- 3) ad_stats_totals — happy path OWNER_70, dos fuentes sin doblar, rango
--    inclusivo en ambos extremos, mes congelado.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_tot_norange (ok boolean, err_sqlstate text);
create temp table result_tot_norange_rows (impressions integer, views integer, cta_taps integer);
grant all on result_tot_norange, result_tot_norange_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000700001', 'authenticated'); -- OWNER_70
do $$
begin
  insert into result_tot_norange_rows
  select * from public.ad_stats_totals('00000000-0000-0000-0000-000000700301'::uuid, null, null);
  insert into result_tot_norange values (true, null);
exception when others then
  insert into result_tot_norange values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_tot_norange), true, 'TOT1_ok_llamada_sin_rango_no_lanza_excepcion');
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text from result_tot_norange_rows),
  '139:86:33',
  'TOT2_NORANGE_totales_exactos_18_crudo_mas_1_sin_zona_extra_mas_120_monthly_congelado_139_86_33'
);

create temp table result_tot_rng1 (ok boolean, err_sqlstate text);
create temp table result_tot_rng1_rows (impressions integer, views integer, cta_taps integer);
grant all on result_tot_rng1, result_tot_rng1_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000700001', 'authenticated');
do $$
begin
  insert into result_tot_rng1_rows
  select * from public.ad_stats_totals(
    '00000000-0000-0000-0000-000000700301'::uuid,
    (select rng1_from from test_marks_70),
    (select rng1_to   from test_marks_70)
  );
  insert into result_tot_rng1 values (true, null);
exception when others then
  insert into result_tot_rng1 values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_tot_rng1), true, 'TOT3_RNG1_ok_rango_explicito_no_lanza_excepcion');
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text from result_tot_rng1_rows),
  '18:12:5',
  'TOT4_RNG1_frontera_INCLUSIVA_en_ambos_extremos_incluye_la_primera_fila_de_Z1_y_la_ultima_de_Z4_excluye_day_d_y_lo_congelado'
);

create temp table result_tot_frozen (ok boolean, err_sqlstate text);
create temp table result_tot_frozen_rows (impressions integer, views integer, cta_taps integer);
grant all on result_tot_frozen, result_tot_frozen_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000700001', 'authenticated');
do $$
begin
  insert into result_tot_frozen_rows
  select * from public.ad_stats_totals(
    '00000000-0000-0000-0000-000000700301'::uuid,
    (select rng_frozen_from from test_marks_70),
    (select rng_frozen_to   from test_marks_70)
  );
  insert into result_tot_frozen values (true, null);
exception when others then
  insert into result_tot_frozen values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_tot_frozen), true, 'TOT5_RNG_FROZEN_ok_no_lanza_excepcion');
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text from result_tot_frozen_rows),
  '120:73:28',
  'TOT6_RNG_FROZEN_SOLO_monthly_40_mas_50_mas_20_mas_10_igual_120_el_crudo_stray_del_mismo_mes_se_ignora'
);

-- ISO3: AD_70B (hermano) tiene SU PROPIA cifra, nunca contaminada por AD_70A
-- ni viceversa -- mata el mutante "filtra solo por agencia, ignora ad_id".
create temp table result_tot_adb (ok boolean, err_sqlstate text);
create temp table result_tot_adb_rows (impressions integer, views integer, cta_taps integer);
grant all on result_tot_adb, result_tot_adb_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000700001', 'authenticated');
do $$
begin
  insert into result_tot_adb_rows
  select * from public.ad_stats_totals('00000000-0000-0000-0000-000000700302'::uuid, null, null);
  insert into result_tot_adb values (true, null);
exception when others then
  insert into result_tot_adb values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_tot_adb), true, 'ISO3a_ad_stats_totals_de_AD_70B_ok_no_lanza_excepcion');
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text from result_tot_adb_rows),
  '3:1:0',
  'ISO3b_AD_70B_reporta_SOLO_sus_propias_3_impresiones_nunca_las_139_de_AD_70A'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) ad_stats_daily — solo crudo, sin umbral, orden ascendente, asimetría
--    dura contra el mes congelado (D-DAILY-ELIGIBLE).
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_daily_norange (ok boolean, err_sqlstate text);
create temp table result_daily_norange_rows (rn bigserial, day date, impressions integer, views integer, cta_taps integer);
grant all on result_daily_norange, result_daily_norange_rows to public;
-- GRANT ALL ON TABLE no cubre la secuencia implícita del bigserial (gotcha
-- encontrado en el GREEN: 42501 al insertar bajo el rol impersonado).
grant usage, select on sequence result_daily_norange_rows_rn_seq to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000700001', 'authenticated');
do $$
begin
  insert into result_daily_norange_rows (day, impressions, views, cta_taps)
  select * from public.ad_stats_daily('00000000-0000-0000-0000-000000700301'::uuid, null, null);
  insert into result_daily_norange values (true, null);
exception when others then
  insert into result_daily_norange values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_daily_norange), true, 'DAILY1_ok_llamada_sin_rango_no_lanza_excepcion');
select is((select count(*)::int from result_daily_norange_rows), 4,
  'DAILY2_rowcount_4_UNA_fila_por_dia_CON_actividad_day_a_b_c_d_sin_relleno_de_ceros');
select is(
  (select array_agg(day order by rn) from result_daily_norange_rows),
  (select array_agg(day order by day) from result_daily_norange_rows),
  'DAILY3_ORDEN_dia_ascendente_verificado_contra_el_orden_real_de_insercion_de_la_RPC'
);
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text
     from result_daily_norange_rows where day = (select day_a::date from test_marks_70)),
  '7:4:2', 'DAILY4_day_a_Z1_5_mas_sin_zona_2_igual_7_4_2'
);
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text
     from result_daily_norange_rows where day = (select day_b::date from test_marks_70)),
  '6:4:2', 'DAILY5_day_b_Z3_3_mas_Z_ISO_A_3_igual_6_4_2'
);
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text
     from result_daily_norange_rows where day = (select day_c::date from test_marks_70)),
  '5:4:1', 'DAILY6_day_c_Z4_5_4_1'
);
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text
     from result_daily_norange_rows where day = (select day_d::date from test_marks_70)),
  '1:1:0', 'DAILY7_day_d_UN_SOLO_usuario_SIN_umbral_igual_aparece_completo_1_1_0'
);
select is(
  (select count(*)::int from result_daily_norange_rows where day = (select frozen_day::date from test_marks_70)),
  0, 'DAILY8_D_DAILY_ELIGIBLE_el_dia_del_crudo_stray_en_el_mes_YA_congelado_NUNCA_aparece'
);

create temp table result_daily_rng1 (ok boolean, err_sqlstate text);
create temp table result_daily_rng1_rows (day date, impressions integer, views integer, cta_taps integer);
grant all on result_daily_rng1, result_daily_rng1_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000700001', 'authenticated');
do $$
begin
  insert into result_daily_rng1_rows
  select * from public.ad_stats_daily(
    '00000000-0000-0000-0000-000000700301'::uuid,
    (select rng1_from from test_marks_70),
    (select rng1_to   from test_marks_70)
  );
  insert into result_daily_rng1 values (true, null);
exception when others then
  insert into result_daily_rng1 values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_daily_rng1), true, 'DAILY9_RNG1_ok_no_lanza_excepcion');
select is((select count(*)::int from result_daily_rng1_rows), 3,
  'DAILY10_RNG1_rowcount_3_dias_a_b_c_day_d_queda_fuera_por_la_frontera_superior');
select is(
  (select sum(impressions)::text || ':' || sum(views)::text || ':' || sum(cta_taps)::text from result_daily_rng1_rows),
  '18:12:5', 'DAILY11_RNG1_suma_18_12_5_igual_al_subconjunto_de_crudo_del_rango'
);

create temp table result_daily_frozen (ok boolean, err_sqlstate text);
create temp table result_daily_frozen_rows (day date, impressions integer, views integer, cta_taps integer);
grant all on result_daily_frozen, result_daily_frozen_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000700001', 'authenticated');
do $$
begin
  insert into result_daily_frozen_rows
  select * from public.ad_stats_daily(
    '00000000-0000-0000-0000-000000700301'::uuid,
    (select rng_frozen_from from test_marks_70),
    (select rng_frozen_to   from test_marks_70)
  );
  insert into result_daily_frozen values (true, null);
exception when others then
  insert into result_daily_frozen values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_daily_frozen), true, 'DAILY12_RNG_FROZEN_ok_no_lanza_excepcion');
select is((select count(*)::int from result_daily_frozen_rows), 0,
  'DAILY13_ASIMETRIA_DURA_0_FILAS_en_daily_pese_a_que_ese_mismo_rango_SI_tiene_datos_en_totals_via_monthly');

-- ════════════════════════════════════════════════════════════════════════════
-- 5) ad_stats_zones — k>=5 POR (ad_id, zona), bucket funde 3 orígenes,
--    D-MEZCLA, DEDUPE, aislamiento del ad hermano.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_zones_norange (ok boolean, err_sqlstate text);
create temp table result_zones_norange_rows (municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer);
grant all on result_zones_norange, result_zones_norange_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000700001', 'authenticated');
do $$
begin
  insert into result_zones_norange_rows
  select * from public.ad_stats_zones('00000000-0000-0000-0000-000000700301'::uuid, null, null);
  insert into result_zones_norange values (true, null);
exception when others then
  insert into result_zones_norange values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_zones_norange), true, 'ZONES1_ok_llamada_sin_rango_no_lanza_excepcion');
select is((select count(*)::int from result_zones_norange_rows), 5,
  'ZONES2_rowcount_5_Z1_Z2_Z3_Z4_mas_UN_bucket');
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text from result_zones_norange_rows where municipality_id = '70001'),
  '5:3:2', 'ZONES3_Z1_mes_elegible_ignora_monthly_duplicado_999_resultado_EXACTAMENTE_el_crudo'
);
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text from result_zones_norange_rows where municipality_id = '70002'),
  '40:22:9', 'ZONES4_Z2_historico_ignora_el_crudo_stray_resultado_EXACTAMENTE_el_valor_monthly'
);
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text from result_zones_norange_rows where municipality_id = '70003'),
  '50:30:12', 'ZONES5_Z3_D_MEZCLA_zona_final_es_SOLO_la_porcion_monthly_el_crudo_bajo_el_umbral_NO_se_suma'
);
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text from result_zones_norange_rows where municipality_id = '70004'),
  '25:19:6', 'ZONES6_Z4_D_MEZCLA_crudo_que_SI_pasa_su_propio_k_se_SUMA_limpio_con_monthly_5_mas_20_25'
);
select is(
  (select count(*)::int from result_zones_norange_rows where municipality_id = '70005'),
  0, 'ZONES7_ISO1_zona_70005_AUSENTE_como_fila_propia_bajo_el_umbral_a_nivel_de_ESTE_ad_pese_al_ad_hermano'
);
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text from result_zones_norange_rows where municipality_id is null and neighborhood_id is null),
  '19:12:4', 'ZONES8_BUCKET_funde_sin_zona_2_mas_Z3_crudo_3_mas_Z_ISO_A_crudo_3_mas_day_d_1_mas_monthly_congelado_10_igual_19'
);
select is(
  (select count(*)::int from result_zones_norange_rows),
  (select count(distinct (municipality_id, neighborhood_id))::int from result_zones_norange_rows),
  'ZONES9_DEDUPE_ninguna_llave_municipality_neighborhood_se_repite_en_la_salida'
);

create temp table result_zones_rng1 (ok boolean, err_sqlstate text);
create temp table result_zones_rng1_rows (municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer);
grant all on result_zones_rng1, result_zones_rng1_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000700001', 'authenticated');
do $$
begin
  insert into result_zones_rng1_rows
  select * from public.ad_stats_zones(
    '00000000-0000-0000-0000-000000700301'::uuid,
    (select rng1_from from test_marks_70),
    (select rng1_to   from test_marks_70)
  );
  insert into result_zones_rng1 values (true, null);
exception when others then
  insert into result_zones_rng1 values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_zones_rng1), true, 'ZONES10_RNG1_ok_no_lanza_excepcion');
select is((select count(*)::int from result_zones_rng1_rows), 3,
  'ZONES11_RNG1_rowcount_3_Z1_Z4_y_UN_bucket_Z2_Z3_sin_su_monthly_en_rango_desaparecen');
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text from result_zones_rng1_rows where municipality_id = '70001'),
  '5:3:2', 'ZONES12_RNG1_Z1_estable_bajo_el_rango'
);
select is(
  (select count(*)::int from result_zones_rng1_rows where municipality_id = '70003'),
  0, 'ZONES13_RNG1_Z3_AUSENTE_su_unica_fuente_confiable_era_monthly_y_el_mes_congelado_no_traslapa_el_rango'
);
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text from result_zones_rng1_rows where municipality_id = '70004'),
  '5:4:1', 'ZONES14_RNG1_Z4_SOLO_crudo_5_4_1_prueba_que_el_crudo_evalua_su_PROPIO_k_independiente_de_monthly'
);
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text from result_zones_rng1_rows where municipality_id is null and neighborhood_id is null),
  '8:5:2', 'ZONES15_RNG1_bucket_sin_zona_2_mas_Z3_crudo_3_mas_Z_ISO_A_crudo_3_igual_8_5_2_sin_monthly_en_rango'
);

create temp table result_zones_frozen (ok boolean, err_sqlstate text);
create temp table result_zones_frozen_rows (municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer);
grant all on result_zones_frozen, result_zones_frozen_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000700001', 'authenticated');
do $$
begin
  insert into result_zones_frozen_rows
  select * from public.ad_stats_zones(
    '00000000-0000-0000-0000-000000700301'::uuid,
    (select rng_frozen_from from test_marks_70),
    (select rng_frozen_to   from test_marks_70)
  );
  insert into result_zones_frozen values (true, null);
exception when others then
  insert into result_zones_frozen values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_zones_frozen), true, 'ZONES16_RNG_FROZEN_ok_no_lanza_excepcion');
select is((select count(*)::int from result_zones_frozen_rows), 4,
  'ZONES17_RNG_FROZEN_rowcount_4_Z2_Z3_Z4_y_bucket_TODO_monthly_ni_una_fila_de_crudo');
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text from result_zones_frozen_rows where municipality_id = '70003'),
  '50:30:12', 'ZONES18_RNG_FROZEN_Z3_SOLO_monthly_ni_siquiera_el_crudo_que_pasaria_su_propio_k_esta_fuera_del_mes'
);
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text from result_zones_frozen_rows where municipality_id is null and neighborhood_id is null),
  '10:6:2', 'ZONES19_RNG_FROZEN_bucket_SOLO_el_bucket_monthly_congelado_cero_crudo'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Coherencia cruzada entre las 3 RPCs — mismo fixture, misma llamada.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select sum(impressions)::text || ':' || sum(views)::text || ':' || sum(cta_taps)::text from result_zones_norange_rows),
  (select impressions::text || ':' || views::text || ':' || cta_taps::text from result_tot_norange_rows),
  'COHER1_totals_NORANGE_139_86_33_igual_a_la_suma_de_TODAS_las_filas_de_zones_NORANGE'
);
select is(
  (
    select (sum(d.impressions) + f.impressions)::text || ':' || (sum(d.views) + f.views)::text || ':' || (sum(d.cta_taps) + f.cta_taps)::text
    from result_daily_norange_rows d, result_tot_frozen_rows f
    group by f.impressions, f.views, f.cta_taps
  ),
  (select impressions::text || ':' || views::text || ':' || cta_taps::text from result_tot_norange_rows),
  'COHER2_totals_NORANGE_139_86_33_igual_a_la_serie_diaria_19_13_5_MAS_el_historico_congelado_120_73_28'
);
select is(
  (select sum(impressions)::text || ':' || sum(views)::text || ':' || sum(cta_taps)::text from result_zones_rng1_rows),
  (select impressions::text || ':' || views::text || ':' || cta_taps::text from result_tot_rng1_rows),
  'COHER3_totals_RNG1_18_12_5_igual_a_la_suma_de_TODAS_las_filas_de_zones_RNG1'
);
select is(
  (select sum(impressions)::text || ':' || sum(views)::text || ':' || sum(cta_taps)::text from result_daily_rng1_rows),
  (select impressions::text || ':' || views::text || ':' || cta_taps::text from result_tot_rng1_rows),
  'COHER4_totals_RNG1_18_12_5_igual_a_la_suma_de_la_serie_diaria_RNG1_sin_aporte_monthly_en_ese_rango'
);

select * from finish();
rollback;
