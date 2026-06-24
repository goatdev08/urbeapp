-- Migración 0015 — Storage: bucket profile-photos, RLS y columnas user_preferences
-- Propósito: (6.3) Crea el bucket `profile-photos` (público de lectura, escritura solo del dueño),
--            establece políticas RLS INSERT/UPDATE/DELETE por path de dueño, SELECT público,
--            y añade las columnas full_name y profile_photo_url a user_preferences.
-- Convención de path: {user_id}/avatar.jpg  (primer segmento = user_id del dueño).
-- Idempotente: bucket con ON CONFLICT DO NOTHING, políticas con DROP IF EXISTS + CREATE.

-- ════════════════════════════════════════════════════════════════════════════
-- (1) Bucket profile-photos  (público = true, sin restricción de MIME ni tamaño para avatares)
-- ════════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', true)
on conflict (id) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) Columnas nuevas en user_preferences
-- ════════════════════════════════════════════════════════════════════════════
alter table public.user_preferences
  add column if not exists full_name text;

alter table public.user_preferences
  add column if not exists profile_photo_url text;

comment on column public.user_preferences.full_name is
  'Nombre completo del usuario (puede diferir del display_name). Nullable.';

comment on column public.user_preferences.profile_photo_url is
  'URL pública de la foto de perfil almacenada en el bucket profile-photos. '
  'Convención: https://<project>.supabase.co/storage/v1/object/public/profile-photos/{user_id}/avatar.jpg. Nullable.';

-- ════════════════════════════════════════════════════════════════════════════
-- (3) RLS sobre storage.objects — bucket profile-photos
-- ════════════════════════════════════════════════════════════════════════════

-- ── SELECT público (anon + authenticated ven cualquier objeto del bucket) ──────
drop policy if exists profile_photos_storage_select on storage.objects;
create policy profile_photos_storage_select on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'profile-photos');

-- ── INSERT solo del dueño (path[1] = auth.uid()::text) ─────────────────────────
drop policy if exists profile_photos_storage_insert on storage.objects;
create policy profile_photos_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ── UPDATE solo del dueño ───────────────────────────────────────────────────────
drop policy if exists profile_photos_storage_update on storage.objects;
create policy profile_photos_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ── DELETE solo del dueño ───────────────────────────────────────────────────────
drop policy if exists profile_photos_storage_delete on storage.objects;
create policy profile_photos_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
