-- Rollback: 20260815000005_moderate_property_atomic_wizard_fields.sql
--
-- Restaura EXACTAMENTE el body de 20260809000007 — el snapshot de revisión
-- vuelve a ignorar built_square_meters/half_bathrooms/currency (misma firma,
-- create or replace, sin DROP necesario).

create or replace function public.moderate_property_atomic(
  p_admin_id            uuid,
  p_property_id         uuid,
  p_action_type         text,
  p_old_values          jsonb,
  p_new_values          jsonb,
  p_reason              text    default null,
  p_new_property_status text    default null,
  p_changed_fields      jsonb   default null,
  p_revision_id         uuid    default null,
  p_revision_status     text    default null,
  p_revision_reason     text    default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rows int;
begin
  if p_admin_id is null or p_property_id is null then
    raise exception 'admin_id y property_id son requeridos' using errcode = 'P0001';
  end if;
  if p_action_type is null or trim(p_action_type) = '' then
    raise exception 'action_type es requerido' using errcode = 'P0001';
  end if;
  if p_revision_id is not null and p_revision_status is null then
    raise exception 'revision_status es requerido al resolver una revisión' using errcode = 'P0001';
  end if;

  if p_changed_fields is not null then
    update public.properties set
      operation_type = case when p_changed_fields ? 'operation_type'
        then (p_changed_fields->>'operation_type')::operation_type else operation_type end,
      property_type = case when p_changed_fields ? 'property_type'
        then (p_changed_fields->>'property_type')::property_type else property_type end,
      price = case when p_changed_fields ? 'price'
        then (p_changed_fields->>'price')::numeric else price end,
      bedrooms = case when p_changed_fields ? 'bedrooms'
        then (p_changed_fields->>'bedrooms')::integer else bedrooms end,
      bathrooms = case when p_changed_fields ? 'bathrooms'
        then (p_changed_fields->>'bathrooms')::integer else bathrooms end,
      square_meters = case when p_changed_fields ? 'square_meters'
        then (p_changed_fields->>'square_meters')::numeric else square_meters end,
      address = case when p_changed_fields ? 'address'
        then p_changed_fields->>'address' else address end,
      location = case when p_changed_fields ? 'location'
        then (p_changed_fields->>'location')::extensions.geography else location end,
      price_visible = case when p_changed_fields ? 'price_visible'
        then (p_changed_fields->>'price_visible')::boolean else price_visible end,
      pet_friendly = case when p_changed_fields ? 'pet_friendly'
        then (p_changed_fields->>'pet_friendly')::boolean else pet_friendly end,
      allows_no_guarantor = case when p_changed_fields ? 'allows_no_guarantor'
        then (p_changed_fields->>'allows_no_guarantor')::boolean else allows_no_guarantor end,
      student_friendly = case when p_changed_fields ? 'student_friendly'
        then (p_changed_fields->>'student_friendly')::boolean else student_friendly end,
      description = case when p_changed_fields ? 'description'
        then p_changed_fields->>'description' else description end,
      updated_at = now()
    where id = p_property_id;

    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'propiedad % no encontrada al aplicar el snapshot', p_property_id
        using errcode = 'P0001';
    end if;
  end if;

  if p_new_property_status is not null then
    update public.properties
       set status = p_new_property_status::property_status,
           updated_at = now()
     where id = p_property_id;

    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'propiedad % no encontrada al mover status', p_property_id
        using errcode = 'P0001';
    end if;
  end if;

  if p_revision_id is not null then
    update public.property_revisions
       set status = p_revision_status::property_revision_status,
           reviewed_by_admin_id = p_admin_id,
           reviewed_at = now(),
           rejection_reason = p_revision_reason
     where id = p_revision_id;

    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'revisión % no encontrada al resolverla', p_revision_id
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.admin_actions
    (admin_id, action_type, entity_type, entity_id, old_values, new_values, reason)
  values
    (p_admin_id, p_action_type, 'property', p_property_id, p_old_values, p_new_values, p_reason);
end;
$$;

comment on function public.moderate_property_atomic(
  uuid, uuid, text, jsonb, jsonb, text, text, jsonb, uuid, text, text
) is
  '#130: las escrituras de moderate-property en UNA transacción.';

grant execute on function public.moderate_property_atomic(
  uuid, uuid, text, jsonb, jsonb, text, text, jsonb, uuid, text, text
) to service_role;
