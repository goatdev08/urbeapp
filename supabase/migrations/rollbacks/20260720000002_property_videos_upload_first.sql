-- Rollback 20260720000002 — property_videos upload-first (tarea 68.3)
-- NOTA: restaurar property_id NOT NULL falla si existen videos en vuelo (property_id null).
--   Limpiar/enlazar esas filas antes de revertir. Para un rollback limpio (sin uploads en vuelo)
--   funciona directo.

alter table public.property_videos
  drop constraint if exists property_videos_attributable;

drop index if exists public.property_videos_agent_status_idx;

alter table public.property_videos
  drop column if exists agent_id;

-- Restaurar el NOT NULL original (falla si hay filas con property_id null pendientes).
alter table public.property_videos alter column property_id set not null;
