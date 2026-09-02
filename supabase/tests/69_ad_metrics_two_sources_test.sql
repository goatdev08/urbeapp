-- Tests pgTAP — public.ad_metrics_for_agency lee AMBAS fuentes (subtarea
-- #201.2, tarea 201). Ejecutar con:
--   supabase test db supabase/tests/69_ad_metrics_two_sources_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de
-- una transacción revertida (no persiste). Impersonamos con
-- pg_temp.act_as(uid, role) (mismo patrón que 02/16/25/37/43/44/46/47/48/51/
-- 52/53/62/63/64/68_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba: el contrato PÚBLICO YA EXISTENTE de
-- public.ad_metrics_for_agency(p_agency_id uuid, p_from timestamptz,
-- p_to timestamptz) — MISMA firma que 20260821000001/62_*, el GREEN de esta
-- subtarea NO puede cambiarla (builds instalados la llaman). Lo que cambia es
-- el CUERPO: hoy agrega SOLO ad_impressions (crudo); debe agregar TAMBIÉN
-- ad_impressions_monthly (rollup permanente, 201.1) para los meses que el
-- crudo ya perdió, SIN doble contar los que ambas tablas todavía comparten.
-- Este archivo NO repite el contrato de firma/autorización/k-anonimato de
-- una sola fuente (ya cubierto exhaustivamente por 62_ad_metrics_for_agency_
-- test.sql, 55 asserts, que queda como regresión intacta) — se enfoca
-- EXCLUSIVAMENTE en el comportamiento de MEZCLA de las dos fuentes.
--
-- ── Regla de frontera (contrato del orquestador, tarea 201.2) ──────────────
-- Un mes es ELEGIBLE si su inicio (date_trunc('month', shown_at) para el
-- crudo / year_month para monthly) es >= now() - 90 días — LA MISMA
-- constante (90) que usa purge_ad_impressions Y
-- rollup_ad_impressions_monthly (20260817000002 / 20260823000004). El crudo
-- aporta SOLO meses elegibles; monthly aporta SOLO meses NO elegibles. Un
-- mes elegible puede tener YA una fila en monthly (el job diario corre a las
-- 8:00 UTC y recalcula TODOS los meses elegibles, incluido el actual) — esa
-- fila se IGNORA por completo, nunca se lee, para no doblar lo que el crudo
-- ya cuenta completo (FRONT1/Z1). Simétricamente, un remanente de crudo que
-- por lo que sea sobreviva para un mes YA NO elegible (purga rezagada) se
-- IGNORA también — ya está congelado en monthly y sumarlo doblaría esa
-- fracción (FRONT2/Z2 con crudo "stray").
--
-- ── 🔴 D-MEZCLA (decisión de contrato de este RED, exigida por el
--    orquestador — "decide y fija el contrato") — k-anonimato al MEZCLAR ──
-- monthly NO guarda user_id: es IMPOSIBLE re-derivar el umbral k>=5 sobre
-- sus filas — inventar esa garantía sería mentir. La única fuente de verdad
-- posible es que monthly YA se anonimizó AL AGREGAR (201.1, misma semántica
-- count(distinct user_id)>=5 de esta RPC) — sus filas de zona real son
-- SIEMPRE de fiar y se muestran tal cual, sin re-evaluar nada.
-- El crudo, en cambio, SÍ tiene user_id — sigue evaluando su PROPIO
-- k(>=5 usuarios distintos) exactamente como hoy (sin cambios), de forma
-- INDEPENDIENTE de si esa misma zona tiene o no una fila en monthly.
-- Se ADOPTA la primera opción que planteó el orquestador (la que no permite
-- una fuga por diferencia): "la parte del crudo bajo el umbral va al
-- bucket, la parte monthly (ya anonimizada al agregar) puede mostrarse como
-- zona". Consecuencia observable: si una zona tiene AMBOS orígenes, la fila
-- de zona final = SOLO la porción monthly (ya segura) — el aporte del crudo
-- bajo el umbral se funde en el bucket (NULL,NULL), NUNCA se suma a la fila
-- de zona (Z3/MEZCLA1-3). Si el crudo de esa misma zona SÍ pasa su propio
-- k>=5, se SUMA normal con la porción monthly (Z4/MEZCLA4-5) — no hay
-- conflicto de privacidad porque ambas porciones ya son, cada una por su
-- cuenta, seguras de mostrar. Razón de fondo (anti-differencing): si se
-- sumara SIEMPRE (monthly seguro + crudo bajo el umbral), un lector con
-- memoria del valor congelado de monthly podría restar "lo que ya sabía"
-- del total nuevo y aislar el aporte de un puñado de personas del mes en
-- curso — exactamente la re-identificación que el k-anonimato existe para
-- impedir. Fundir en el bucket en vez de perder el dato preserva la
-- conservación de totales (dinero, #172) sin abrir esa rendija.
--
-- ── D-RANGO-MONTHLY (decisión de contrato de este RED) — p_from/p_to sobre
--    filas que solo tienen year_month (granularidad de mes, no de día) ────
-- Una fila monthly con year_month=M representa el intervalo calendario
-- [M, M + 1 mes). Se incluye si y solo si ese intervalo SE TRASLAPA con
-- [p_from, p_to] (frontera inclusiva en ambos extremos, igual que el
-- filtro ya existente sobre shown_at): (p_from IS NULL OR M + 1 mes > p_from)
-- AND (p_to IS NULL OR M <= p_to). Sin rango (p_from=p_to=NULL), TODOS los
-- meses no-elegibles calan. La elegibilidad crudo-vs-monthly (arriba) es
-- INCONDICIONAL — nunca depende del rango: un mes elegible jamás lee
-- monthly y un mes no-elegible jamás lee crudo, sea cual sea p_from/p_to
-- (RNG_FROZEN/RNG_CURRENT).
--
-- ── Estrategia RED ───────────────────────────────────────────────────────
-- A diferencia de 62/68 (SUT que no existía), public.ad_metrics_for_agency
-- YA EXISTE (20260821000001) — ninguna llamada de este archivo puede lanzar
-- 42883. El RED falla por ASERCIÓN pura: el cuerpo vigente ignora
-- ad_impressions_monthly por completo, así que toda fila cuyo origen sea
-- monthly (Z2, la porción monthly de Z3/Z4, el bucket congelado) sale hoy
-- en NULL/ausente en vez del valor esperado. Se mantiene el patrón
-- `do $$ ... exception when others then ... $$` por consistencia y defensa
-- (mismo patrón que 62_*), aunque hoy no se espera que dispare la rama
-- exception.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ────────────────
-- FRONT1 (Z1): mes ELEGIBLE con fila monthly duplicada (999/999/999) — se
--   IGNORA, el resultado es EXACTAMENTE el crudo (5/3/2), nunca la suma.
-- FRONT2 (Z2): mes NO elegible con crudo "stray" (remanente que no debería
--   existir, purga rezagada) — se IGNORA, el resultado es EXACTAMENTE el
--   valor consolidado de monthly (40/22/9), nunca 42/23/9.
-- HIST1 (Z2): mes puramente histórico (monthly únicamente, sin ningún
--   crudo legítimo) SÍ aparece en la salida con sus cifras exactas.
-- TOTAL1: la suma de TODAS las filas devueltas == aritmética a mano
--   (crudo elegible incluido + monthly congelado incluido, excluyendo lo
--   ignorado por FRONT1/FRONT2) — conservación de totales (dinero, #172).
-- MEZCLA1-3 (Z3, D-MEZCLA): zona con crudo bajo el umbral (3 usuarios) Y
--   monthly ya seguro (50/30/12) en el mismo agregado sin rango — la fila
--   de zona final es SOLO el valor monthly; el aporte del crudo se funde
--   en el bucket, no se pierde y no se suma a la zona.
-- MEZCLA4-5 (Z4): zona con crudo que SÍ pasa su propio k (5 usuarios) Y
--   monthly ya seguro — se SUMAN limpio (25/19/6).
-- BUCKET1: la fila (NULL,NULL) es UNA SOLA (nunca dos), funde: impresiones
--   sin zona del crudo + la porción de Z3 redirigida por MEZCLA + el
--   bucket ya congelado de monthly.
-- DEDUPE1: ninguna llave (municipality_id, neighborhood_id) se repite en la
--   salida — el gotcha "same key" de FlatList ya pagado en este repo
--   (EDGE12b de 62_*), ahora también entre fuentes.
-- RNG_SPAN (5a): p_from/p_to EXPLÍCITOS que abarcan el mes congelado Y el
--   mes elegible siguen dando la MISMA aritmética que sin rango — el rango
--   en sí no rompe la mezcla.
-- RNG_FROZEN (5b): rango angosto DENTRO del mes congelado — el crudo
--   elegible (Z1/Z3/Z4/sin-zona) queda fuera por construcción (su shown_at
--   no cae ahí), solo sobrevive lo que monthly aporta para ESE mes; Z3
--   sigue mostrando SOLO su valor monthly (50/30/12), nunca contaminado.
-- RNG_CURRENT (5c): rango angosto DENTRO del mes elegible — monthly queda
--   fuera por construcción (D-RANGO-MONTHLY, el mes congelado no se
--   traslapa), Z3 se redirige a bucket igual que sin rango (D-MEZCLA no
--   depende de que exista o no una contraparte monthly EN RANGO).
-- IDOR1 (regresión barata): un `authenticated` sin relación con la agencia
--   sigue recibiendo 0 filas, nunca una excepción, con datos reales
--   sembrados en AMBAS fuentes — el anti-IDOR de 62_* no se rompe al leer
--   una segunda tabla.
--
-- ── #216 (hardening, origen: guardian de 201.2) — 12 asserts añadidos ──────
-- El fixture original (agencia 690101) NO tenía ningún mes de FRONTERA (el
-- que contiene el corte de 90 días) ni ningún rango con extremos INTERIORES
-- a un mes, así que 3 de 7 mutaciones del guardian SOBREVIVÍAN al RED aunque
-- el GREEN fuera correcto. Estos casos viven en una SEGUNDA agencia (690102),
-- con su propio fixture, para no alterar ni un solo assert de los 27
-- originales (todos filtran por 690101 y su aritmética queda intacta).
-- BND1-3 (mata "frontera por FILA en vez de por MES"): mes de frontera con
--   crudo remanente cuyo shown_at cae DESPUÉS del corte (a mitad de camino
--   entre el corte y el fin de mes) + fila monthly del MISMO mes. La regla
--   correcta (mes) ignora ese crudo por completo y devuelve el valor
--   monthly puro; una frontera por fila lo dejaría pasar y lo SUMARÍA a la
--   fila monthly del mismo mes -- doble conteo.
-- RNG_INNER1-4 (mata "year_month tratado como PUNTO" y "sin filtro p_to en
--   monthly"): rango [mes congelado + 14 días, mes congelado + 20 días], con
--   AMBOS extremos interiores al mes. La regla correcta (traslape del
--   intervalo [M, M+1mes)) SÍ incluye ese mes pese a que p_from es posterior
--   a su inicio -- una comparación de punto (year_month >= p_from) lo
--   excluiría. Y el mes de frontera, POSTERIOR a p_to, debe quedar fuera --
--   quitar el filtro p_to lo colaría.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(39);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) Fixtures — self-contained, prefijo '690XXX' (fuera del rango de otros
--    archivos: 51='510XXX', 62='620XXX', 63='630XXX', 68='680XXX'). Fechas
--    RELATIVAS a now() (lección de 201.1/68) — month_current es el mes EN
--    CURSO (SIEMPRE elegible), month_frozen1 está 10 meses atrás (~300
--    días, margen amplio y deliberado frente a los 90 días, evita la
--    fragilidad de fin-de-mes que atrapó al guardián en 201.1). municipality_id
--    es TEXT SIN FK (20260817000002 / ad_impressions_monthly) — no hace
--    falta geo real (mx_states/municipalities/neighborhoods).
-- ════════════════════════════════════════════════════════════════════════════

create temp table test_months_69 as
select
  date_trunc('month', now())::date                                    as month_current,
  date_trunc('month', now()) + interval '5 days 8 hours'               as month_current_ts,
  (date_trunc('month', now()) - interval '10 months')::date            as month_frozen1,
  date_trunc('month', now()) - interval '10 months' + interval '5 days 8 hours' as month_frozen1_ts,
  date_trunc('month', now())                                           as rng_current_from,
  date_trunc('month', now()) + interval '20 days'                      as rng_current_to,
  date_trunc('month', now()) - interval '10 months'                    as rng_frozen_from,
  date_trunc('month', now()) - interval '10 months' + interval '5 days' as rng_frozen_to,
  -- ── #216 — mes de FRONTERA real (el que le faltaba al fixture) ──────────
  -- bnd_month es el mes que CONTIENE el corte de retención (now() - 90 días):
  -- su INICIO está fuera de la ventana (mes NO elegible) pero parte de sus
  -- DÍAS están dentro. Es el único mes donde "frontera por fila" y "frontera
  -- por mes" difieren, y por eso el único que puede matar esa mutación.
  date_trunc('month', now() - interval '90 days')::date                as bnd_month,
  -- Punto medio entre el corte y el fin del mes de frontera: SIEMPRE
  -- estrictamente > corte y estrictamente < fin de mes, sin importar en qué
  -- día del mes caiga el corte (robusto a fin de mes, lección de 201.1).
  (now() - interval '90 days')
    + ((date_trunc('month', now() - interval '90 days') + interval '1 month')
       - (now() - interval '90 days')) / 2                             as bnd_stray_ts,
  -- Extremos INTERIORES al mes congelado (día 15 y día 21): ni p_from ni
  -- p_to coinciden con el inicio del mes -- lo que el fixture original nunca
  -- ejercitó (rng_frozen_from caía exacto en el inicio de mes).
  date_trunc('month', now()) - interval '10 months' + interval '14 days' as rng_inner_from,
  date_trunc('month', now()) - interval '10 months' + interval '20 days' as rng_inner_to;
grant select on test_months_69 to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000690001', 'owner_69@urbea.mx'),
  ('00000000-0000-0000-0000-000000690002', 'stranger_69@urbea.mx'),
  -- Owner PROPIO de la agencia de frontera (#216): agency_members_one_active_per_user
  -- impide que 690001 sea miembro activo de dos agencias a la vez.
  ('00000000-0000-0000-0000-000000690003', 'owner_frontera_69@urbea.mx');

insert into public.agencies (id, name, slug, status, can_advertise, advertiser_category, created_by_user_id) values
  ('00000000-0000-0000-0000-000000690101', 'Agencia Mezcla 69', 'agencia-mezcla-69',
   'active', true, 'otro', '00000000-0000-0000-0000-000000690001');

insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690001', 'owner', 'active');
-- STRANGER (690002) NO tiene fila en agency_members -- IDOR1.

insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000690201', '00000000-0000-0000-0000-000000690101', 'ready');

insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000690301', '00000000-0000-0000-0000-000000690101',
   '00000000-0000-0000-0000-000000690201', 'Ad Mezcla 69', 'phone', '+5213300006901',
   'active', '2025-12-01'::timestamptz, '2026-12-01'::timestamptz);

-- ── Z1 (69001) -- FRONT1: mes ELEGIBLE con fila monthly YA escrita
--    (simula que el job de las 8:00 UTC ya corrió hoy) -- debe IGNORARSE.
--    Crudo: 5 usuarios distintos -> impresiones=5 views=3(u1,u2,u4) cta=2(u1,u5).
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690301', '00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690911', gen_random_uuid(), '69001', null, (select month_current_ts from test_months_69), 4000, true,  false, (select month_current_ts from test_months_69)),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690301', '00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690912', gen_random_uuid(), '69001', null, (select month_current_ts + interval '1 minute' from test_months_69), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690301', '00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690913', gen_random_uuid(), '69001', null, (select month_current_ts + interval '2 minutes' from test_months_69),  800, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690301', '00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690914', gen_random_uuid(), '69001', null, (select month_current_ts + interval '3 minutes' from test_months_69), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690301', '00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690915', gen_random_uuid(), '69001', null, (select month_current_ts + interval '4 minutes' from test_months_69),  800, false, false, (select month_current_ts + interval '4 minutes 30 seconds' from test_months_69));

insert into public.ad_impressions_monthly (agency_id, ad_id, municipality_id, neighborhood_id, year_month, impressions, views, completions, cta_taps) values
  ('00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690301', '69001', null, (select month_current from test_months_69), 999, 999, 999, 999);

-- ── Z3 (69003) -- MEZCLA1-3/RNG_FROZEN/RNG_CURRENT: crudo BAJO el umbral
--    (3 usuarios, mes elegible) + monthly YA seguro (mes congelado) --------
--    Crudo: impresiones=3 views=2(u1,u2) cta=1(u1).
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690301', '00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690921', gen_random_uuid(), '69003', null, (select month_current_ts from test_months_69), 4000, true,  false, (select month_current_ts from test_months_69)),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690301', '00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690922', gen_random_uuid(), '69003', null, (select month_current_ts + interval '1 minute' from test_months_69), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690301', '00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690923', gen_random_uuid(), '69003', null, (select month_current_ts + interval '2 minutes' from test_months_69),  800, false, false, null);

insert into public.ad_impressions_monthly (agency_id, ad_id, municipality_id, neighborhood_id, year_month, impressions, views, completions, cta_taps) values
  ('00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690301', '69003', null, (select month_frozen1 from test_months_69), 50, 30, 20, 12);

-- ── Z4 (69004) -- MEZCLA4-5: crudo que SÍ pasa su propio k (5 usuarios) +
--    monthly ya seguro (mes congelado) -- se SUMAN limpio ─────────────────
--    Crudo: impresiones=5 views=4(u1,u2,u3,u4) cta=1(u1).
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690301', '00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690931', gen_random_uuid(), '69004', null, (select month_current_ts from test_months_69), 4000, true,  false, (select month_current_ts from test_months_69)),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690301', '00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690932', gen_random_uuid(), '69004', null, (select month_current_ts + interval '1 minute' from test_months_69), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690301', '00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690933', gen_random_uuid(), '69004', null, (select month_current_ts + interval '2 minutes' from test_months_69), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690301', '00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690934', gen_random_uuid(), '69004', null, (select month_current_ts + interval '3 minutes' from test_months_69), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690301', '00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690935', gen_random_uuid(), '69004', null, (select month_current_ts + interval '4 minutes' from test_months_69),  800, false, false, null);

insert into public.ad_impressions_monthly (agency_id, ad_id, municipality_id, neighborhood_id, year_month, impressions, views, completions, cta_taps) values
  ('00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690301', '69004', null, (select month_frozen1 from test_months_69), 20, 15, 8, 5);

-- ── Sin zona (NULL,NULL), mes ELEGIBLE -- aporta al bucket junto con Z3 ────
--    impresiones=2 views=1(u1) cta=0.
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690301', '00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690941', gen_random_uuid(), null, null, (select month_current_ts from test_months_69), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690301', '00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690942', gen_random_uuid(), null, null, (select month_current_ts + interval '1 minute' from test_months_69),  800, false, false, null);

-- ── Bucket monthly congelado (NULL,NULL), mes NO elegible -- se funde con
--    el bucket del crudo elegible, UNA sola fila (BUCKET1/DEDUPE1) ─────────
insert into public.ad_impressions_monthly (agency_id, ad_id, municipality_id, neighborhood_id, year_month, impressions, views, completions, cta_taps) values
  ('00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690301', null, null, (select month_frozen1 from test_months_69), 10, 6, 3, 2);

-- ── Z2 (69002) -- HIST1/FRONT2: mes puramente histórico (monthly únicamente)
--    + crudo "stray" del mismo mes NO elegible (purga rezagada, NUNCA
--    debería pasar en producción pero el contrato debe blindarse igual) --
--    el resultado final debe ser EXACTAMENTE el valor monthly, el stray se
--    IGNORA por completo (ni se suma a la zona ni al bucket -- ese mes ya
--    NO es elegible para el crudo en absoluto).
insert into public.ad_impressions_monthly (agency_id, ad_id, municipality_id, neighborhood_id, year_month, impressions, views, completions, cta_taps) values
  ('00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690301', '69002', null, (select month_frozen1 from test_months_69), 40, 22, 15, 9);

insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690301', '00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690951', gen_random_uuid(), '69002', null, (select month_frozen1_ts from test_months_69), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690301', '00000000-0000-0000-0000-000000690101', '00000000-0000-0000-0000-000000690952', gen_random_uuid(), '69002', null, (select month_frozen1_ts + interval '1 minute' from test_months_69),  800, false, false, null);

-- ── FIXTURE_ANCHOR: protege el archivo de derivar mal sus propios totales si
--    alguien edita las impresiones/filas de arriba -- ancla independiente
--    del SUT (cuenta cruda/monthly, superusuario). Crudo: Z1(5)+Z3(3)+Z4(5)+
--    sin_zona(2)+Z2_stray(2)=17. Monthly: Z1dup+Z3+Z4+bucket+Z2=5.
select is(
  (select count(*)::int from public.ad_impressions where agency_id = '00000000-0000-0000-0000-000000690101'),
  17,
  'ANCHOR1_agencia_69_tiene_exactamente_17_impresiones_crudas_sembradas'
);
select is(
  (select count(*)::int from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000690101'),
  5,
  'ANCHOR2_agencia_69_tiene_exactamente_5_filas_monthly_sembradas_a_mano'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Llamada SIN rango, OWNER_69 -- mezcla completa, ambas fuentes.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_call1_69 (ok boolean, err_sqlstate text);
create temp table result_call1_69_rows (municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer);
grant all on result_call1_69, result_call1_69_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000690001', 'authenticated'); -- OWNER_69
do $$
begin
  insert into result_call1_69_rows
  select * from public.ad_metrics_for_agency('00000000-0000-0000-0000-000000690101'::uuid, null, null);
  insert into result_call1_69 values (true, null);
exception when others then
  insert into result_call1_69 values (false, sqlstate);
end $$;
reset role;

select is((select ok from result_call1_69), true, 'CALL1_ok_la_llamada_sin_rango_no_lanza_excepcion');
select is((select count(*)::int from result_call1_69_rows), 5,
  'CALL1_rowcount_5_filas_Z1_Z2_Z3_Z4_mas_UN_bucket');

select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text
     from result_call1_69_rows where municipality_id = '69001'),
  '5:3:2',
  'FRONT1_Z1_mes_elegible_ignora_la_fila_monthly_duplicada_999_resultado_es_EXACTAMENTE_el_crudo'
);
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text
     from result_call1_69_rows where municipality_id = '69002'),
  '40:22:9',
  'FRONT2_HIST1_Z2_mes_historico_ignora_el_crudo_stray_resultado_es_EXACTAMENTE_el_valor_monthly'
);
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text
     from result_call1_69_rows where municipality_id = '69003'),
  '50:30:12',
  'MEZCLA1_Z3_zona_final_es_SOLO_la_porcion_monthly_ya_segura_el_crudo_bajo_el_umbral_NO_se_suma_a_la_zona'
);
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text
     from result_call1_69_rows where municipality_id = '69004'),
  '25:19:6',
  'MEZCLA4_Z4_crudo_que_SI_pasa_su_propio_k_se_SUMA_limpio_con_la_porcion_monthly_5_mas_20_25'
);

