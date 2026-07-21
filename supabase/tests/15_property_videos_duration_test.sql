-- Tests pgTAP — property_videos.duration_seconds pasa de integer a numeric (Épica B, 68.13)
-- Ejecutar con: supabase test db
--
-- ⚠️ DESCUBRIMIENTO IMPORTANTE (documentado aquí porque cambia el alcance de la migración
-- GREEN de esta subtarea): la columna `duration_seconds` NO es nueva — ya existe desde el
-- schema base (20260604000005_properties_and_videos.sql, línea ~79) como
-- `duration_seconds int check (duration_seconds is null or duration_seconds >= 0)`,
-- pensada originalmente para el pipeline legacy de Supabase Storage. Por lo tanto:
--   · has_column / col_is_null / el CHECK >= 0 YA PASAN hoy — NO son el driver de RED aquí.
--   · El gap real para portada Stream: Cloudflare Stream reporta `duration` con fracción de
--     segundo (p.ej. 92.3), y hoy la columna es `integer` → el valor se REDONDEA en el
--     INSERT/UPDATE (87.5 se guarda como 88), perdiendo precisión para la conversión
--     thumbnail_pct (%) → segundos exactos que usa el render de portada.
--   · La migración 20260721000003_property_videos_duration.sql debe hacer
--     ALTER COLUMN duration_seconds TYPE numeric (ensanchar el tipo, no "add column";
--     un "add column if not exists" sería no-op porque la columna ya existe) y preservar
--     el mismo CHECK (>= 0 o NULL) — el nombre de constraint autogenerado hoy ya es
--     `property_videos_duration_seconds_check`, así que "drop constraint if exists
--     property_videos_duration_seconds_check + add constraint" con ese mismo nombre encaja.
--   · Ver supabase/functions/stream-webhook/handler.test.ts para los tests RED del webhook
--     que puebla esta columna con el `duration` exacto del payload 'ready' de Stream.
--
-- Patrón de fixtures: igual que 12_stream_schema_test.sql / 14_property_videos_archived_
-- requires_r2_test.sql (upload-first: property_id NULL + agent_id).

begin;
select plan(11);

-- ── 1) Sanity: la columna existe (YA existía antes de esta subtarea) ─────────
select has_column('public', 'property_videos', 'duration_seconds',
  'property_videos.duration_seconds existe');

-- ── 2) Sanity: es NULLABLE (video en vuelo aún no tiene duración de Stream) ──
select col_is_null('public', 'property_videos', 'duration_seconds',
  'duration_seconds es nullable');

-- ── 3) EL GAP REAL: el tipo debe ser numeric, no integer ──────────────────────
-- RED hoy: col_type_is falla porque el tipo actual es 'integer' (schema base, sin
-- fracción de segundo). La migración GREEN debe ensanchar a numeric.
select col_type_is('public', 'property_videos', 'duration_seconds', 'numeric',
  'duration_seconds es numeric (preserva fracción de segundo que reporta Cloudflare Stream)');

-- ── Fixtures: un agente dueño de videos en vuelo ──────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000015a1', 'agente_duration@test.local');
update public.users set role = 'agent' where id = '00000000-0000-0000-0000-0000000015a1';

-- ── 4) RED: round-trip fraccionario — 87.5 debe guardarse EXACTO, no redondeado ─
-- Hoy (columna integer) se guarda como 88: este assert falla contra el valor esperado.
insert into public.property_videos
    (id, property_id, agent_id, status, position, cloudflare_uid, duration_seconds)
  values
    ('00000000-0000-0000-0000-00000000c504', null, '00000000-0000-0000-0000-0000000015a1',
     'ready', 4, 'cf-duration-c504', 87.5);
-- Cast explícito a numeric en el SELECT: evita ambigüedad de sobrecarga de is() cuando
-- la columna todavía es integer (RED); una vez migrada a numeric el cast es un no-op.
select is(
  (select duration_seconds::numeric from public.property_videos where id = '00000000-0000-0000-0000-00000000c504'),
  87.5::numeric,
  'duration_seconds = 87.5 se guarda EXACTO (fracción de segundo, no redondeado a 88)');

-- ── 5) RED: round-trip fraccionario con el valor exacto que usa el webhook (92.3) ─
insert into public.property_videos
    (id, property_id, agent_id, status, position, cloudflare_uid, duration_seconds)
  values
    ('00000000-0000-0000-0000-00000000c505', null, '00000000-0000-0000-0000-0000000015a1',
     'ready', 5, 'cf-duration-c505', 92.3);
select is(
  (select duration_seconds::numeric from public.property_videos where id = '00000000-0000-0000-0000-00000000c505'),
  92.3::numeric,
  'duration_seconds = 92.3 se guarda EXACTO (mismo valor que puebla stream-webhook en ready)');

-- ── 6) Regresión: el CHECK >= 0 sigue vigente tras ensanchar el tipo ──────────
select throws_ok($$
  insert into public.property_videos
    (id, property_id, agent_id, status, position, cloudflare_uid, duration_seconds)
  values
    ('00000000-0000-0000-0000-00000000c501', null, '00000000-0000-0000-0000-0000000015a1',
     'ready', 1, 'cf-duration-c501', -1)
$$, '23514', null,
  'property_videos: duration_seconds negativo (-1) sigue violando el CHECK tras el ALTER TYPE');

select throws_ok($$
  insert into public.property_videos
    (id, property_id, agent_id, status, position, cloudflare_uid, duration_seconds)
  values
    ('00000000-0000-0000-0000-00000000c502', null, '00000000-0000-0000-0000-0000000015a1',
     'ready', 2, 'cf-duration-c502', -0.5)
$$, '23514', null,
  'property_videos: duration_seconds negativo fraccionario (-0.5) viola el CHECK (antes se redondeaba a -1 con integer; con numeric debe rechazar el valor EXACTO -0.5)');

-- ── 7) Boundary: 0 y NULL siguen aceptados ────────────────────────────────────
select lives_ok($$
  insert into public.property_videos
    (id, property_id, agent_id, status, position, cloudflare_uid, duration_seconds)
  values
    ('00000000-0000-0000-0000-00000000c503', null, '00000000-0000-0000-0000-0000000015a1',
     'ready', 3, 'cf-duration-c503', 0)
$$, 'property_videos: duration_seconds = 0 es aceptado (boundary)');

select lives_ok($$
  insert into public.property_videos
    (id, property_id, agent_id, status, position, cloudflare_uid, duration_seconds)
  values
    ('00000000-0000-0000-0000-00000000c506', null, '00000000-0000-0000-0000-0000000015a1',
     'uploading', 5, 'cf-duration-c506', null)
$$, 'property_videos: duration_seconds NULL (video en vuelo) es aceptado');

-- ── 8) Aditividad: columnas previas del ciclo Stream siguen existiendo ────────
select has_column('public', 'property_videos', 'thumbnail_pct',
  'thumbnail_pct sigue existiendo (el ALTER TYPE no toca otras columnas)');
select has_column('public', 'property_videos', 'cloudflare_uid',
  'cloudflare_uid sigue existiendo (el ALTER TYPE no toca otras columnas)');

select * from finish();
rollback;
