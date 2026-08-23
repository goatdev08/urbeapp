-- Migración 20260823000001 — overload de 4 argumentos para
-- public.set_org_advertising_atomic (tarea #209, subtarea 209.1).
-- Aditiva e idempotente. Rollback: rollbacks/20260823000001_set_org_advertising_atomic_admin.sql
-- Tests: supabase/tests/65_set_org_advertising_atomic_admin_test.sql
--
-- 🔴 POR QUÉ EXISTE. `set_org_advertising_atomic(p_agency_id, p_enabled, p_category)`
-- (20260815000002, extendida en 20260816000003) ya hace TODO el trabajo de
-- negocio: valida agencia existente/no-borrada, exige advertiser_category
-- cuando p_enabled=true (CHECK agencies_categoria_requerida_para_anunciar +
-- raise ADVERTISER_CATEGORY_REQUIRED), hace el UPDATE y audita en
-- admin_actions -- todo en la MISMA transacción. Pero resuelve
-- admin_actions.admin_id vía private.resolve_admin_actor(), que necesita
-- auth.uid() o el GUC de sesión `urbea.admin_actor_id` YA instalado. Una Edge
-- Function con service_role no tiene auth.uid(), y un `set_config` hecho por
-- PostgREST/supabase-js en una llamada aparte no sobrevive fuera de esa
-- transacción. Sin este overload, TODA llamada desde la EF fallaría con
-- admin_id NULL (viola la FK de admin_actions) el 100% de las veces.
-- Exactamente el mismo problema que moderate_ad_atomic (20260822000002)
-- resolvió para la moderación de anuncios: el admin viaja como parámetro y se
-- instala en el GUC dentro de la propia transacción.
--
-- 🔴 LO QUE ESTE OVERLOAD **NO** HACE, A PROPÓSITO: no repite NINGUNA validación
-- ni el UPDATE ni el INSERT de auditoría -- delega el 100% de la lógica de
-- negocio en la RPC de 3 argumentos ya existente y probada (reusar > reescribir,
-- CLAUDE.md §0). Su único trabajo es instalar el GUC y reenviar la llamada.
-- Duplicar la lógica aquí crearía una segunda copia que podría desincronizarse
-- (mismo riesgo ya visto con la ventana del reaper, #183).
--
-- Se implementa como OVERLOAD (mismo nombre, firma distinta) y no como función
-- con otro nombre: es la misma operación de negocio ("encender/apagar el modo
-- comercial de una agencia"), solo con un parámetro extra para el actor. Un
-- caller que llame con 3 argumentos (Studio/CLI, uso ya establecido) sigue
-- resolviendo por auth.uid()/GUC como siempre; la EF llama con 4.
--
-- 🔒 SOLO service_role. Este overload instala un admin_actor ARBITRARIO en el
-- GUC: en manos de `authenticated` sería escalada de privilegios directa.
-- 🔒 SECURITY DEFINER con search_path fijo explícito (un definer sin
-- search_path fijo es escalada de privilegios -- mismo criterio que la RPC de
-- 3 argumentos y private.resolve_admin_actor).

create or replace function public.set_org_advertising_atomic(
  p_agency_id uuid,
  p_enabled   boolean,
  p_category  public.advertiser_category,
  p_admin_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Instala el admin para private.resolve_admin_actor(), que usa la RPC de 3
  -- argumentos que se invoca abajo. `true` = is_local: vive solo dentro de
  -- esta transacción, así que no contamina la conexión del pool para la
  -- siguiente petición.
  perform set_config('urbea.admin_actor_id', p_admin_id::text, true);

  -- Delega el 100% de la validación/UPDATE/auditoría en la RPC de 3
  -- argumentos ya existente -- ver el comentario de arriba.
  perform public.set_org_advertising_atomic(p_agency_id, p_enabled, p_category);
end;
$$;

comment on function public.set_org_advertising_atomic(uuid, boolean, public.advertiser_category, uuid) is
  'Overload de 4 argumentos (subtarea #209.1): instala p_admin_id en el GUC '
  'urbea.admin_actor_id (transacción local) y delega el 100% de la lógica en '
  'set_org_advertising_atomic(p_agency_id, p_enabled, p_category) -- no '
  'duplica su validación, UPDATE ni auditoría. Mismos códigos de error '
  '(P0001 AGENCY_NOT_FOUND / ADVERTISER_CATEGORY_REQUIRED) que la RPC de 3 '
  'argumentos. SOLO service_role: instala un admin_actor arbitrario.';

revoke execute on function public.set_org_advertising_atomic(uuid, boolean, public.advertiser_category, uuid)
  from public, anon, authenticated;
grant execute on function public.set_org_advertising_atomic(uuid, boolean, public.advertiser_category, uuid)
  to service_role;
