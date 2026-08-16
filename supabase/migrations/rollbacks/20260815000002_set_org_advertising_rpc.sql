-- Rollback de 20260815000002_set_org_advertising_rpc.sql (tarea #168.2)
revoke execute on function public.set_org_advertising_atomic(uuid, boolean, public.advertiser_category)
  from service_role;

drop function if exists public.set_org_advertising_atomic(uuid, boolean, public.advertiser_category);