select is((select count(*)::int from result_call1_69_rows where municipality_id is null and neighborhood_id is null), 1,
  'BUCKET1_una_SOLA_fila_null_null_nunca_dos_pese_a_fundir_3_origenes_distintos');
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text
     from result_call1_69_rows where municipality_id is null and neighborhood_id is null),
  '15:9:3',
  'MEZCLA2_bucket_funde_sin_zona_crudo_2_mas_Z3_redirigido_3_mas_bucket_monthly_congelado_10_igual_15'
);

select is(
  (select sum(impressions)::text || ':' || sum(views)::text || ':' || sum(cta_taps)::text
     from result_call1_69_rows),
  '135:83:32',
  'TOTAL1_suma_de_TODAS_las_filas_igual_a_la_aritmetica_a_mano_5_mas_40_mas_50_mas_25_mas_15_135'
);

select is(
  (select count(*)::int from result_call1_69_rows),
  (select count(distinct (municipality_id, neighborhood_id))::int from result_call1_69_rows),
  'DEDUPE1_ninguna_llave_municipality_neighborhood_se_repite_en_la_salida'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Rango p_from/p_to cruzando la frontera -- misma mezcla, tres ventanas.
-- ════════════════════════════════════════════════════════════════════════════

-- 5a) RNG_SPAN -- rango explícito que abarca el mes congelado Y el elegible.
create temp table result_span_69 (ok boolean, err_sqlstate text);
create temp table result_span_69_rows (municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer);
grant all on result_span_69, result_span_69_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000690001', 'authenticated');
do $$
begin
  insert into result_span_69_rows
  select * from public.ad_metrics_for_agency(
    '00000000-0000-0000-0000-000000690101'::uuid,
    (select rng_frozen_from from test_months_69),
    (select rng_current_to  from test_months_69)
  );
  insert into result_span_69 values (true, null);
