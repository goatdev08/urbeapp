-- Migración 20260822000002 — RPC public.moderate_ad_atomic (tarea #208, subtarea 208.1).
-- Aditiva e idempotente. Rollback: rollbacks/20260822000002_moderate_ad_atomic.sql
-- Tests: supabase/tests/64_moderate_ad_atomic_test.sql
--
-- 🔴 POR QUÉ EXISTE. El trigger handle_ad_status_change() (20260816000006,
-- extendido en 20260818000001) exige un admin identificado vía
-- private.resolve_admin_actor(), que resuelve por (1) auth.uid() de un JWT
-- cuyo dueño sea role='admin', o (2) el GUC de sesión `urbea.admin_actor_id`.
-- Una Edge Function con service_role NO tiene auth.uid(), y un set_config por
-- PostgREST no sobrevive fuera de su transacción. Sin esta RPC, TODA
-- moderación de anuncios desde la app fallaría con STATUS_CHANGE_REQUIRES_ADMIN
-- el 100% de las veces. Es exactamente el mismo problema que
-- moderate_property_atomic (20260809000007) resolvió para propiedades: el
-- admin viaja como parámetro y la función lo instala en el GUC dentro de su
-- propia transacción.
--
-- 🔴 LO QUE ESTA RPC **NO** HACE, A PROPÓSITO:
--   · NO valida el grafo de transiciones — el trigger es la ÚNICA autoridad.
--     Una segunda copia del grafo aquí se desincronizaría, como ya pasó con la
--     ventana del reaper duplicada entre dos EFs (#183).
--   · NO escribe admin_actions — el trigger ya inserta esa fila. Duplicarla
--     haría que la auditoría contara DOBLE sobre un acto facturable.
--   · NO consulta si la organización está suspendida — el trigger lo hace y
--     lanza ORGANIZATION_SUSPENDED.
--
-- Su trabajo completo son tres cosas: identificar al admin, hacer UN update, y
-- devolver el número de filas afectadas para que quien llame pueda distinguir
-- "el anuncio no existe" (0 filas, sin excepción → 404) de "el trigger dijo
-- que no" (excepción P0001 → 409).
--
-- 🔒 SOLO service_role. Esta función instala un admin_actor ARBITRARIO en el
-- GUC: en manos de `authenticated` sería escalada de privilegios directa.
-- El revoke explícito es obligatorio porque Postgres otorga EXECUTE a PUBLIC
-- por default en CREATE FUNCTION.
-- 🔒 SECURITY DEFINER con search_path fijo (un definer sin search_path fijo es
-- escalada de privilegios — mismo criterio que private.resolve_admin_actor).

create or replace function public.moderate_ad_atomic(
  p_ad_id            uuid,
  p_next_status      text,
  p_rejection_reason text,
  p_admin_id         uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  -- Frontera de confianza: `ads.status` tiene 6 valores y solo dos son un
  -- resultado de moderación. Sin este guard, un caller podría empujar
  -- 'expired' o 'paused' —transiciones que el trigger sí acepta desde
  -- 'active'— saltándose la semántica de "moderar". Se valida ANTES de tocar
  -- la fila para que no queden efectos parciales.
  if p_next_status is null or p_next_status not in ('active', 'rejected') then
    raise exception 'INVALID_NEXT_STATUS' using errcode = 'P0001';
  end if;

  -- Instala el admin para private.resolve_admin_actor(). `true` = is_local:
  -- vive solo dentro de esta transacción, así que no contamina la conexión
  -- del pool para la siguiente petición.
  perform set_config('urbea.admin_actor_id', p_admin_id::text, true);

  update public.ads
     set status           = p_next_status::public.ad_status,
         rejection_reason = p_rejection_reason
   where id = p_ad_id;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.moderate_ad_atomic(uuid, text, text, uuid) is
  'Modera un anuncio (subtarea #208.1): instala p_admin_id en el GUC '
  'urbea.admin_actor_id (transacción local) y hace UN update sobre public.ads. '
  'La validez de la transición, el guard de organización suspendida y la '
  'auditoría en admin_actions los aplica el trigger handle_ad_status_change() '
  '— esta RPC NO los duplica. p_next_status solo admite active|rejected '
  '(INVALID_NEXT_STATUS si no). Devuelve las filas afectadas: 0 = el anuncio '
  'no existe (sin excepción, para que el caller responda 404), 1 = moderado. '
  'SOLO service_role: instala un admin_actor arbitrario.';

revoke execute on function public.moderate_ad_atomic(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.moderate_ad_atomic(uuid, text, text, uuid)
  to service_role;
