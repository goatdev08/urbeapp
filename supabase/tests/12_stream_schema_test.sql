-- Tests pgTAP — Migración aditiva de schema para el ciclo Cloudflare Stream (Épica B, tarea 68.2)
-- Ejecutar con: supabase test db
-- Cubre: enum property_video_status gana 'archived'; columnas nuevas nullable (aditivo) en
--   property_videos; tabla public.app_config sembrada y fail-closed (solo admin/service_role lee).
-- Patrón de impersonación: set local role + request.jwt.claims (igual que 02_rls_test / 04_profile_photos).

begin;
select plan(17);

-- 🔴 GOTCHA reconciliado (subtarea #169.3, 2026-08-16): el assert de la
-- sección 6 (línea ~68) fijaba count(*)=3 SIN filtro sobre app_config. La
-- migración 20260816000005_ads_schema.sql (169.3) siembra una 4ª clave
-- ('ads_free', calco de video_slot_free) -- ese count(*) crudo se cae en
-- cuanto la siembra existe. Es reconciliación de fixture (el admin ahora ve
-- 4 filas reales, comportamiento correcto), NO debilitamiento del test: la
-- línea de arriba (~38), que cuenta `where key in (...)` explícito sobre las
-- 3 claves viejas, NO se toca -- sigue siendo la aserción con dientes contra
-- un seed accidentalmente distinto. Antipatrón evitado en el archivo NUEVO de
-- esta subtarea (49_grant_ad_slot_atomic_test.sql): todo count(*) ahí filtra
-- por sus propias fixtures (derivada #175, el count(*) absoluto sin filtro).

-- ── 1) El enum gana el valor 'archived' (aditivo, no destructivo) ─────────────
select ok(
  'archived' = any(enum_range(null::property_video_status)::text[]),
  'enum property_video_status incluye archived'
);
-- ...y conserva los valores previos (no se rompió nada).
select ok(
  (array['uploading','processing','ready','failed'] <@ enum_range(null::property_video_status)::text[]),
  'enum property_video_status conserva uploading/processing/ready/failed'
);

-- ── 2) Columnas nuevas existen en property_videos ─────────────────────────────
select has_column('public', 'property_videos', 'tus_upload_url', 'property_videos.tus_upload_url existe');
select has_column('public', 'property_videos', 'thumbnail_pct', 'property_videos.thumbnail_pct existe');
select has_column('public', 'property_videos', 'archived_at', 'property_videos.archived_at existe');
select has_column('public', 'property_videos', 'r2_archive_key', 'property_videos.r2_archive_key existe');

-- ── 3) Las columnas nuevas son NULLABLE (migración aditiva: no rompe filas existentes) ─
select col_is_null('public', 'property_videos', 'tus_upload_url', 'tus_upload_url es nullable');
select col_is_null('public', 'property_videos', 'thumbnail_pct', 'thumbnail_pct es nullable');
select col_is_null('public', 'property_videos', 'archived_at', 'archived_at es nullable');
select col_is_null('public', 'property_videos', 'r2_archive_key', 'r2_archive_key es nullable');

-- ── 4) public.app_config existe y está sembrada con las 3 claves ──────────────
select has_table('public', 'app_config', 'tabla public.app_config existe');
-- Como superusuario (RLS bypass) se ven las filas sembradas.
select is(
  (select count(*) from public.app_config
     where key in ('video_slot_free', 'archived_retention_days', 'signed_url_ttl_seconds'))::int,
  3,
  'app_config sembrada con video_slot_free, archived_retention_days, signed_url_ttl_seconds'
);
-- ...y con los VALORES esperados (un cambio accidental del seed debe fallar aquí).
select is((select value from public.app_config where key = 'video_slot_free'),         'true'::jsonb,  'seed video_slot_free = true');
select is((select value from public.app_config where key = 'archived_retention_days'), '7'::jsonb,     'seed archived_retention_days = 7');
select is((select value from public.app_config where key = 'signed_url_ttl_seconds'),  '14400'::jsonb, 'seed signed_url_ttl_seconds = 14400');

-- ── 5) app_config es fail-closed: un usuario normal (authenticated) NO lee nada ─
-- Fixtures de rol: el trigger handle_new_user crea public.users.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000cf001', 'normal@test.local'),
  ('00000000-0000-0000-0000-0000000cf002', 'admin@test.local');
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-0000000cf002';

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000cf001');
select is((select count(*) from public.app_config)::int, 0, 'usuario normal (authenticated) no lee app_config');
reset role;

-- ── 6) El admin SÍ lee app_config (canal de gestión) ──────────────────────────
select pg_temp.act_as('00000000-0000-0000-0000-0000000cf002');
-- 3 -> 4 (subtarea #169.3): la siembra de app_config.ads_free agrega una 4ª
-- fila real. Ver comentario de cabecera "GOTCHA reconciliado" arriba.
select is((select count(*) from public.app_config)::int, 4, 'admin lee app_config');
reset role;

select * from finish();
rollback;
