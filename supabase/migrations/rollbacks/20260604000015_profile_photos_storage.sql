-- Rollback de migración 0015 — profile-photos Storage bucket y columnas user_preferences
-- Deshace: bucket profile-photos, políticas RLS en storage.objects y columnas en user_preferences.
-- PRECAUCIÓN: elimina datos (objetos en el bucket si los hay); ejecutar solo en entorno seguro.

-- ── (3) Eliminar políticas RLS de storage.objects ──────────────────────────────
drop policy if exists profile_photos_storage_select on storage.objects;
drop policy if exists profile_photos_storage_insert on storage.objects;
drop policy if exists profile_photos_storage_update on storage.objects;
drop policy if exists profile_photos_storage_delete on storage.objects;

-- ── (2) Eliminar columnas de user_preferences ──────────────────────────────────
alter table public.user_preferences
  drop column if exists full_name;

alter table public.user_preferences
  drop column if exists profile_photo_url;

-- ── (1) Eliminar bucket (solo si está vacío; de lo contrario falla deliberadamente) ──
delete from storage.objects where bucket_id = 'profile-photos';
delete from storage.buckets where id = 'profile-photos';
