-- Rollback 0012 — Constraint: property_videos_ready_requires_storage

alter table public.property_videos
  drop constraint if exists property_videos_ready_requires_storage;
