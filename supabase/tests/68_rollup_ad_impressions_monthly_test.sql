-- Tests pgTAP — public.rollup_ad_impressions_monthly() + job pg_cron (subtarea
-- #201.1, hardening(170.5), tarea 201). Ejecutar con:
--   supabase test db supabase/tests/68_rollup_ad_impressions_monthly_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de
-- una transacción revertida (no persiste). Impersonamos con
-- pg_temp.act_as(uid, role) (mismo patrón que 02/16/25/37/43/44/46/47/48/51/
-- 52/53/62/63/64_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba: el contrato PÚBLICO de la función — firma de catálogo,
-- autorización por GRANT/REVOKE ejercitada con impersonación JWT real, las
-- FILAS que deja en public.ad_impressions_monthly tras invocarla con datos
-- reales sembrados a mano (nunca la misma expresión SQL que usará el SUT), y
-- el registro del job en cron.job. NUNCA internals (no se valida el cuerpo
-- del plpgsql, no se lee pg_policy).
--
-- SUT (AÚN NO EXISTE — RED 2026-08-23): una migración GREEN debe crear
--
--   public.rollup_ad_impressions_monthly() returns void
--   security definer, patrón EXACTO de public.purge_ad_impressions
--   (20260817000002 — misma migración/dominio, mismo job diario, el sibling
--   más cercano). revoke execute from public, anon, authenticated; grant
--   execute to service_role. Reusa la extensión pg_cron YA instalada por
--   170.5 (NO create extension).
--
--   Cuerpo: recalcula TODOS los meses distintos presentes en
--   ad_impressions (agrupando por date_trunc('month', shown_at)) e inserta o
--   sobreescribe en ad_impressions_monthly vía
--   `insert ... on conflict (agency_id, ad_id, municipality_id,
--   neighborhood_id, year_month) do update set impressions=excluded.*, ...`
--   -- NUNCA suma sobre el valor previo (recalculo honesto, no incremental).
--
--   Job pg_cron: jobname='rollup_ad_impressions_monthly_daily',
--   schedule='0 8 * * *' (8:00 UTC = 2:00 CDMX, 1h de holgura ANTES de
--   purge_ad_impressions_daily a las 9:00 UTC — el rollup debe correr sobre
--   el crudo ANTES de que la purga borre nada),
--   command='select public.rollup_ad_impressions_monthly();'.
--
-- ── D-RETURN (decisión de diseño del test-author, 2026-08-23, NO estaba
--    fijada por el orquestador) — tipo de retorno `void` ────────────────────
-- El contrato del orquestador no fija el tipo de retorno. Se decide `void`
-- (NO integer como notify_ads_expiring_soon): esa función es testeable por
-- retorno porque INSERTA filas nuevas cuyo conteo es información útil; este
-- SUT RECALCULA una tabla completa (upsert, no insert puro) — "cuántas filas
-- tocó" no es una cifra estable entre corridas (la 2a corrida idempotente
-- toca las mismas filas que la 1a, pero inserta 0 filas *nuevas*: un
-- retorno "filas insertadas" sería 0 en ambas corridas y ocultaría que SÍ
-- recalculó). El patrón correcto es el de purge_ad_impressions (mismo
-- dominio, mismo archivo de origen): `void`, verificable leyendo la tabla
-- directamente. Todos los asserts de este archivo verifican por la TABLA,
-- nunca por el valor de retorno.
--
-- ── D-VENTANA (decisión de diseño del test-author, 2026-08-23, resuelta EN
--    el RED como pide el PLAN de la subtarea) — qué meses agrega ───────────
-- El job recalcula TODOS los meses distintos presentes en ad_impressions en
-- el momento de la corrida, NUNCA solo "mes en curso + anterior" con una
-- ventana relativa a now(). Razón: el crudo vive 90 días (purge diaria a las
-- 9 UTC) y puede abarcar hasta 4 meses calendario distintos según en qué día
-- del mes caiga hoy (p.ej. el día 1: hoy + 89 días atrás cruza 3-4 fronteras
-- de mes) -- una ventana relativa fija ("mes actual + 1") puede dejar sin
-- agregar un mes que el crudo TODAVÍA tiene, violando el criterio literal del
-- PLAN ("nada que el crudo aún tenga puede perderse"). Recalcular por
-- GROUP BY sobre TODO lo que exista hoy en ad_impressions es a la vez más
-- simple (sin parámetro de ventana que mantener) y estrictamente más
-- correcto. OLD1 (sección 7 de este archivo) es la prueba directa: un mes muy
-- viejo (2026-01), lejos de "hoy" y de los otros dos meses del fixture,
-- también debe aparecer recalculado -- si el SUT usara una ventana relativa
-- a now() angosta, esta fila no existiría.
--
-- ── D-BUCKET (contrato fijado por el orquestador en el PLAN, ver bitácora
--    201.1) — la fila (NULL, NULL) de cada mes ─────────────────────────────
-- Dos orígenes distintos comparten la MISMA llave física (agency_id, ad_id,
-- NULL, NULL, year_month) y por tanto SE SUMAN en una sola fila: (a) las
-- impresiones cuya zona nunca resolvió (municipality_id/neighborhood_id ya
-- nacen NULL/NULL en el crudo) y (b) las zonas reales que colapsan por
-- k-anonimato (count(distinct user_id) < 5 en el mes). AGG4 (sección 7) es la
-- prueba directa: la zona MUNI_4 (4 usuarios, colapsa) y la zona UNRESOLVED
-- (sin zona) del mismo mes/anuncio terminan FUNDIDAS en una sola fila
-- (NULL,NULL), no como dos entradas separadas.
--
-- ── K-anonimato AL AGREGAR (precedente fijo de Abraham "zona ⇒ k≥5; sin
--    zona ⇒ libre", exploración 040 y #171) — MISMA semántica de
--    ad_metrics_for_agency (20260821000001): count(distinct user_id) >= 5,
--    NUNCA count(*) -- ver ZONE_K4 (sección 0), 4 usuarios distintos en 5
--    filas (repite un user_id) para que un mutante que cuente FILAS en vez de
--    USUARIOS DISTINTOS falle exactamente igual que EDGE9 de 62_*.
--
-- ── Estrategia RED sin depender de "function does not exist" ────────────────
-- Se SIGUE el patrón ya establecido en 51/53/62/63_*: NUNCA se crea una
-- migración-stub (ese archivo lo escribe el GREEN). (a) los asserts de
-- catálogo puro (has_function, pg_proc, pg_get_function_*,
-- has_function_privilege) son seguros aunque la función no exista — resuelven
-- NULL/false/not-ok sin lanzar; (b) TODA llamada real
-- (`perform public.rollup_ad_impressions_monthly()`) va dentro de un bloque
-- `do $$ ... exception when others then ... $$` AUTO-PROTEGIDO que escribe su
-- resultado en una tabla temporal -- así el archivo entero corre sin abortar
-- pese al 42883 ("function does not exist") de HOY, y las aserciones de
-- valores fallan limpio contra tablas ad_impressions_monthly vacías (0 filas)
-- en vez de las cifras reales esperadas. DELTA total: ninguna aserción de
-- este archivo puede pasar hoy por la razón correcta.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ────────────────
-- Firma pública: has_function; catálogo EXACTO (sin argumentos, returns void,
--   security definer); privilegios estáticos (authenticated/anon SIN
--   EXECUTE, service_role CON EXECUTE).
-- Autorización funcional (impersonación JWT real): authenticated no ejecuta
--   (42501); anon no ejecuta (42501) -- solo postgres/service_role.
-- pg_cron: 1 fila propia en cron.job con jobname/schedule/command exactos;
--   coexiste con purge_ad_impressions_daily (2 filas juntas en cron.job),
--   schedule '0 8 * * *' -- 1h ANTES de la purga ('0 9 * * *').
-- Purga NO toca el rollup (barato, complementa PURGE6 de 51_*): un valor
--   sembrado a mano en ad_impressions_monthly sobrevive intacto a
--   purge_ad_impressions().
-- Cifras correctas contra fixtures calculados A MANO (impresiones=count(*),
--   vistas=viewed, completadas=completed, taps=cta_tapped_at is not null):
--   zona real con 5 usuarios distintos -> fila propia (AGG2); un segundo par
--   (mismo municipio, colonia real distinta) -> fila propia SEPARADA, prueba
--   que la llave es el PAR completo (AGG3).
-- K-anonimato AL AGREGAR (D-BUCKET arriba): zona con 4 usuarios distintos
--   (en 5 filas, repite un user_id -- distingue usuarios de impresiones) NO
--   tiene fila propia (AGG5) y sus cifras terminan DENTRO del bucket
--   (NULL,NULL) del mes, fundidas con las impresiones sin zona (AGG4).
-- Conservación de totales: suma de TODAS las filas del mes == total real
--   sembrado a mano (AGG6) -- agregar/colapsar nunca pierde impresiones (es
--   dinero, base de #172).
-- Caso NACIONAL puro (D-BUCKET): un anuncio genuinamente sin zona (6
--   usuarios distintos, ninguno colapsado por privacidad) también cae en la
--   fila (NULL,NULL) de SU mes -- misma llave física que el colapso por k,
--   pero un mes/anuncio distintos para no confundir los dos orígenes
--   (MONTHB1).
-- Ventana (D-VENTANA): un mes viejo, lejano de "hoy" y de los otros meses del
--   fixture, también se recalcula -- nada que el crudo tenga se pierde
--   (OLD1).
-- IDEMPOTENCIA: correr la función 2 veces seguidas SIN cambiar el crudo deja
--   EXACTAMENTE las mismas cifras y el mismo número de filas (nunca dobla) --
--   recalcula y sobreescribe, nunca suma sobre el valor previo (IDEMP1-3).
-- Recalculo honesto (dos sub-casos en la MISMA 3a corrida, RUN3):
--   (a) una fila del crudo YA EXISTENTE se modifica in-place (upsert por id
--       -- el cliente sube el tap al CTA después, patrón documentado en
--       20260817000002) -- el rollup debe reflejar el cambio, lo que prueba
--       que RECALCULA desde el crudo (GROUP BY completo) y no solo SUMA
--       incrementalmente lo nuevo (un job que solo mirara "filas nuevas
--       desde la última corrida" nunca vería este cambio -- RECALC1/2);
--   (b) llega una impresión GENUINAMENTE nueva -- el total del mes crece
--       exactamente lo esperado, sin duplicar lo ya contado (RECALC3-6).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(59);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) Fixtures — self-contained, prefijo '680XXX' (fuera del rango de otros
--    archivos: 51 usa '510XXX', 62 usa '620XXX', 63 usa '630XXX').
--    Tres meses SIN relación con "hoy" (2026-01/03/06) -- el contrato de esta
--    función es agnóstico de la fecha real de la corrida (D-VENTANA).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000680001', 'owner_rollup68@urbea.mx');

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000680101', 'Agencia Rollup 68', 'agencia-rollup-68',
   'active', '00000000-0000-0000-0000-000000680001');

insert into public.mx_states (id, name, abbr) values ('68', 'Estado Rollup Test 68', 'RT');
insert into public.mx_municipalities (id, state_id, name) values ('68001', '68', 'Municipio Rollup 68001');
insert into public.mx_neighborhoods (source_key, municipality_id, name, geom) values
  ('test-rollup-68-n1', '68001', 'Colonia Rollup 68',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-99.80, 19.80, -99.78, 19.82, 4326))::extensions.geography);

