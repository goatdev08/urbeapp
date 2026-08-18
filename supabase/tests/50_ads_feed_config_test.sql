-- Tests pgTAP — Kill-switch de publicidad en el feed (subtarea #170.1, exploración 039
-- "Tarea C"). Ejecutar con: supabase test db supabase/tests/50_ads_feed_config_test.sql --local
--
-- QUÉ cubre este archivo:
--   1) public.app_config gana 3 claves nuevas sembradas (naming CANÓNICO fijado por el plan
--      de la subtarea, NO los alias de la tarea padre "ads_every_n"/"ads_session_cap"):
--        ads_enabled (boolean, nace en FALSE -- kill-switch apagado por defecto),
--        ad_frequency_n (integer, 8), ad_max_per_session (integer, 5).
--      La siembra debe ser IDEMPOTENTE con la semántica correcta para un kill-switch:
--      `on conflict (key) do nothing` (NUNCA `do update`) -- un `do update` resetearía a
--      mano un flag que un operador ya encendió/apagó cada vez que la migración se
--      re-aplicara (bug operativo grave). Calca el patrón de video_slot_free
--      (20260720000001_stream_schema.sql:72-75) y ads_free (20260816000007:159-165).
--   2) RPC public.ads_feed_config() -- security definer, search_path fijo, grant execute a
--      authenticated. Existe porque app_config es fail-closed TAMBIÉN para el cliente
--      (20260720000001:59-67: revoke all from anon,authenticated + grant select a
--      authenticated, pero la ÚNICA policy es app_config_admin_select -> un authenticated
--      normal lee 0 filas de la tabla). La RPC expone SOLO estas 3 claves -- nunca ads_free,
--      signed_url_ttl_seconds, video_slot_free ni archived_retention_days.
--
-- Patrón de impersonación: pg_temp.act_as (igual que 02/12/26/31/41/46_*).
--
-- 🔴 GOTCHA DE ESTE ARCHIVO (verificado empíricamente antes de escribir estos tests,
-- 2026-08-17): resulta que `results_eq`/`set_eq`/`is()` de pgTAP NO atrapan una excepción
-- del tipo "function does not exist" (42883) -- a diferencia de `throws_ok`/`lives_ok`
-- (esos SÍ la atrapan, están hechos para eso). Un `select results_eq($$ select *
-- from public.ads_feed_config() $$, ...)` contra la función ausente ABORTA TODA la
-- transacción del archivo (begin/rollback es UNA sola transacción) y arrastra a "Bad
-- plan" TODOS los asserts posteriores -- exactamente el antipatrón de "falla por import,
-- no por aserción" que este protocolo prohíbe. La solución NO es un stub en `public`
-- (correría el riesgo de enmascarar la implementación real ya en GREEN, porque
-- create-or-replace-en-la-misma-transacción reemplazaría temporalmente la función real
-- durante CADA corrida del test). La solución es un wrapper LOCAL (pg_temp, se
-- descarta con el rollback del archivo) que delega en public.ads_feed_config() y
-- atrapa la excepción devolviendo una fila NULL -- así los asserts de VALOR fallan por
-- comparación (RED correcto) tanto si la función no existe como si existe pero devuelve
-- otra cosa, y en GREEN delega transparente a la función real sin alterar su
-- comportamiento. El caso "anon no puede ejecutarla" y el caso "no lanza si falta una
-- key" SÍ llaman a public.ads_feed_config() DIRECTO (sin el wrapper), envueltos en
-- throws_ok/lives_ok respectivamente -- necesitan el SQLSTATE/comportamiento real, no el
-- valor amortiguado.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ─────────────────────────
--   Happy path:
--     · las 3 claves nuevas existen con su valor EXACTO y tipo jsonb correcto
--     · ads_enabled nace en FALSE -- el test que más importa (kill-switch apagado)
--     · la RPC existe, es SECURITY DEFINER, authenticated la ejecuta y recibe los
--       defaults exactos, con la forma EXACTA (sin otras keys de app_config)
--   Ramas de reglas no obvias (🔒 del plan):
--     · anon NO puede ejecutar la RPC (fail-closed real, JWT de verdad)
--     · privilegios de catálogo: anon=[], authenticated=[EXECUTE], PUBLIC=[] (Postgres
--       otorga EXECUTE a PUBLIC por defecto al crear la función -- el revoke explícito
--       debe seguir vivo, mismo criterio que 20260816000008:44-49 / 46_*:278)
--     · la siembra es idempotente con semántica "do nothing": un flip manual del
--       operador sobrevive a un re-seed
--     · el flip se refleja en la RPC sin recompilar (mismo request, otro valor)
--   Boundary / error:
--     · si faltara una key (p.ej. borrada a mano), la RPC NO lanza y devuelve el
--       default SEGURO (ads_enabled=false) -- decisión: fail-closed, nunca fail-open