exception when others then
  insert into result_span_69 values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_span_69), true, 'RNG_SPAN_ok_el_rango_explicito_no_lanza_excepcion');
select is((select count(*)::int from result_span_69_rows), 5, 'RNG_SPAN_rowcount_5_filas_igual_que_sin_rango');
select is(
  (select sum(impressions)::text || ':' || sum(views)::text || ':' || sum(cta_taps)::text
     from result_span_69_rows),
  '135:83:32',
  'RNG_SPAN_grandtotal_135_83_32_el_rango_en_si_no_rompe_la_mezcla'
);

-- 5b) RNG_FROZEN -- ventana angosta DENTRO del mes congelado -- el crudo
-- elegible queda fuera por construcción (su shown_at no cae ahí).
create temp table result_frozen_69 (ok boolean, err_sqlstate text);
create temp table result_frozen_69_rows (municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer);
grant all on result_frozen_69, result_frozen_69_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000690001', 'authenticated');
do $$
begin
  insert into result_frozen_69_rows
  select * from public.ad_metrics_for_agency(
    '00000000-0000-0000-0000-000000690101'::uuid,
    (select rng_frozen_from from test_months_69),
    (select rng_frozen_to   from test_months_69)
  );
  insert into result_frozen_69 values (true, null);
exception when others then
  insert into result_frozen_69 values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_frozen_69), true, 'RNG_FROZEN_ok_no_lanza_excepcion');