create temp table test_ctx_68 as
select (select id from public.mx_neighborhoods where source_key = 'test-rollup-68-n1') as neighborhood_id;

insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000680201', '00000000-0000-0000-0000-000000680101', 'ready');

-- AD1: usado en MONTH_A y MONTH_OLD. AD2: usado en MONTH_B. Ambos existen a
-- propósito para probar que el mismo agency_id/zona en meses distintos NO se
-- funde (year_month es parte de la llave, D-VENTANA/OLD1).
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101',
   '00000000-0000-0000-0000-000000680201', 'Ad Rollup 68 Uno', 'phone', '+5213300006801',
   'active', '2025-12-01'::timestamptz, '2026-12-01'::timestamptz),
  ('00000000-0000-0000-0000-000000680302', '00000000-0000-0000-0000-000000680101',
   '00000000-0000-0000-0000-000000680201', 'Ad Rollup 68 Dos', 'phone', '+5213300006802',
   'active', '2025-12-01'::timestamptz, '2026-12-01'::timestamptz);

-- ── MONTH_A = 2026-03-01, AD1 ────────────────────────────────────────────────
-- ZONE_REAL_K5 (68001, NULL)      -- 5 usuarios distintos -> fila PROPIA.
--   impresiones=5 views=3(u1,u2,u4) completions=2(u1,u4) cta=2(u1,u5)
-- ZONE_K4     (68002, NULL)       -- 4 usuarios distintos EN 5 FILAS (u9
--   repetido) -> COLAPSA (EDGE k-anon por usuarios, no por filas).
--   impresiones=5 views=3(u6,u8,u9fila4) completions=1(u8) cta=1(u8)
-- ZONE_NEIGH_K5 (68001, neigh_id) -- mismo municipio que ZONE_REAL_K5, colonia
--   real DISTINTA -> fila PROPIA separada (la llave es el PAR completo).
--   impresiones=5 views=3(u11,u12,u14) completions=2(u11,u14) cta=2(u11,u14)
-- ZONE_UNRESOLVED (NULL, NULL)    -- zona NUNCA resuelta (GPS apagado, etc.)
--   impresiones=3 views=2(u16,u18) completions=1(u18) cta=1(u16)
--
-- bucket (NULL,NULL) esperado = ZONE_K4 + ZONE_UNRESOLVED (D-BUCKET, AGG4):
--   impresiones=5+3=8 views=3+2=5 completions=1+1=2 cta=1+1=2
-- TOTAL MONTH_A: impresiones=5+5+5+3=18 views=3+3+3+2=11 completions=2+1+2+1=6 cta=2+1+2+1=6
-- (5+5+8=18 ✓ 3+3+5=11 ✓ 2+2+2=6 ✓ 2+2+2=6 ✓ -- conservación, AGG6)

insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  -- ZONE_REAL_K5 -- id explícito en la fila de u2 (680802): se re-targetea con
  -- ON CONFLICT en la sección 7 para el test de recalculo honesto (RECALC1/2).
  ('00000000-0000-0000-0000-000000680801', '00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680911', gen_random_uuid(), '68001', null, '2026-03-15 10:00:00+00', 4000, true,  true,  '2026-03-15 10:00:00+00'),
  ('00000000-0000-0000-0000-000000680802', '00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680912', gen_random_uuid(), '68001', null, '2026-03-15 10:01:00+00', 4000, true,  false, null),
  ('00000000-0000-0000-0000-000000680803', '00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680913', gen_random_uuid(), '68001', null, '2026-03-15 10:02:00+00',  800, false, false, null),
  ('00000000-0000-0000-0000-000000680804', '00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680914', gen_random_uuid(), '68001', null, '2026-03-15 10:03:00+00', 4000, true,  true,  null),
  ('00000000-0000-0000-0000-000000680805', '00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680915', gen_random_uuid(), '68001', null, '2026-03-15 10:04:00+00',  800, false, false, '2026-03-15 10:04:30+00'),
  -- ZONE_K4 -- u9 repetido (680924) en dos filas: 4 usuarios distintos, 5 filas.
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680921', gen_random_uuid(), '68002', null, '2026-03-15 10:00:00+00', 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680922', gen_random_uuid(), '68002', null, '2026-03-15 10:01:00+00',  800, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680923', gen_random_uuid(), '68002', null, '2026-03-15 10:02:00+00', 4000, true,  true,  '2026-03-15 10:02:30+00'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680924', gen_random_uuid(), '68002', null, '2026-03-15 10:03:00+00', 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680924', gen_random_uuid(), '68002', null, '2026-03-15 10:04:00+00',  800, false, false, null),
  -- ZONE_NEIGH_K5 -- mismo '68001' que ZONE_REAL_K5, pero con neighborhood_id
  -- real: llave PAR distinta.
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680931', gen_random_uuid(), '68001', (select neighborhood_id from test_ctx_68), '2026-03-15 10:00:00+00', 4000, true,  true,  '2026-03-15 10:00:30+00'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680932', gen_random_uuid(), '68001', (select neighborhood_id from test_ctx_68), '2026-03-15 10:01:00+00', 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680933', gen_random_uuid(), '68001', (select neighborhood_id from test_ctx_68), '2026-03-15 10:02:00+00',  800, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680934', gen_random_uuid(), '68001', (select neighborhood_id from test_ctx_68), '2026-03-15 10:03:00+00', 4000, true,  true,  '2026-03-15 10:03:30+00'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680935', gen_random_uuid(), '68001', (select neighborhood_id from test_ctx_68), '2026-03-15 10:04:00+00',  800, false, false, null),
  -- ZONE_UNRESOLVED (NULL, NULL) -- zona nunca resuelta.
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680941', gen_random_uuid(), null, null, '2026-03-15 10:00:00+00', 4000, true,  false, '2026-03-15 10:00:30+00'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680942', gen_random_uuid(), null, null, '2026-03-15 10:01:00+00',  800, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680943', gen_random_uuid(), null, null, '2026-03-15 10:02:00+00', 4000, true,  true,  null);

