-- Rollback de 20260816000003_advertiser_category_required.sql (subtarea #168.7)
-- Orden importa: primero se restaura la RPC a su cuerpo previo (sin el guard
-- ADVERTISER_CATEGORY_REQUIRED), luego se dropea el CHECK -- así ninguna
-- llamada intermedia queda dependiendo de un guard que ya no existe.

-- 1) RPC: vuelve exactamente al cuerpo vigente en 20260815000002 (sin el
--    guard p_enabled/p_category añadido por 168.7).
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
  select can_advertise, advertiser_category
    into v_old_can_advertise, v_old_advertiser_category
    from public.agencies
   where id = p_agency_id
     and deleted_at is null
   for update;

  if not found then
    raise exception 'AGENCY_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_admin_id := private.resolve_admin_actor();

  update public.agencies
     set can_advertise       = p_enabled,
         advertiser_category = p_category
   where id = p_agency_id;

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

-- 2) CHECK nombrado.
alter table public.agencies
  drop constraint if exists agencies_categoria_requerida_para_anunciar;
