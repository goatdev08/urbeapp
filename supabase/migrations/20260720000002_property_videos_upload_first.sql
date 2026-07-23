-- Migración 20260720000002 — property_videos upload-first (Épica B Stream, tarea 68.3)
-- El video se sube a Cloudflare Stream ANTES de que exista la propiedad (Direct Creator Upload).
-- Por eso el video en vuelo no tiene property_id todavía; se enlaza al publicar.
--
-- Cambios (aditivos, no rompen filas existentes — todas tienen property_id NOT NULL hoy):
--   1) property_id pasa a NULLABLE (video en vuelo sin propiedad aún).
--   2) +agent_id (dueño del upload en vuelo) → habilita el invariante de concurrencia POR AGENTE
--      (mint-upload-url rechaza si el agente ya tiene 1 video en uploading/processing).
--   3) índice parcial (agent_id, status) para esa query de concurrencia.
--   4) CHECK de atribución: todo video debe tener property_id O agent_id (nunca ambos nulos) —
--      cierra el hueco de una fila huérfana no atribuible a nadie.
--
-- El trigger enforce_max_videos (0005) tolera property_id NULL: `count where property_id = NULL`
--   nunca matchea → cuenta 0 → no bloquea el upload en vuelo (el tope de 5 es por propiedad).
-- Idempotente. Rollback: rollbacks/20260720000002_property_videos_upload_first.sql.

-- 1) property_id nullable
alter table public.property_videos alter column property_id drop not null;

-- 2) agent_id (nullable = aditivo; filas legacy quedan null y quedan cubiertas por property_id)
alter table public.property_videos
  add column if not exists agent_id uuid references public.users (id) on delete cascade;
comment on column public.property_videos.agent_id is
  'Agente dueño del video en vuelo (subido antes de existir la propiedad). Base del invariante de concurrencia por agente.';

-- 3) índice de soporte para la query de concurrencia por agente
create index if not exists property_videos_agent_status_idx
  on public.property_videos (agent_id, status) where deleted_at is null;

-- 4) CHECK de atribución: property_id o agent_id, al menos uno
alter table public.property_videos
  drop constraint if exists property_videos_attributable;
alter table public.property_videos
  add constraint property_videos_attributable
    check (property_id is not null or agent_id is not null);
