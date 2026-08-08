-- Rollback de 20260807000001_video_in_flight_owner_select.sql (subtarea 103.1)
--
-- Restaura EXACTAMENTE el body previo de `videos_select`
-- (20260604000010_security_perf_hardening.sql:284-289) — el agente dueño de un
-- video en vuelo (property_id IS NULL) vuelve a no poder leer su propia fila.

drop policy if exists videos_select on public.property_videos;
create policy videos_select on public.property_videos for select to anon, authenticated
  using (
    (status = 'ready' and deleted_at is null and private.property_is_public(property_id))
    or private.can_manage_property(property_id)
  );