begin;
select plan(20);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- Wrapper local exception-safe (ver GOTCHA en la cabecera) -- SOLO para los asserts de
-- VALOR (results_eq/set_eq/is); nunca para "does it throw" ni para el caso anon.
create or replace function pg_temp.safe_ads_feed_config()
returns table(ads_enabled boolean, ad_frequency_n integer, ad_max_per_session integer)
language plpgsql as $$
begin
  return query select * from public.ads_feed_config();
exception when others then
  return query select null::boolean, null::integer, null::integer;
end $$;

-- Fixture: un usuario normal, NO admin (a propósito -- el gap que esta subtarea resuelve
-- es que un authenticated normal no puede leer app_config directo, ni siquiera para leer
-- el kill-switch de publicidad).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000500001', 'usuario_ads_config_50@test.local');

-- ════════════════════════════════════════════════════════════════════════════
-- 1) app_config: las 3 claves nuevas, sembradas con su valor y tipo exactos
--    (superusuario, RLS bypass -- mismo patrón que la sección 4 de 12_stream_schema_test).
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*) from public.app_config
     where key in ('ads_enabled', 'ad_frequency_n', 'ad_max_per_session'))::int,
  3,
  '1) app_config sembrada con ads_enabled, ad_frequency_n, ad_max_per_session'
);

select is(
  (select value from public.app_config where key = 'ads_enabled'),
  'false'::jsonb,
  '2) seed ads_enabled = false (jsonb)'
);
select is(
  (select value from public.app_config where key = 'ad_frequency_n'),
  '8'::jsonb,
  '3) seed ad_frequency_n = 8 (jsonb)'
);
select is(
  (select value from public.app_config where key = 'ad_max_per_session'),
  '5'::jsonb,
  '4) seed ad_max_per_session = 5 (jsonb)'
);

select is(
  (select jsonb_typeof(value) from public.app_config where key = 'ads_enabled'),
  'boolean',
  '5) ads_enabled se sembró como jsonb boolean, no como string "false"'
);
select is(
  (select jsonb_typeof(value) from public.app_config where key = 'ad_frequency_n'),
  'number',
  '6) ad_frequency_n se sembró como jsonb number'
);
select is(
  (select jsonb_typeof(value) from public.app_config where key = 'ad_max_per_session'),
  'number',
  '7) ad_max_per_session se sembró como jsonb number'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) EL TEST QUE MÁS IMPORTA: ads_enabled nace APAGADO. Un seed que lo dejara en
--    true encendería publicidad en producción viva el día del deploy.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select (value)::boolean from public.app_config where key = 'ads_enabled'),
  false,
  '8) KILL-SWITCH: ads_enabled nace en false -- NUNCA true al sembrar'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) public.ads_feed_config() existe y es SECURITY DEFINER (necesario para leer
--    app_config, que es fail-closed incluso para authenticated).
-- ════════════════════════════════════════════════════════════════════════════

