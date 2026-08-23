-- Migración 20260823000003 — RPC public.set_agency_status_atomic (tarea #211, subtarea 211.1).
-- Aditiva e idempotente. Rollback: rollbacks/20260823000003_suspend_agency_admin.sql
-- Tests: supabase/tests/67_set_agency_status_atomic_test.sql
--
-- 🔴 POR QUÉ EXISTE. El trigger handle_agency_status_change() (71.5, extendido
-- en 169.2/210.1) exige un admin identificado vía private.resolve_admin_actor(),
-- que resuelve por (1) auth.uid() de un JWT cuyo dueño sea role='admin', o (2)
-- el GUC de sesión `urbea.admin_actor_id`. Una Edge Function con service_role
-- NO tiene auth.uid(), y un set_config hecho por PostgREST en una llamada
-- aparte no sobrevive fuera de esa transacción. Sin esta RPC, suspender o
-- reactivar una organización desde la app fallaría con
-- STATUS_CHANGE_REQUIRES_ADMIN el 100% de las veces — hoy el único camino real
-- es Studio/SQL a mano (decisión D3 de 71.5: agencies.status está excluido del
-- GRANT de columna a `authenticated`). Es el mismo patrón que
-- moderate_ad_atomic (20260822000002) y el overload de 4 argumentos de
-- set_org_advertising_atomic (20260823000001) ya resolvieron.
--
-- 🔴 LO QUE ESTA RPC **NO** HACE, A PROPÓSITO:
--   · NO valida el grafo de transiciones — el trigger es la ÚNICA autoridad.
--     Una segunda copia del grafo aquí se desincronizaría, como ya pasó con la
--     ventana del reaper duplicada entre dos EFs (#183).
--   · NO cascada sobre `ads` — el trigger ya lo hace (169.2/210.1): pausa los
--     ads active de la organización marcando paused_by_suspension=true al
--     suspender, y revive SOLO esos al reactivar.
--   · NO escribe admin_actions — el trigger ya inserta esa fila. Duplicarla
--     haría que la auditoría contara DOBLE sobre un acto facturable.
--
-- Su trabajo completo son tres cosas: identificar al admin, hacer UN update, y
-- devolver el número de filas afectadas para que quien llame pueda distinguir
-- "la agencia no existe" (0 filas, sin excepción → 404) de "el trigger dijo
-- que no" (excepción P0001 → 409).
--
-- 🔴 IDEMPOTENCIA (verificada en vivo contra el trigger, ver header de
-- 67_set_agency_status_atomic_test.sql): el trigger se creó con
-- `for each row when (old.status is distinct from new.status)`
-- (20260805000007:169-174). Un UPDATE que reescribe el MISMO status NUNCA lo
-- dispara — re-suspender una agencia ya suspendida es un no-op idempotente: 1
-- fila afectada, sin excepción, sin auditoría nueva. Esta RPC no necesita
-- código extra para lograrlo: es una consecuencia directa del WHEN clause del
-- trigger sobre un UPDATE incondicional.
--
-- 🔒 SOLO service_role. Esta función instala un admin_actor ARBITRARIO en el
-- GUC: en manos de `authenticated` sería escalada de privilegios directa.
-- El revoke explícito es obligatorio porque Postgres otorga EXECUTE a PUBLIC
-- por default en CREATE FUNCTION.
-- 🔒 SECURITY DEFINER con search_path fijo (un definer sin search_path fijo es
-- escalada de privilegios — mismo criterio que private.resolve_admin_actor).

create or replace function public.set_agency_status_atomic(
  p_agency_id   uuid,
  p_next_status text,
  p_admin_id    uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  -- Frontera de confianza: agency_status tiene 5 valores y solo dos son un
  -- resultado de esta RPC (suspender/reactivar). Sin este guard, un caller
  -- podría empujar 'rejected' o 'pending_approval' —valores que EXISTEN en el
  -- enum— saltándose la semántica de "suspender/reactivar". Se valida ANTES
  -- de tocar la fila para que no queden efectos parciales.
  if p_next_status is null or p_next_status not in ('active', 'suspended') then
    raise exception 'INVALID_NEXT_STATUS' using errcode = 'P0001';
  end if;

  -- Instala el admin para private.resolve_admin_actor(). `true` = is_local:
  -- vive solo dentro de esta transacción, así que no contamina la conexión
  -- del pool para la siguiente petición.
  perform set_config('urbea.admin_actor_id', p_admin_id::text, true);

  update public.agencies
     set status = p_next_status::public.agency_status
   where id = p_agency_id;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.set_agency_status_atomic(uuid, text, uuid) is
  'Suspende/reactiva una organización (subtarea #211.1): instala p_admin_id '
  'en el GUC urbea.admin_actor_id (transacción local) y hace UN update sobre '
  'public.agencies. La validez de la transición, la cascada sobre ads '
  '(paused_by_suspension) y la auditoría en admin_actions los aplica el '
  'trigger handle_agency_status_change() — esta RPC NO los duplica. '
  'p_next_status solo admite active|suspended (INVALID_NEXT_STATUS si no). '
  'Devuelve las filas afectadas: 0 = la agencia no existe (sin excepción, '
  'para que el caller responda 404), 1 = actualizada (incluye el no-op '
  'idempotente de re-suspender/re-activar lo que ya estaba así, porque el '
  'trigger tiene WHEN old.status IS DISTINCT FROM new.status). SOLO '
  'service_role: instala un admin_actor arbitrario.';

revoke execute on function public.set_agency_status_atomic(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.set_agency_status_atomic(uuid, text, uuid)
  to service_role;
