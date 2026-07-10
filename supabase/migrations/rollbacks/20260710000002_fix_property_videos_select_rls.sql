-- Rollback 20260710000002 — Restaurar policy RLS SELECT original de property-videos
-- (incluye de vuelta la rama pública muerta de la migración 20260604000011, por paridad
-- histórica de esquema; NO reintroducir en producción — ver la migración 20260710000002
-- para el porqué de su eliminación).

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
