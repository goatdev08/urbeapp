-- Migración 20260815000002 — RPC set_org_advertising_atomic (tarea #168.2)
-- Aditiva e idempotente. Rollback: rollbacks/20260815000002_set_org_advertising_rpc.sql
-- Tests: supabase/tests/46_org_advertising_test.sql, sección 7 (asserts 29-48)
--
-- Propósito: encender/apagar public.agencies.can_advertise (+ advertiser_category)
--   es un acto FACTURABLE, así que va auditado en admin_actions en la MISMA
--   transacción -- o no se enciende. Los column-grants de 0008 ya excluyen estas
--   3 columnas del UPDATE directo del cliente (ni el owner legítimo puede tocarlas,
--   ver 20260815000001:81-87); esta RPC es el único camino, y es 🔒 SOLO
--   service_role -- la invoca el admin de Urbea desde Studio/CLI (operación en
--   beta, sin EF/UI todavía -- eso es 169-171 / #81).
--
-- Reusa private.resolve_admin_actor() (20260805000007:52) para resolver
-- admin_actions.admin_id: coalesce(auth.uid() si es admin real, GUC de sesión
-- urbea.admin_actor_id si apunta a un admin real) -- mismo mecanismo ya
-- establecido para el flujo de aprobación por Studio, evita inventar un
-- segundo mecanismo (CLAUDE.md §0: reusar > reescribir). El JWT del caller
-- service_role puede llevar el admin en `sub` (patrón que ya usan los tests).
--
-- Atomicidad: el SELECT ... FOR UPDATE valida agencia existente/no-borrada
-- (P0001 explícito, nunca no-op silencioso) y toma lock de fila; el UPDATE y el
-- INSERT de auditoría corren en la MISMA invocación de función -- si el INSERT
-- falla (p. ej. fault-injection), la excepción no capturada revierte TODOS los
-- efectos de la sentencia (UPDATE incluido), sin necesidad de BEGIN/EXCEPTION.
--
-- 🔒 SECURITY DEFINER con search_path fijo explícito (un SECURITY DEFINER sin
--   search_path fijo es escalada de privilegios -- mismo criterio que
--   private.agency_role_of / private.resolve_admin_actor).
-- 🔒 revoke execute from public, anon, authenticated -- Postgres otorga EXECUTE a
--   PUBLIC por default en CREATE FUNCTION, así que el revoke es obligatorio y
--   explícito (patrón literal de 20260813000003_import_neighborhoods_batch_rpc.sql).
--   service_role además ya lo recibe por default privileges de
--   20260604000014_service_role_grants.sql; el GRANT explícito de abajo lo deja
--   documentado sin depender de eso.

create or replace function public.set_org_advertising_atomic(
  p_agency_id uuid,
  p_enabled   boolean,
  p_category  public.advertiser_category default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id             uuid;
  v_old_can_advertise    boolean;
  v_old_advertiser_category public.advertiser_category;
begin
  -- Organización inexistente o borrada -> error explícito, nunca no-op silencioso.
  -- FOR UPDATE: toma el lock de fila antes de mutar (evita carreras entre dos
  -- llamadas concurrentes sobre la misma agencia).
  select can_advertise, advertiser_category
    into v_old_can_advertise, v_old_advertiser_category
    from public.agencies
   where id = p_agency_id
     and deleted_at is null
   for update;

  if not found then
    raise exception 'AGENCY_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Admin actor identificado (Studio/CLI vía service_role, sin JWT de usuario
  -- normal) -- mismo helper que ya resuelve el flujo de aprobación por Studio.
  v_admin_id := private.resolve_admin_actor();

  update public.agencies
     set can_advertise       = p_enabled,
         advertiser_category = p_category
   where id = p_agency_id;

  -- Auditoría en la MISMA transacción/statement: si esto falla, el UPDATE de
  -- arriba se revierte también (atomicidad real, no un rollback manual).
  insert into public.admin_actions (
    admin_id, action_type, entity_type, entity_id, old_values, new_values
  )
  values (
    v_admin_id,
    case when p_enabled then 'enable_org_advertising' else 'disable_org_advertising' end,
    'agency',
    p_agency_id,
    jsonb_build_object(
      'can_advertise', v_old_can_advertise,
      'advertiser_category', v_old_advertiser_category
    ),
    jsonb_build_object(
      'can_advertise', p_enabled,
      'advertiser_category', p_category
    )
  );
end;
$$;

comment on function public.set_org_advertising_atomic(uuid, boolean, public.advertiser_category) is
  'Enciende/apaga agencies.can_advertise (+ advertiser_category) y audita en '
  'admin_actions en la MISMA transacción -- rollback total si la auditoría falla. '
  'Organización inexistente o con deleted_at -> P0001 AGENCY_NOT_FOUND. SOLO '
  'service_role (Studio/CLI del admin de Urbea, subtarea #168.2). admin_id vía '
  'private.resolve_admin_actor().';

revoke execute on function public.set_org_advertising_atomic(uuid, boolean, public.advertiser_category)
  from public, anon, authenticated;
grant execute on function public.set_org_advertising_atomic(uuid, boolean, public.advertiser_category)
  to service_role;
