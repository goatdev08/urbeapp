-- Rollback 0011 — Storage: bucket property-videos y columna storage_path

-- ── (3.3) RLS SELECT — placeholders para políticas añadidas en la subtarea 3.3 ──
-- drop policy if exists "public can read active property video" on storage.objects;

-- ── (3.2) RLS INSERT — placeholders para políticas añadidas en la subtarea 3.2 ──
-- drop policy if exists "agent owner can upload video" on storage.objects;

-- ── (3.1) Índice y columna ───────────────────────────────────────────────────
drop index if exists public.property_videos_storage_path_unique;
alter table public.property_videos drop column if exists storage_path;

-- ── (3.1) Bucket ─────────────────────────────────────────────────────────────
delete from storage.buckets where id = 'property-videos';
