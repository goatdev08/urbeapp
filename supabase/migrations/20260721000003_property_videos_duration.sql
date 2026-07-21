-- Migración 20260721000003 — property_videos.duration_seconds: integer → numeric (Épica B Stream, 68.13)
-- La columna YA EXISTE desde el schema base (20260604000005_properties_and_videos.sql, ~L79)
-- como `duration_seconds int check (duration_seconds is null or duration_seconds >= 0)`,
-- pensada originalmente para el pipeline legacy de Supabase Storage.
--
-- Gap que cierra esta migración: Cloudflare Stream reporta `duration` con fracción de
-- segundo (p.ej. 92.3) en el payload 'ready' del webhook. Con la columna integer ese valor
-- se REDONDEA en el INSERT/UPDATE (87.5 -> 88), perdiendo precisión para la conversión
-- thumbnail_pct (%) -> segundos exactos que usa el render de portada. Por eso se ENSANCHA
-- el tipo (integer -> numeric) en vez de agregar una columna nueva.
--
-- Idempotente: `alter column ... type numeric` es no-op si ya es numeric (se puede re-correr).
-- El CHECK se reafirma con drop/add bajo el mismo nombre autogenerado que ya tenía la
-- columna (property_videos_duration_seconds_check), igual patrón que 12/14.
-- Rollback: rollbacks/20260721000003_property_videos_duration.sql.

alter table public.property_videos
  alter column duration_seconds type numeric using duration_seconds::numeric;

alter table public.property_videos
  drop constraint if exists property_videos_duration_seconds_check;
alter table public.property_videos
  add constraint property_videos_duration_seconds_check
    check (duration_seconds is null or duration_seconds >= 0);

comment on column public.property_videos.duration_seconds is
  'Duración exacta (segundos, fraccional) que reporta Cloudflare Stream al quedar ready. Usada para convertir thumbnail_pct (%) -> segundos en el render de portada. NULL mientras el video está en vuelo (uploading/processing) o para filas legacy sin duración conocida.';