-- ── MONTH_B = 2026-06-01, AD2 -- caso NACIONAL puro (sin colapso por k,
--    6 usuarios distintos, ninguno bloqueado por privacidad -- D-BUCKET) ────
-- impresiones=6 views=3(u20,u21,u23) completions=1(u20) cta=2(u20,u24)
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680302', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680951', gen_random_uuid(), null, null, '2026-06-15 09:00:00+00', 4000, true,  true,  '2026-06-15 09:00:30+00'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680302', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680952', gen_random_uuid(), null, null, '2026-06-15 09:01:00+00', 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680302', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680953', gen_random_uuid(), null, null, '2026-06-15 09:02:00+00',  800, false, false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680302', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680954', gen_random_uuid(), null, null, '2026-06-15 09:03:00+00', 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680302', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680955', gen_random_uuid(), null, null, '2026-06-15 09:04:00+00',  800, false, false, '2026-06-15 09:04:30+00'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680302', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680956', gen_random_uuid(), null, null, '2026-06-15 09:05:00+00',  800, false, false, null);

-- ── MONTH_OLD = 2026-01-01, AD1 -- mes VIEJO, lejos de "hoy" (2026-08) y de
--    los otros dos meses del fixture -- prueba D-VENTANA/OLD1: nada que el
--    crudo tenga se pierde, sin importar qué tan lejos esté de "ahora".
-- impresiones=2 views=1(u30) completions=0 cta=1(u31)
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680961', gen_random_uuid(), null, null, '2026-01-15 08:00:00+00', 4000, true,  false, null),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680962', gen_random_uuid(), null, null, '2026-01-15 08:01:00+00',  800, false, false, '2026-01-15 08:01:30+00');

