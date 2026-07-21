-- Rollback 20260721000003 — property_videos.duration_seconds: numeric → integer (tarea 68.13)
-- NOTA: revertir numeric -> integer REDONDEA cualquier duración fraccionaria ya guardada
--   (p.ej. 92.3 -> 92) — es una operación con pérdida de precisión, no simétrica con la
--   migración GREEN. Solo revertir si de verdad hace falta volver al pipeline legacy.

alter table public.property_videos
  alter column duration_seconds type integer using round(duration_seconds)::integer;

alter table public.property_videos
  drop constraint if exists property_videos_duration_seconds_check;
alter table public.property_videos
  add constraint property_videos_duration_seconds_check
    check (duration_seconds is null or duration_seconds >= 0);

comment on column public.property_videos.duration_seconds is null;
