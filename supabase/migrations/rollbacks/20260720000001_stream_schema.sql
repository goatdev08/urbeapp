-- Rollback 20260720000001 — Schema aditivo Cloudflare Stream (tarea 68.2)
-- Revierte lo reversible. NOTA: Postgres NO permite eliminar un valor de un enum
-- (ALTER TYPE ... DROP VALUE no existe), por lo que 'archived' permanece en
-- property_video_status. Es inofensivo: sin filas que lo usen, es un valor muerto.
-- Si se requiere eliminarlo por completo hay que recrear el tipo (fuera de alcance del rollback).

drop table if exists public.app_config;

alter table public.property_videos
  drop constraint if exists property_videos_thumbnail_pct_range;

alter table public.property_videos
  drop column if exists tus_upload_url,
  drop column if exists thumbnail_pct,
  drop column if exists archived_at,
  drop column if exists r2_archive_key;

-- 'archived' en el enum property_video_status: NO removible (ver nota arriba).