select is((select count(*)::int from result_frozen_69_rows), 4,
  'RNG_FROZEN_rowcount_4_filas_Z2_Z3_Z4_y_bucket_SOLO_lo_que_aporta_monthly_para_ese_mes');
select is((select count(*)::int from result_frozen_69_rows where municipality_id = '69001'), 0,
  'RNG_FROZEN_Z1_ausente_su_unica_fila_monthly_es_de_un_mes_elegible_y_ESE_nunca_se_lee');
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text
     from result_frozen_69_rows where municipality_id = '69003'),
  '50:30:12',
  'RNG_FROZEN_Z3_sigue_mostrando_SOLO_su_valor_monthly_el_rango_angosto_no_lo_contamina'
);
select is(
  (select sum(impressions)::text || ':' || sum(views)::text || ':' || sum(cta_taps)::text
     from result_frozen_69_rows),
  '120:73:28',
  'RNG_FROZEN_grandtotal_120_73_28_igual_a_la_suma_monthly_completa_40_mas_50_mas_20_mas_10'
);

-- 5c) RNG_CURRENT -- ventana angosta DENTRO del mes elegible -- monthly
-- queda fuera por construcción (D-RANGO-MONTHLY, el mes congelado no se
-- traslapa con esta ventana).
create temp table result_current_69 (ok boolean, err_sqlstate text);
create temp table result_current_69_rows (municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer);
grant all on result_current_69, result_current_69_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000690001', 'authenticated');
do $$
begin
  insert into result_current_69_rows
  select * from public.ad_metrics_for_agency(
    '00000000-0000-0000-0000-000000690101'::uuid,
    (select rng_current_from from test_months_69),
    (select rng_current_to   from test_months_69)
  );
  insert into result_current_69 values (true, null);
