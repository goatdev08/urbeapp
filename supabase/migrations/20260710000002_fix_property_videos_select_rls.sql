-- Migración 20260710000002 — Corregir policy RLS SELECT de storage.objects (property-videos)
-- Subtarea 52.5 (tarea 52). Tests RED: supabase/tests/11_property_videos_select_policy_test.sql
--
-- Problema: la policy `property_videos_storage_select` (migración 20260604000011:52-60)
-- tiene una rama pública que espera property_id en el 2º segmento del path
-- ((storage.foldername(name))[2]::uuid), pero la convención real de subida
-- (mobile/src/features/publish/hooks/useVideoUpload.ts:140) es `{user_id}/{video_id}.mp4`
-- — SOLO 2 segmentos. foldername(name)[2] es SIEMPRE NULL en producción, y
-- private.property_is_public(NULL) es SIEMPRE false → la rama pública nunca se activa:
-- es dead code.
--
-- Además esa rama muerta deja un hueco real de seguridad: un path FABRICADO de 3
-- segmentos `{owner}/{property_id_activo}/x.mp4` (que la app nunca genera, pero que la
-- policy de INSERT no impide crear) hace que property_is_public(segmento[2]) evalúe a
-- true para CUALQUIER usuario (incluido anon), sin importar que el 1er segmento no
-- coincida con su propio uid — lectura no autorizada del objeto.
--
-- Decisión aprobada: ELIMINAR la rama pública (no repararla). El acceso público a video
-- de propiedades activas va EXCLUSIVAMENTE por la Edge Function mint-video-url
-- (service_role, bypassa RLS, entrega URLs firmadas de corta duración). La policy SELECT
-- de storage.objects queda SOLO con "el dueño lee sus propios objetos" — igual a la rama
-- que ya usa INSERT (20260604000011:46). No existe rama admin en la policy SELECT original
-- (a diferencia de INSERT) por lo que no hay semántica admin que preservar.
--
-- Idempotente: drop policy if exists + create policy.

drop policy if exists property_videos_storage_select on storage.objects;
create policy property_videos_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'property-videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