-- ── FIXTURE_ANCHOR: protege el archivo de derivar mal sus propios totales si
--    alguien edita las impresiones de arriba sin actualizar los comentarios
--    de EXPECTATIVA -- ancla independiente del SUT (cuenta cruda, superusuario).
select is(
  (select count(*)::int from public.ad_impressions where agency_id = '00000000-0000-0000-0000-000000680101'),
  26,
  'FIXTURE_ANCHOR1_agencia_68_tiene_exactamente_26_impresiones_sembradas_18_mas_6_mas_2'
);
select is(
  (select count(*)::int from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101'),
  0,
  'FIXTURE_ANCHOR2_ad_impressions_monthly_arranca_VACIA_para_esta_agencia_antes_de_correr_el_rollup'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Firma pública — has_function + catálogo EXACTO + privilegios estáticos.
-- ════════════════════════════════════════════════════════════════════════════

select has_function(
  'public', 'rollup_ad_impressions_monthly', array[]::text[],
  'SIG0_la_funcion_public_rollup_ad_impressions_monthly_existe_sin_argumentos'
);

create temp table result_sig_68 (ok boolean, result_sig text, args_sig text);
do $$
declare
  v_oid oid;
begin
  v_oid := to_regprocedure('public.rollup_ad_impressions_monthly()');
  if v_oid is null then
    insert into result_sig_68 values (false, null, null);
  else
    insert into result_sig_68
    select true, pg_get_function_result(v_oid), pg_get_function_arguments(v_oid);
  end if;
exception when others then
  insert into result_sig_68 values (false, null, null);
end $$;

select is((select ok from result_sig_68), true,
  'SIG1_la_funcion_resuelve_por_catalogo_sin_argumentos');
select is((select result_sig from result_sig_68), 'void',
  'SIG2_retorna_void_D_RETURN_los_asserts_verifican_por_la_tabla_no_por_el_retorno');
select is(coalesce((select args_sig from result_sig_68), 'ERR'), '',
  'SIG3_no_recibe_ningun_argumento');
select is(
  (select prosecdef from pg_proc where proname = 'rollup_ad_impressions_monthly' and pronamespace = 'public'::regnamespace),
  true, 'SIG4_es_security_definer');

-- 🔴 `has_function_privilege(text, 'firma(text)', text)` hace un cast interno
-- a regprocedure: sobre una función que TODAVÍA no existe, ese cast por sí
-- solo lanza 42883 SIN protección (a diferencia de lives_ok/throws_ok) y
-- aborta el resto del script (documentado en 67_set_agency_status_atomic_
-- test.sql:170). La forma `(role, oid, priv)` resuelve el oid vía pg_proc con
-- un LEFT JOIN implícito (subquery vacía = NULL) -- falla por ASERCIÓN
-- limpia, no por excepción.
select ok(
  (
    select not has_function_privilege('authenticated', p.oid, 'EXECUTE')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rollup_ad_impressions_monthly' and p.pronargs = 0
  ) is true,
  'SIG5_authenticated_NO_tiene_EXECUTE_estatico_catalogo_puro'
);
select ok(
  (
    select not has_function_privilege('anon', p.oid, 'EXECUTE')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rollup_ad_impressions_monthly' and p.pronargs = 0
  ) is true,
  'SIG6_anon_NO_tiene_EXECUTE_estatico_catalogo_puro'
);
select ok(
  (
    select has_function_privilege('service_role', p.oid, 'EXECUTE')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rollup_ad_impressions_monthly' and p.pronargs = 0
  ) is true,
  'SIG7_service_role_SI_tiene_EXECUTE_estatico_catalogo_puro'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Autorización funcional — impersonación JWT real (nunca leyendo la policy).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000680001', 'authenticated');
select throws_ok(
  $$ select public.rollup_ad_impressions_monthly() $$,
  '42501', null,
  'AUTH1_authenticated_no_puede_ejecutar_el_rollup_ni_siendo_dueno_de_una_agencia_con_anuncios'
);
reset role;

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select public.rollup_ad_impressions_monthly() $$,
  '42501', null,
  'AUTH2_anon_no_puede_ejecutar_el_rollup'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) pg_cron — jobname/schedule/command exactos, coexiste con la purga.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_cron_job_68 (jobname text, schedule text, command text);
do $$
begin
  insert into result_cron_job_68
    select jobname, schedule, command from cron.job where jobname = 'rollup_ad_impressions_monthly_daily';
exception when others then
  null; -- schema cron no existiera -- no debería pasar, 170.5 ya lo instaló.
end $$;

select is((select count(*)::int from result_cron_job_68), 1,
  'CRON1_existe_exactamente_1_fila_en_cron_job_para_rollup_ad_impressions_monthly_daily');
select is(coalesce((select schedule from result_cron_job_68), 'NONE'), '0 8 * * *',
  'CRON2_schedule_0_8_UTC_una_hora_ANTES_de_la_purga_0_9_UTC_holgura_de_170_5');
select is(coalesce((select command from result_cron_job_68), 'NONE'), 'select public.rollup_ad_impressions_monthly();',
  'CRON3_command_exacto_select_public_rollup_ad_impressions_monthly');

select is(
  (select count(*)::int from cron.job where jobname in ('rollup_ad_impressions_monthly_daily', 'purge_ad_impressions_daily')),
  2,
  'CRON4_el_job_del_rollup_convive_en_cron_job_junto_con_purge_ad_impressions_daily_no_lo_reemplaza'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) La purga NO toca ad_impressions_monthly (barato, complementa PURGE6 de
--    51_ad_impressions_test.sql -- purge_ad_impressions() YA EXISTE, GREEN de
--    170.5, se invoca directo).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.ad_impressions_monthly (agency_id, ad_id, municipality_id, neighborhood_id, year_month, impressions, views, completions, cta_taps) values
  ('00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680301', '68001', null, date '2026-03-01', 999, 888, 777, 666);

select is(
  (select impressions::text || ':' || views::text || ':' || completions::text || ':' || cta_taps::text
     from public.ad_impressions_monthly
    where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301'
      and municipality_id = '68001' and neighborhood_id is null and year_month = date '2026-03-01'),
  '999:888:777:666',
  'PURGEMON0_precondicion_dura_el_valor_sembrado_a_mano_en_el_rollup_EXISTE_antes_de_purgar'
);

select public.purge_ad_impressions();

select is(
  (select impressions::text || ':' || views::text || ':' || completions::text || ':' || cta_taps::text
     from public.ad_impressions_monthly
    where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301'
      and municipality_id = '68001' and neighborhood_id is null and year_month = date '2026-03-01'),
  '999:888:777:666',
  'PURGEMON1_el_valor_sembrado_a_mano_SIGUE_INTACTO_tras_purge_ad_impressions_el_crudo_caduca_el_agregado_no'
);

delete from public.ad_impressions_monthly
 where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301'
   and municipality_id = '68001' and neighborhood_id is null and year_month = date '2026-03-01';

-- ════════════════════════════════════════════════════════════════════════════
-- 5) RUN1 — primera corrida real, como service_role. Verificada contra las
--    cifras calculadas A MANO en la sección 0 (fuente independiente, nunca la
--    misma expresión SQL que usará el SUT).
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_run1_68 (ok boolean, err_sqlstate text);
grant all on result_run1_68 to public;
select pg_temp.act_as(null, 'service_role');
do $$
begin
  perform public.rollup_ad_impressions_monthly();
  insert into result_run1_68 values (true, null);
exception when others then
  insert into result_run1_68 values (false, sqlstate);
end $$;
reset role;

select is((select ok from result_run1_68), true, 'RUN1_la_primera_corrida_no_lanza_excepcion');

select is(
  (select count(*)::int from public.ad_impressions_monthly
    where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301'
      and year_month = date '2026-03-01'),
  3,
  'AGG1_MONTH_A_deja_3_filas_ZONE_REAL_K5_ZONE_NEIGH_K5_mas_UNA_fila_otras_zonas'
);

-- ZONE_REAL_K5 (68001, NULL) -- 5 usuarios -> fila propia.
select is((select impressions from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and municipality_id = '68001' and neighborhood_id is null and year_month = date '2026-03-01'), 5, 'AGG2a_ZONE_REAL_K5_impressions_5');
select is((select views       from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and municipality_id = '68001' and neighborhood_id is null and year_month = date '2026-03-01'), 3, 'AGG2b_ZONE_REAL_K5_views_3');
select is((select completions from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and municipality_id = '68001' and neighborhood_id is null and year_month = date '2026-03-01'), 2, 'AGG2c_ZONE_REAL_K5_completions_2');
select is((select cta_taps    from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and municipality_id = '68001' and neighborhood_id is null and year_month = date '2026-03-01'), 2, 'AGG2d_ZONE_REAL_K5_cta_taps_2');

-- ZONE_NEIGH_K5 (68001, neigh_id real) -- mismo municipio, colonia real
-- DISTINTA -> fila PROPIA separada.
select is((select neighborhood_id from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and municipality_id = '68001' and neighborhood_id is not null and year_month = date '2026-03-01'), (select neighborhood_id from test_ctx_68), 'AGG3a_ZONE_NEIGH_K5_neighborhood_id_es_el_real_de_mx_neighborhoods');
select is((select impressions from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and municipality_id = '68001' and neighborhood_id is not null and year_month = date '2026-03-01'), 5, 'AGG3b_ZONE_NEIGH_K5_impressions_5');
select is((select views       from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and municipality_id = '68001' and neighborhood_id is not null and year_month = date '2026-03-01'), 3, 'AGG3c_ZONE_NEIGH_K5_views_3');
select is((select completions from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and municipality_id = '68001' and neighborhood_id is not null and year_month = date '2026-03-01'), 2, 'AGG3d_ZONE_NEIGH_K5_completions_2');
select is((select cta_taps    from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and municipality_id = '68001' and neighborhood_id is not null and year_month = date '2026-03-01'), 2, 'AGG3e_ZONE_NEIGH_K5_cta_taps_2');

-- bucket (NULL,NULL) de MONTH_A -- D-BUCKET: ZONE_K4 (colapsada por k) +
-- ZONE_UNRESOLVED (sin zona) FUNDIDAS en una sola fila.
select is((select impressions from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and municipality_id is null and neighborhood_id is null and year_month = date '2026-03-01'), 8, 'AGG4a_bucket_otras_zonas_MONTH_A_impressions_8_5_de_ZONE_K4_mas_3_de_UNRESOLVED');
select is((select views       from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and municipality_id is null and neighborhood_id is null and year_month = date '2026-03-01'), 5, 'AGG4b_bucket_otras_zonas_MONTH_A_views_5');
select is((select completions from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and municipality_id is null and neighborhood_id is null and year_month = date '2026-03-01'), 2, 'AGG4c_bucket_otras_zonas_MONTH_A_completions_2');
select is((select cta_taps    from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and municipality_id is null and neighborhood_id is null and year_month = date '2026-03-01'), 2, 'AGG4d_bucket_otras_zonas_MONTH_A_cta_taps_2');

-- ZONE_K4 -- 4 usuarios distintos (aunque 5 filas) -> NUNCA tiene fila propia.
select is(
  (select count(*)::int from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and municipality_id = '68002' and year_month = date '2026-03-01'),
  0,
  'AGG5_ZONE_K4_con_4_usuarios_distintos_en_5_filas_NO_tiene_fila_propia_colapso_por_usuarios_no_por_filas'
);

-- Conservación de totales del mes: suma de TODAS las filas de MONTH_A ==
-- total real sembrado a mano (18/11/6/6).
select is((select sum(impressions)::int from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and year_month = date '2026-03-01'), 18, 'AGG6a_conservacion_MONTH_A_suma_impressions_18_igual_al_total_real_sembrado');
select is((select sum(views)::int       from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and year_month = date '2026-03-01'), 11, 'AGG6b_conservacion_MONTH_A_suma_views_11');
select is((select sum(completions)::int from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and year_month = date '2026-03-01'),  6, 'AGG6c_conservacion_MONTH_A_suma_completions_6');
select is((select sum(cta_taps)::int    from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and year_month = date '2026-03-01'),  6, 'AGG6d_conservacion_MONTH_A_suma_cta_taps_6');

-- MONTH_B, AD2 -- caso NACIONAL puro (D-BUCKET): 6 usuarios distintos, cero
-- colapsados por privacidad, igual cae en (NULL,NULL) porque no hay zona.
select is((select impressions from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680302' and municipality_id is null and neighborhood_id is null and year_month = date '2026-06-01'), 6, 'MONTHB1a_nacional_puro_impressions_6');
select is((select views       from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680302' and municipality_id is null and neighborhood_id is null and year_month = date '2026-06-01'), 3, 'MONTHB1b_nacional_puro_views_3');
select is((select completions from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680302' and municipality_id is null and neighborhood_id is null and year_month = date '2026-06-01'), 1, 'MONTHB1c_nacional_puro_completions_1');
select is((select cta_taps    from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680302' and municipality_id is null and neighborhood_id is null and year_month = date '2026-06-01'), 2, 'MONTHB1d_nacional_puro_cta_taps_2');

-- MONTH_OLD, AD1 -- D-VENTANA/OLD1: un mes lejano de "hoy" y de los otros dos
-- meses del fixture también se recalcula.
select is((select impressions from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and municipality_id is null and neighborhood_id is null and year_month = date '2026-01-01'), 2, 'OLD1a_mes_viejo_2026_01_se_recalcula_impressions_2');
select is((select views       from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and municipality_id is null and neighborhood_id is null and year_month = date '2026-01-01'), 1, 'OLD1b_mes_viejo_2026_01_views_1');
select is((select completions from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and municipality_id is null and neighborhood_id is null and year_month = date '2026-01-01'), 0, 'OLD1c_mes_viejo_2026_01_completions_0');
select is((select cta_taps    from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and municipality_id is null and neighborhood_id is null and year_month = date '2026-01-01'), 1, 'OLD1d_mes_viejo_2026_01_cta_taps_1');

select is(
  (select count(*)::int from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101'),
  5,
  'TOTAL_ROWS1_5_filas_en_total_3_de_MONTH_A_mas_1_de_MONTH_B_mas_1_de_MONTH_OLD'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) RUN2 — misma corrida, SIN tocar el crudo -- IDEMPOTENCIA: recalcula y
--    sobreescribe, NUNCA suma sobre el valor previo.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_run2_68 (ok boolean, err_sqlstate text);
grant all on result_run2_68 to public;
select pg_temp.act_as(null, 'service_role');
do $$
begin
  perform public.rollup_ad_impressions_monthly();
  insert into result_run2_68 values (true, null);
exception when others then
  insert into result_run2_68 values (false, sqlstate);
end $$;
reset role;

select is((select ok from result_run2_68), true, 'RUN2_la_segunda_corrida_inmediata_no_lanza_excepcion');
select is(
  (select impressions from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and municipality_id = '68001' and neighborhood_id is null and year_month = date '2026-03-01'),
  5,
  'IDEMP1_ZONE_REAL_K5_sigue_en_5_impresiones_NO_se_duplico_a_10'
);
select is(
  (select impressions from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680302' and municipality_id is null and neighborhood_id is null and year_month = date '2026-06-01'),
  6,
  'IDEMP2_bucket_nacional_MONTH_B_sigue_en_6_impresiones_NO_se_duplico_a_12'
);
select is(
  (select count(*)::int from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101'),
  5,
  'IDEMP3_siguen_siendo_EXACTAMENTE_5_filas_correr_dos_veces_no_crea_filas_duplicadas'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) Mutaciones al crudo + RUN3 — RECALCULO HONESTO (dos sub-casos):
--    (a) una fila YA EXISTENTE se actualiza in-place (upsert por id -- el tap
--        al CTA llega después, patrón documentado en 20260817000002) --
--        prueba que el SUT RECALCULA desde el crudo, no solo suma lo nuevo;
--    (b) llega una impresión GENUINAMENTE nueva a un mes ya rolleado.
-- ════════════════════════════════════════════════════════════════════════════

-- (a) upsert sobre la fila de u2 (680802, ZONE_REAL_K5): originalmente
-- cta_tapped_at=null -> ahora recibe el tap. impressions/views no cambian
-- (mismo id, mismo viewed); cta_taps de ZONE_REAL_K5 debe subir de 2 a 3.
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  ('00000000-0000-0000-0000-000000680802', '00000000-0000-0000-0000-000000680301', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680912', gen_random_uuid(), '68001', null, '2026-03-15 10:01:00+00', 4000, true, false, '2026-03-15 12:00:00+00')
on conflict (id) do update set cta_tapped_at = excluded.cta_tapped_at;

-- (b) impresión NUEVA en MONTH_B (u26) -- el bucket nacional debe crecer.
insert into public.ad_impressions (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id, shown_at, watched_ms, viewed, completed, cta_tapped_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000680302', '00000000-0000-0000-0000-000000680101', '00000000-0000-0000-0000-000000680957', gen_random_uuid(), null, null, '2026-06-15 09:06:00+00', 4000, true, true, '2026-06-15 09:06:30+00');

create temp table result_run3_68 (ok boolean, err_sqlstate text);
grant all on result_run3_68 to public;
select pg_temp.act_as(null, 'service_role');
do $$
begin
  perform public.rollup_ad_impressions_monthly();
  insert into result_run3_68 values (true, null);
exception when others then
  insert into result_run3_68 values (false, sqlstate);
end $$;
reset role;

select is((select ok from result_run3_68), true, 'RUN3_la_tercera_corrida_tras_mutar_el_crudo_no_lanza_excepcion');

select is(
  (select cta_taps from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and municipality_id = '68001' and neighborhood_id is null and year_month = date '2026-03-01'),
  3,
  'RECALC1_ZONE_REAL_K5_cta_taps_ahora_3_el_upsert_por_id_se_reflejo_el_SUT_RECALCULA_desde_el_crudo_no_solo_suma_lo_nuevo'
);
select is(
  (select impressions from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680301' and municipality_id = '68001' and neighborhood_id is null and year_month = date '2026-03-01'),
  5,
  'RECALC2_ZONE_REAL_K5_impressions_sigue_en_5_el_upsert_no_creo_una_fila_nueva_ni_duplico_el_conteo'
);
select is(
  (select impressions from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680302' and municipality_id is null and neighborhood_id is null and year_month = date '2026-06-01'),
  7,
  'RECALC3_bucket_nacional_MONTH_B_impressions_ahora_7_la_impresion_nueva_de_u26_se_reflejo'
);
select is(
  (select views from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680302' and municipality_id is null and neighborhood_id is null and year_month = date '2026-06-01'),
  4,
  'RECALC4_bucket_nacional_MONTH_B_views_ahora_4'
);
select is(
  (select completions from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680302' and municipality_id is null and neighborhood_id is null and year_month = date '2026-06-01'),
  2,
  'RECALC5_bucket_nacional_MONTH_B_completions_ahora_2'
);
select is(
  (select cta_taps from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101' and ad_id = '00000000-0000-0000-0000-000000680302' and municipality_id is null and neighborhood_id is null and year_month = date '2026-06-01'),
  3,
  'RECALC6_bucket_nacional_MONTH_B_cta_taps_ahora_3'
);
select is(
  (select count(*)::int from public.ad_impressions_monthly where agency_id = '00000000-0000-0000-0000-000000680101'),
  5,
  'RECALC7_siguen_siendo_5_filas_en_total_las_mutaciones_no_crearon_zonas_ni_meses_nuevos'
);

select * from finish();
rollback;
