-- Rollback de 20260721000002_property_videos_archived_requires_r2.sql

alter table public.property_videos
  drop constraint if exists property_videos_archived_requires_r2;
