-- Migración 0012 — Constraint: property_videos_ready_requires_storage
-- Propósito: garantiza que un video con status='ready' tenga al menos una referencia de almacenamiento
--   (storage_path en Supabase Storage o cloudflare_uid en Cloudflare Stream).
-- Tarea #4, subtarea 4.2. Demo: aplica tanto al camino legacy (cloudflare_uid) como al nuevo (storage_path).
-- Espeja el patrón de property_closed_requires_reason (migración 0005).
-- Enum property_video_status = ('uploading', 'processing', 'ready', 'failed').
-- Invariante: status <> 'ready' OR storage_path IS NOT NULL OR cloudflare_uid IS NOT NULL.

-- Idempotente: eliminar primero si ya existe, luego recrear.
alter table public.property_videos
  drop constraint if exists property_videos_ready_requires_storage;

-- Un video puede estar en uploading/processing/failed sin referencia,
-- pero NO puede estar 'ready' sin al menos una de (storage_path, cloudflare_uid).
alter table public.property_videos
  add constraint property_videos_ready_requires_storage
    check (status <> 'ready' or storage_path is not null or cloudflare_uid is not null);