select has_function(
  'public',
  'ads_feed_config',
  array[]::name[],
  '9) public.ads_feed_config() existe'
);
select is(
  (select prosecdef from pg_proc join pg_namespace ns on pg_proc.pronamespace = ns.oid
    where ns.nspname = 'public' and pg_proc.proname = 'ads_feed_config' limit 1),
  true,
  '10) ads_feed_config debe ser SECURITY DEFINER'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) authenticated SÍ puede ejecutarla (impersonación JWT real) y recibe los
--    defaults exactos sembrados en la sección 1 -- vía el wrapper exception-safe.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000500001');
select results_eq(
  $$ select * from pg_temp.safe_ads_feed_config() $$,
  $$ values (false, 8, 5) $$,
  '11) authenticated ejecuta ads_feed_config() y recibe ads_enabled=false, ad_frequency_n=8, ad_max_per_session=5'
);

-- ── 5) La forma del retorno es EXACTA -- ninguna otra key de app_config se filtra ─────
-- 🔴 FIX (post-RED, revisión del coordinador): la primera versión de este assert
-- comparaba contra pg_temp.safe_ads_feed_config() -- el WRAPPER de este mismo archivo,
-- cuyo `returns table(...)` es un literal que YO escribí. Eso significa que el test no
-- podía fallar NUNCA (ni en RED ni en GREEN): si la RPC real devolviera una 4ª columna
-- (p.ej. ads_free) o renombrara una, `select * from public.ads_feed_config()` dentro del
-- wrapper reventaría por incompatibilidad de columnas, el propio `exception when others`
-- lo atraparía, devolvería la fila NULL -- y `jsonb_object_keys` seguiría entregando las
-- 3 claves que el WRAPPER declara, no las que la función real expone. Antiseal exacto de
-- lo que 169 cazó cuatro veces: aserción contra una constante del andamiaje, no contra el
-- SUT. Arreglo: leer la firma REAL del catálogo (pg_get_function_result), que además es
-- exception-safe por sí sola (si la función no existe, la subquery da 0 filas -> is()
-- compara NULL contra el literal esperado -> falla limpio, sin abortar la transacción --
-- verificado empíricamente antes de fijar este patrón).
select is(
  (select pg_get_function_result(p.oid)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ads_feed_config'),
  'TABLE(ads_enabled boolean, ad_frequency_n integer, ad_max_per_session integer)',
  '12) ads_feed_config() expone EXACTAMENTE ads_enabled boolean, ad_frequency_n integer, ad_max_per_session integer -- ni una columna de más (ads_free), de menos, renombrada ni retipada -- nunca ads_free, signed_url_ttl_seconds, video_slot_free ni archived_retention_days'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Privilegios de catálogo (belt-and-suspenders del punto 4, mismo criterio que
--    46_org_advertising_test.sql WRAP3-6): anon y PUBLIC sin EXECUTE, authenticated con.
-- ════════════════════════════════════════════════════════════════════════════

select function_privs_are('public', 'ads_feed_config', array[]::name[], 'anon', array[]::name[],
  '13) ads_feed_config: anon SIN EXECUTE (catálogo)');
select function_privs_are('public', 'ads_feed_config', array[]::name[], 'authenticated', array['EXECUTE']::name[],
  '14) ads_feed_config: authenticated SÍ tiene EXECUTE (catálogo)');
select function_privs_are('public', 'ads_feed_config', array[]::name[], 'public', array[]::name[],
  '15) ads_feed_config: PUBLIC (pseudo-rol) SIN EXECUTE -- Postgres otorga EXECUTE a PUBLIC por defecto al crear la función, el revoke explícito debe seguir vivo');

-- ════════════════════════════════════════════════════════════════════════════
-- 7) 🔒 anon NO puede ejecutarla -- impersonación JWT real, SQLSTATE explícito
--    (42501 = permission denied; NO usar throws_ok(sql, null, ...) que "pasa" con
--    CUALQUIER excepción, incluida 42883 función-no-existe -- eso seguiría "pasando"
--    aunque la RPC nunca se construya).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select public.ads_feed_config() $$,
  '42501',
  null,
  '16) anon no puede ejecutar ads_feed_config() (permission denied, 42501)'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 8) El flip se refleja en la RPC SIN recompilar.