exception when others then
  insert into result_current_69 values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_current_69), true, 'RNG_CURRENT_ok_no_lanza_excepcion');
select is((select count(*)::int from result_current_69_rows), 3,
  'RNG_CURRENT_rowcount_3_filas_Z1_Z4_y_bucket_SOLO_lo_que_aporta_el_crudo_para_ese_mes');
select is((select count(*)::int from result_current_69_rows where municipality_id = '69002'), 0,
  'RNG_CURRENT_Z2_ausente_su_unica_fila_es_monthly_de_un_mes_congelado_fuera_de_este_rango');
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text
     from result_current_69_rows where municipality_id is null and neighborhood_id is null),
  '5:3:1',
  'RNG_CURRENT_bucket_redirige_Z3_2_mas_3_igual_5_aun_SIN_contraparte_monthly_en_este_rango'
);
select is(
  (select sum(impressions)::text || ':' || sum(views)::text || ':' || sum(cta_taps)::text
     from result_current_69_rows),
  '15:10:4',
  'RNG_CURRENT_grandtotal_15_10_4_igual_a_la_suma_del_crudo_completo_5_mas_5_mas_5'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Anti-IDOR (regresión barata) -- STRANGER sin relación con la agencia,
--    datos reales sembrados en AMBAS fuentes.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_idor_69 (ok boolean, err_sqlstate text);
create temp table result_idor_69_rows (municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer);
grant all on result_idor_69, result_idor_69_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000690002', 'authenticated'); -- STRANGER
do $$
begin
  insert into result_idor_69_rows
  select * from public.ad_metrics_for_agency('00000000-0000-0000-0000-000000690101'::uuid, null, null);
  insert into result_idor_69 values (true, null);
exception when others then
  insert into result_idor_69 values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_idor_69), true, 'IDOR1a_stranger_no_lanza_excepcion_anti_idor');
