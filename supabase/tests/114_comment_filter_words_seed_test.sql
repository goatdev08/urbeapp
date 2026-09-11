-- Tests pgTAP — Semilla comment_filter_words en public.app_config (subtarea 289.5, tarea #289)
-- Ejecutar con: supabase test db
-- Cubre: la migración GREEN 20260910400001_seed_comment_filter_words.sql siembra la
--   key 'comment_filter_words' (jsonb array vacío) que el ConfigReader de la Edge
--   Function post-comment lee (fail-open si falta/falla, ver post-comment/types.ts).
-- Patrón de impersonación: pg_temp.act_as (set local role + request.jwt.claims), calco
--   de supabase/tests/12_stream_schema_test.sql (misma tabla, mismo régimen fail-closed:
--   RLS de 20260720000001 — anon SIN grant en absoluto, authenticated con SELECT gateado
--   por private.is_admin(); service_role/superuser bypassa RLS).
-- 🔴 RED (289.5): la migración semilla NO existe todavía — los asserts 1-3 y 6 fallan
--   por diseño (key inexistente) hasta que GREEN la agregue.

begin;
select plan(6);

-- ── 1) La key existe, sembrada por la migración GREEN (bypass RLS: rol de la sesión
--    de pgTAP es owner/superuser de la tabla, igual que 12_stream_schema_test.sql) ──
select is(
  (select count(*) from public.app_config where key = 'comment_filter_words')::int,
  1,
  'SEED1_comment_filter_words_existe_en_app_config'
);

-- ── 2) El valor es un array jsonb (NO un string, NO un objeto) ────────────────
select is(
  jsonb_typeof((select value from public.app_config where key = 'comment_filter_words')),
  'array',
  'SEED2_value_de_comment_filter_words_es_un_array_jsonb'
);

-- ── 3) El valor sembrado es el array vacío '[]' (arranca sin palabras prohibidas;
--    un cambio accidental del seed debe fallar aquí, mismo criterio que
--    12_stream_schema_test.sql §4) ────────────────────────────────────────────
select is(
  (select value from public.app_config where key = 'comment_filter_words'),
  '[]'::jsonb,
  'SEED3_seed_comment_filter_words_es_array_vacio'
);

-- ── Fixtures de rol + helper de impersonación (definidos antes del primer uso) ──
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000114a1', 'normal-114@test.local'),
  ('00000000-0000-0000-0000-0000000114a2', 'admin-114@test.local');
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-0000000114a2';

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ── 4) app_config es fail-closed para anon: SIN grant en absoluto (42501, no "RLS
--    filtra a 0 filas") — mismo régimen que TODA la tabla desde 20260720000001 ──
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select count(*) from public.app_config where key = 'comment_filter_words' $$,
  '42501',
  null,
  'GRANT1_anon_no_puede_leer_app_config_permission_denied'
);
reset role;

-- ── 5) Un usuario authenticated normal (no admin) NO ve la fila (RLS: private.is_admin()) ──
select pg_temp.act_as('00000000-0000-0000-0000-0000000114a1');
select is(
  (select count(*) from public.app_config where key = 'comment_filter_words')::int,
  0,
  'GRANT2_authenticated_normal_no_ve_comment_filter_words'
);
reset role;

-- ── 6) El admin SÍ la ve, con el valor sembrado (canal de gestión, RLS lo permite) ──
select pg_temp.act_as('00000000-0000-0000-0000-0000000114a2');
select is(
  (select value from public.app_config where key = 'comment_filter_words'),
  '[]'::jsonb,
  'GRANT3_authenticated_admin_lee_comment_filter_words_con_su_valor'
);
reset role;

select * from finish();
rollback;