--
-- 🔴 LIMITACIÓN DE ESTE ASSERT (fix post-revisión del guardián, GREEN de #170.1):
-- el statement `insert ... on conflict (key) do nothing` de aquí abajo es un LITERAL
-- escrito a mano en el test, NO una re-ejecución de la migración real. El runner de
-- `supabase test db` solo monta el archivo de test -- NO monta `supabase/migrations/`
-- (se probó `\i` contra la migración real y no aplica en este runner) -- así que el
-- test 17 NO puede ejercer el SUT (el seed de la migración) para esta afirmación.
-- Lo único que el assert 17 verifica es la semántica de Postgres para
-- `on conflict (key) do nothing` en general (que un valor existente sobrevive) --
-- eso NUNCA puede fallar, sin importar qué escriba la migración real. El guardián lo
-- demostró por mutación: mutar la migración a `on conflict (key) do update` y el
-- archivo siguió en 20/20 -- exactamente el antipatrón del test 12 original (aserción
-- contra una constante del andamiaje, no contra el SUT), con otra ropa.
--
-- Por qué NO se cablea al SUT (decisión del orquestador, no de este archivo): extraer
-- el seed a una función `private.*` solo para poder testearla agrega superficie de
-- producción por testabilidad (viola la escalera de `ponytail`), y el escenario que
-- el mutante ejercita -- editar una migración YA aplicada -- no es un camino de
-- despliegue real: las migraciones son append-only; un futuro re-seed sería OTRO
-- archivo de migración, con sus PROPIOS tests pgTAP -- ésa es la protección real
-- contra un `do update` que resetee el flip del operador, no este assert.
--
-- Lo que el assert 17 SÍ verifica, honestamente: la semántica ELEGIDA para un
-- kill-switch (`do nothing`, nunca `do update`) preserva un valor existente si algo
-- alguna vez re-ejecuta ese literal exacto. Documenta la semántica requerida y sirve
-- de referencia para quien escriba la migración (y cualquier migración de re-seed
-- futura), pero NO es evidencia de que la migración real la use.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
update public.app_config set value = 'true'::jsonb where key = 'ads_enabled';
reset role;

-- Literal de referencia (NO es la migración real -- ver limitación arriba):
insert into public.app_config (key, value) values
  ('ads_enabled',        'false'::jsonb),
  ('ad_frequency_n',     '8'::jsonb),
  ('ad_max_per_session', '5'::jsonb)
on conflict (key) do nothing;

select is(
  (select (value)::boolean from public.app_config where key = 'ads_enabled'),
  true,
  '17) semántica DO NOTHING (no ejerce el seed real de la migración -- ver comentario arriba): re-aplicar el literal de referencia con on conflict do nothing preserva un valor existente -- ads_enabled sigue en true'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000500001');
select is(
  (select ads_enabled from pg_temp.safe_ads_feed_config()),
  true,
  '18) el flip de ads_enabled se refleja en ads_feed_config() de inmediato -- config en runtime, no una constante compilada'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 9) Boundary: si faltara una key (borrada a mano), la RPC falla CERRADO
--    (default seguro = apagado), nunca abierto. No lanza.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
delete from public.app_config where key = 'ads_enabled';
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000500001');
select lives_ok(
  $$ select public.ads_feed_config() $$,
  '19) ads_feed_config() no lanza aunque falte la key ads_enabled en app_config'
);
select is(
  (select ads_enabled from pg_temp.safe_ads_feed_config()),
  false,
  '20) DEFAULT SEGURO: si ads_enabled falta en app_config, ads_feed_config() devuelve false (fail-closed), nunca true (fail-open)'
);
reset role;

select * from finish();
rollback;