select is((select count(*)::int from result_idor_69_rows), 0,
  'IDOR1b_stranger_recibe_0_filas_pese_a_datos_reales_en_ambas_fuentes');

-- ════════════════════════════════════════════════════════════════════════════
-- 7) #216 — mes de FRONTERA y rangos con extremos INTERIORES al mes.
--    SEGUNDA agencia (690102) con fixture propio: los 27 asserts de arriba
--    filtran todos por 690101 y no se ven afectados por una sola fila de
--    esta sección.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.agencies (id, name, slug, status, can_advertise, advertiser_category, created_by_user_id) values
  ('00000000-0000-0000-0000-000000690102', 'Agencia Frontera 69', 'agencia-frontera-69',
   'active', true, 'otro', '00000000-0000-0000-0000-000000690003');

insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000690102', '00000000-0000-0000-0000-000000690003', 'owner', 'active');

insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000690202', '00000000-0000-0000-0000-000000690102', 'ready');

insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000690302', '00000000-0000-0000-0000-000000690102',
   '00000000-0000-0000-0000-000000690202', 'Ad Frontera 69', 'phone', '+5213300006902',
   'active', '2025-12-01'::timestamptz, '2026-12-01'::timestamptz);

-- ── Z5 (69105) — el MES DE FRONTERA. Crudo remanente con shown_at DESPUÉS
--    del corte de 90 días (pero dentro de un mes cuyo INICIO ya salió de la
--    ventana) + fila monthly consolidada del MISMO mes. 5 usuarios distintos
--    a propósito: si la frontera se evaluara por fila, este crudo pasaría el
--    k>=5, tendría fila propia y se SUMARÍA a la porción monthly de la misma
--    zona (105:63:27 en vez de 100:60:25) -- exactamente el doble conteo.
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690302', '00000000-0000-0000-0000-000000690102', '00000000-0000-0000-0000-000000690961', gen_random_uuid(), '69105', null, (select bnd_stray_ts from test_months_69), 4000, true,  false, (select bnd_stray_ts from test_months_69)),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690302', '00000000-0000-0000-0000-000000690102', '00000000-0000-0000-0000-000000690962', gen_random_uuid(), '69105', null, (select bnd_stray_ts + interval '1 minute' from test_months_69), 4000, true,  false, (select bnd_stray_ts + interval '1 minute' from test_months_69)),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690302', '00000000-0000-0000-0000-000000690102', '00000000-0000-0000-0000-000000690963', gen_random_uuid(), '69105', null, (select bnd_stray_ts + interval '2 minutes' from test_months_69), 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690302', '00000000-0000-0000-0000-000000690102', '00000000-0000-0000-0000-000000690964', gen_random_uuid(), '69105', null, (select bnd_stray_ts + interval '3 minutes' from test_months_69),  800, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000690302', '00000000-0000-0000-0000-000000690102', '00000000-0000-0000-0000-000000690965', gen_random_uuid(), '69105', null, (select bnd_stray_ts + interval '4 minutes' from test_months_69),  800, false, false, null);

