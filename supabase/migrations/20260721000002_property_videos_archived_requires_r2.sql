-- Migración 20260721000002 — CHECK anti-pérdida: archived requiere copia en R2 (tarea 68.8)
-- Propósito (2ª capa de integridad, la EF archive-video ya lo garantiza en la 1ª capa):
--   un video NO puede quedar en status='archived' sin que su copia en Cloudflare R2
--   (r2_archive_key) y el timestamp de archivado (archived_at) estén registrados.
--   Si esto pasara (bug en la EF, UPDATE manual, migración futura descuidada), se
--   perdería la referencia al único lugar donde sobrevive el video original — el CHECK
--   lo bloquea en el motor, no solo en la capa de aplicación.
--
-- No aplica a ningún otro status (uploading/processing/ready/failed): esas filas pueden
-- tener r2_archive_key/archived_at NULL sin problema.
--
-- Idempotente: drop constraint if exists + add constraint.
-- Rollback: supabase/migrations/rollbacks/20260721000002_property_videos_archived_requires_r2.sql

alter table public.property_videos
  drop constraint if exists property_videos_archived_requires_r2;
alter table public.property_videos
  add constraint property_videos_archived_requires_r2
    check (status <> 'archived' or (r2_archive_key is not null and archived_at is not null));

comment on constraint property_videos_archived_requires_r2 on public.property_videos is
  'Anti-pérdida: un video archived debe tener r2_archive_key y archived_at (la copia en R2 es la única referencia al original tras liberar Stream).';
