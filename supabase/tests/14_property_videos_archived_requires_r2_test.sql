-- Tests pgTAP — CHECK property_videos_archived_requires_r2 (tarea 68.8, Superficie A)
-- Ejecutar con: supabase test db
-- Invariante bajo test (2ª capa de seguridad, protege contra pérdida de datos):
--   un video NO puede marcarse 'archived' sin que su copia en R2 (r2_archive_key)
--   y el timestamp (archived_at) estén registrados.
--   CHECK: status <> 'archived' OR (r2_archive_key IS NOT NULL AND archived_at IS NOT NULL)
-- La migración que crea este CHECK (20260721000002_property_videos_archived_requires_r2.sql)
-- es GREEN — NO existe todavía. Por eso HOY (RED) los throws_ok de abajo FALLAN: el UPDATE
-- a 'archived' sin r2_archive_key/archived_at pasa sin error porque el constraint no existe.
-- Patrón de fixtures: igual que 13_property_videos_upload_first_test.sql (upload-first,
-- property_id NULL + agent_id, sin necesidad de crear properties/agencies completas).

begin;
select plan(7);

-- ── Fixtures: un agente dueño de los videos en vuelo ──────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000014a1', 'agente_archive@test.local');
update public.users set role = 'agent' where id = '00000000-0000-0000-0000-0000000014a1';

-- ── 1) 'ready' con cloudflare_uid y SIN r2_archive_key → válida ───────────────
-- El CHECK archived_requires_r2 no aplica a filas no-archived: r2_archive_key
-- puede estar NULL mientras el video sigue 'ready' en Cloudflare Stream.
select lives_ok($$
  insert into public.property_videos
    (id, property_id, agent_id, status, position, cloudflare_uid, r2_archive_key, archived_at)
  values
    ('00000000-0000-0000-0000-00000000b501', null, '00000000-0000-0000-0000-0000000014a1',
     'ready', 1, 'cf-archive-b501', null, null)
$$, 'property_videos: ready con cloudflare_uid y sin r2_archive_key es válido (CHECK no aplica)');

-- ── 2) UPDATE a 'archived' con r2_archive_key + archived_at no nulos → OK ─────
insert into public.property_videos
    (id, property_id, agent_id, status, position, cloudflare_uid, r2_archive_key, archived_at)
  values
    ('00000000-0000-0000-0000-00000000b502', null, '00000000-0000-0000-0000-0000000014a1',
     'ready', 2, 'cf-archive-b502', null, null);
select lives_ok($$
  update public.property_videos
     set status = 'archived',
         r2_archive_key = 'archive/cf-archive-b502.mp4',
         archived_at = now()
   where id = '00000000-0000-0000-0000-00000000b502'
$$, 'property_videos: archived con r2_archive_key y archived_at ambos set es aceptado');

-- ── 3) UPDATE a 'archived' con r2_archive_key NULL → falla el CHECK ───────────
-- RED: hoy este UPDATE pasa sin error (el constraint aún no existe) → el throws_ok falla.
insert into public.property_videos
    (id, property_id, agent_id, status, position, cloudflare_uid, r2_archive_key, archived_at)
  values
    ('00000000-0000-0000-0000-00000000b503', null, '00000000-0000-0000-0000-0000000014a1',
     'ready', 3, 'cf-archive-b503', null, null);
select throws_ok($$
  update public.property_videos
     set status = 'archived',
         r2_archive_key = null,
         archived_at = now()
   where id = '00000000-0000-0000-0000-00000000b503'
$$, '23514', null,
  'property_videos: archived sin r2_archive_key viola el CHECK archived_requires_r2');

-- ── 4) UPDATE a 'archived' con archived_at NULL → falla el CHECK ──────────────
-- RED: hoy este UPDATE pasa sin error (el constraint aún no existe) → el throws_ok falla.
insert into public.property_videos
    (id, property_id, agent_id, status, position, cloudflare_uid, r2_archive_key, archived_at)
  values
    ('00000000-0000-0000-0000-00000000b504', null, '00000000-0000-0000-0000-0000000014a1',
     'ready', 4, 'cf-archive-b504', null, null);
select throws_ok($$
  update public.property_videos
     set status = 'archived',
         r2_archive_key = 'archive/cf-archive-b504.mp4',
         archived_at = null
   where id = '00000000-0000-0000-0000-00000000b504'
$$, '23514', null,
  'property_videos: archived sin archived_at viola el CHECK archived_requires_r2');

-- ── 5) UPDATE a 'archived' con AMBOS nulos → falla el CHECK ───────────────────
-- RED: hoy este UPDATE pasa sin error (el constraint aún no existe) → el throws_ok falla.
insert into public.property_videos
    (id, property_id, agent_id, status, position, cloudflare_uid, r2_archive_key, archived_at)
  values
    ('00000000-0000-0000-0000-00000000b505', null, '00000000-0000-0000-0000-0000000014a1',
     'ready', 5, 'cf-archive-b505', null, null);
select throws_ok($$
  update public.property_videos
     set status = 'archived',
         r2_archive_key = null,
         archived_at = null
   where id = '00000000-0000-0000-0000-00000000b505'
$$, '23514', null,
  'property_videos: archived sin r2_archive_key NI archived_at viola el CHECK');

-- ── 6) Round-trip/idempotencia: re-aplicar los MISMOS valores archived a una
--    fila ya archivada (re-invocación idempotente de mark_archived) sigue OK ───
select lives_ok($$
  update public.property_videos
     set status = 'archived',
         r2_archive_key = 'archive/cf-archive-b502.mp4',
         archived_at = now()
   where id = '00000000-0000-0000-0000-00000000b502'
$$, 'property_videos: re-marcar archived (idempotente) con refs presentes sigue siendo válido');

-- ── 7) El CHECK NO aplica a otros estados: 'failed' con ambas columnas NULL OK ─
insert into public.property_videos
    (id, property_id, agent_id, status, position, cloudflare_uid, r2_archive_key, archived_at)
  values
    ('00000000-0000-0000-0000-00000000b507', null, '00000000-0000-0000-0000-0000000014a1',
     'failed', 1, null, null, null);
select lives_ok($$
  update public.property_videos set failure_reason = 'stream_error' where id = '00000000-0000-0000-0000-00000000b507'
$$, 'property_videos: el CHECK archived_requires_r2 no restringe filas failed');

select * from finish();
rollback;