insert into public.ad_impressions_monthly (agency_id, ad_id, municipality_id, neighborhood_id, year_month, impressions, views, completions, cta_taps) values
  ('00000000-0000-0000-0000-000000690102', '00000000-0000-0000-0000-000000690302', '69105', null, (select bnd_month from test_months_69), 100, 60, 40, 25);

-- ── Z6 (69106) — mes congelado clásico (10 meses atrás), SOLO monthly. Es el
--    mes que el rango de extremos interiores (RNG_INNER) debe alcanzar.
insert into public.ad_impressions_monthly (agency_id, ad_id, municipality_id, neighborhood_id, year_month, impressions, views, completions, cta_taps) values
  ('00000000-0000-0000-0000-000000690102', '00000000-0000-0000-0000-000000690302', '69106', null, (select month_frozen1 from test_months_69), 70, 40, 30, 18);

-- ANCHOR3 — el fixture de frontera REALMENTE cruza el corte: el mes empieza
-- fuera de la ventana de 90 días y el crudo remanente cae dentro de la
-- ventana pero antes del fin de ese mes. Sin esta ancla, BND1-3 podrían
-- "pasar" por un fixture mal construido en vez de por el contrato.
select is(
  (select (bnd_month::timestamptz < now() - interval '90 days')
      and (bnd_stray_ts > now() - interval '90 days')
      and (bnd_stray_ts < bnd_month + interval '1 month')
     from test_months_69),
  true,
  'ANCHOR3_el_mes_de_frontera_empieza_fuera_de_los_90_dias_y_su_crudo_remanente_cae_dentro_del_corte'
);
select is(
  (select count(*)::int from public.ad_impressions where agency_id = '00000000-0000-0000-0000-000000690102'),
  5,
  'ANCHOR4_agencia_frontera_tiene_exactamente_5_impresiones_crudas_en_el_mes_de_frontera'
);
select is(
  (select count(*)::int from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000690102'),
  2,
  'ANCHOR5_agencia_frontera_tiene_exactamente_2_filas_monthly_frontera_y_congelado'
);

-- 7a) BND — llamada SIN rango sobre la agencia de frontera.
create temp table result_bnd_69 (ok boolean, err_sqlstate text);
create temp table result_bnd_69_rows (municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer);
grant all on result_bnd_69, result_bnd_69_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000690003', 'authenticated');
do $$
begin
  insert into result_bnd_69_rows
  select * from public.ad_metrics_for_agency('00000000-0000-0000-0000-000000690102'::uuid, null, null);
  insert into result_bnd_69 values (true, null);
