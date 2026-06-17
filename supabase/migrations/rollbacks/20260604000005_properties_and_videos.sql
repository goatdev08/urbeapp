-- Rollback 0005
drop trigger if exists cascade_soft_delete_videos on public.properties;
drop trigger if exists enforce_max_videos on public.property_videos;
drop function if exists public.cascade_soft_delete_property_videos();
drop function if exists public.enforce_max_videos_per_property();
drop table if exists public.property_videos cascade;
drop table if exists public.properties cascade;
