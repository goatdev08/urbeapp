-- Migración 0011 — Storage: bucket property-videos y columna storage_path
-- Propósito: habilita el almacenamiento de videos en Supabase Storage para la demo.
-- (3.1) Crea el bucket `property-videos` (privado, 100 MB, mp4/quicktime/webm) y añade
--       la columna `storage_path` a property_videos con índice único parcial, espejando el
--       patrón de cloudflare_uid. Convención de path: {user_id}/{property_id}/{video_id}.mp4.
-- (3.2) RLS INSERT — se añadirá en la subtarea 3.2 (política de subida por agente dueño).
-- (3.3) RLS SELECT — se añadirá en la subtarea 3.3 (lectura pública de propiedades activas).

-- ════════════════════════════════════════════════════════════════════════════
-- (3.1) Bucket property-videos
-- ════════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-videos',
  'property-videos',
  false,
  104857600,
  array['video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ════════════════════════════════════════════════════════════════════════════
-- (3.1) Columna storage_path en property_videos
-- ════════════════════════════════════════════════════════════════════════════
alter table public.property_videos
  add column if not exists storage_path text;

comment on column public.property_videos.storage_path is
  'Path del objeto en el bucket property-videos. Convención: {user_id}/{property_id}/{video_id}.mp4. '
  'Nulo mientras el video referencia Cloudflare Stream (cloudflare_uid). Único cuando no es nulo.';

-- Índice único parcial: espeja el patrón de property_videos_cf_uid_unique
create unique index if not exists property_videos_storage_path_unique
  on public.property_videos (storage_path)
  where storage_path is not null;

-- ── (3.2) RLS INSERT ─────────────────────────────────────────────────────────
drop policy if exists property_videos_storage_insert on storage.objects;
create policy property_videos_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'property-videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and private.current_user_role() in ('agent', 'admin')
  );

-- ── (3.3) RLS SELECT ─────────────────────────────────────────────────────────
drop policy if exists property_videos_storage_select on storage.objects;
create policy property_videos_storage_select on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'property-videos'
    and (
      private.property_is_public((storage.foldername(name))[2]::uuid)
      or (storage.foldername(name))[1] = (select auth.uid())::text
    )
  );