exception when others then
  insert into result_bnd_69 values (false, sqlstate);
end $$;
reset role;

select is((select ok from result_bnd_69), true, 'BND0_ok_la_llamada_sobre_la_agencia_de_frontera_no_lanza_excepcion');
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text
     from result_bnd_69_rows where municipality_id = '69105'),
  '100:60:25',
  'BND1_mes_de_frontera_el_crudo_posterior_al_corte_se_IGNORA_por_MES_resultado_EXACTO_monthly_nunca_105_63_27'
);
select is((select count(*)::int from result_bnd_69_rows), 2,
  'BND2_rowcount_2_solo_las_dos_zonas_monthly_el_crudo_de_frontera_no_crea_ni_zona_ni_bucket');
select is(
  (select sum(impressions)::text || ':' || sum(views)::text || ':' || sum(cta_taps)::text
     from result_bnd_69_rows),
  '170:100:43',
  'BND3_grandtotal_170_100_43_igual_a_la_suma_monthly_pura_100_mas_70_sin_rastro_del_crudo_de_frontera'
);

-- 7b) RNG_INNER — rango con AMBOS extremos interiores al mes congelado.
create temp table result_inner_69 (ok boolean, err_sqlstate text);
create temp table result_inner_69_rows (municipality_id text, neighborhood_id bigint, impressions integer, views integer, cta_taps integer);
grant all on result_inner_69, result_inner_69_rows to public;
select pg_temp.act_as('00000000-0000-0000-0000-000000690003', 'authenticated');
do $$
begin
  insert into result_inner_69_rows
  select * from public.ad_metrics_for_agency(
    '00000000-0000-0000-0000-000000690102'::uuid,
    (select rng_inner_from from test_months_69),
    (select rng_inner_to   from test_months_69)
  );
  insert into result_inner_69 values (true, null);
exception when others then
  insert into result_inner_69 values (false, sqlstate);
end $$;
reset role;

select is((select ok from result_inner_69), true, 'RNG_INNER0_ok_el_rango_interior_no_lanza_excepcion');
select is(
  (select impressions::text || ':' || views::text || ':' || cta_taps::text
     from result_inner_69_rows where municipality_id = '69106'),
  '70:40:18',
  'RNG_INNER1_p_from_al_dia_15_SIGUE_incluyendo_el_mes_congelado_traslape_de_intervalo_no_comparacion_de_punto'
);
select is((select count(*)::int from result_inner_69_rows where municipality_id = '69105'), 0,
  'RNG_INNER2_el_mes_de_frontera_POSTERIOR_a_p_to_queda_fuera_el_filtro_p_to_de_monthly_sigue_vivo');
select is((select count(*)::int from result_inner_69_rows), 1,
  'RNG_INNER3_rowcount_1_solo_el_mes_congelado_alcanzado_por_el_rango_interior');
select is(
  (select sum(impressions)::text || ':' || sum(views)::text || ':' || sum(cta_taps)::text
     from result_inner_69_rows),
  '70:40:18',
  'RNG_INNER4_grandtotal_70_40_18_ni_el_mes_de_frontera_ni_ningun_crudo_se_cuelan_en_el_rango_interior'
);

select * from finish();
rollback;
