-- Migración 20260807000001 — RLS: el agente lee su propio video EN VUELO (subtarea 103.1, parte A)
-- Bug #103 (detectado en tarea 90, E2E): mint-upload-url inserta property_videos con
-- agent_id=<caller>, property_id=NULL, status='uploading' (upload-first — el video se sube a
-- Cloudflare Stream ANTES de que exista la propiedad; ver 20260720000002). El fix del bug en
-- mobile (103.2, useVideoUpload) necesita VERIFICAR el estado real de SU PROPIO video antes de
-- decidir si un fallo de red fue real o un falso negativo — pero la policy `videos_select`
-- vigente (20260604000010_security_perf_hardening.sql:284-289) es:
--
--   using (
--     (status = 'ready' and deleted_at is null and private.property_is_public(property_id))
--     or private.can_manage_property(property_id)
--   )
--
-- Ambas ramas dependen de property_id. Con property_id IS NULL, `private.property_is_public(NULL)`
-- y `private.can_manage_property(NULL)` son SIEMPRE false (buscan `properties.id = NULL`, que
-- nunca matchea) → NINGUNA rama matchea → el propio agente dueño del upload en vuelo no puede
-- leer su fila. Tests RED: supabase/tests/27_video_in_flight_select_test.sql.
--
-- Fix: se añade una tercera rama, estrictamente acotada al DUEÑO del upload en vuelo
-- (agent_id = (select auth.uid())), NUNCA a "cualquier agente" ni a helpers de agencia/membresía
-- (precedente vivo: la #100 tuvo que reemplazar un helper de "membresía compartida" que filtraba
-- filas de otra agencia — aquí la condición correcta es estrictamente el dueño del upload, nada
-- más). Se restringe a `property_id is null` porque, una vez el video se enlaza a una propiedad
-- (publish_property_atomic), la visibilidad del dueño ya la cubre la rama existente
-- `can_manage_property(property_id)` — no hace falta duplicar esa cobertura aquí.
-- `deleted_at is null` es fail-closed explícito: un upload en vuelo soft-deleted no debe ser
-- visible ni para su propio dueño (mismo criterio que la rama 'ready' existente).
--
-- Idempotente: drop policy if exists + create policy. Rollback:
-- rollbacks/20260807000001_video_in_flight_owner_select.sql.

drop policy if exists videos_select on public.property_videos;
create policy videos_select on public.property_videos for select to anon, authenticated
  using (
    (status = 'ready' and deleted_at is null and private.property_is_public(property_id))
    or private.can_manage_property(property_id)
    or (property_id is null and agent_id = (select auth.uid()) and deleted_at is null)
  );
