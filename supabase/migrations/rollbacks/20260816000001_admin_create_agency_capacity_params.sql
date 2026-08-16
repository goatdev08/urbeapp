-- Rollback: 20260816000001_admin_create_agency_capacity_params.sql
--
-- Restaura EXACTAMENTE el body de 20260604000016 — admin_create_agency_atomic
-- vuelve a NO aceptar p_can_publish_properties/p_can_advertise (9 params).

revoke execute on function public.admin_create_agency_atomic(
  text, text, text, text, text, uuid, uuid, text, integer, boolean, boolean
) from service_role;

drop function if exists public.admin_create_agency_atomic(
  text, text, text, text, text, uuid, uuid, text, integer, boolean, boolean
);

create or replace function public.admin_create_agency_atomic(
  p_name                text,
  p_slug                text,
  p_contact_name        text,
  p_contact_phone       text,
  p_contact_email       text,
  p_created_by_user_id  uuid,
  p_owner_user_id       uuid    default null,
  p_token_hash          text    default null,
  p_token_max_uses      integer default null
)
returns table(agency_id uuid, agency_member_id uuid, token_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency_id  uuid;
  v_member_id  uuid;
  v_token_id   uuid;
  v_constraint text;
begin
  if p_created_by_user_id is null then
    raise exception 'created_by_user_id es requerido'
      using errcode = 'P0001';
  end if;

  begin
    insert into public.agencies (
      name,
      slug,
      contact_name,
      contact_phone,
      contact_email,
      status,
      created_by_user_id
    )
    values (
      p_name,
      p_slug,
      p_contact_name,
      p_contact_phone,
      p_contact_email,
      'active',
      p_created_by_user_id
    )
    returning id into v_agency_id;

  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'agencies_slug_unique_active' then
        raise exception 'SLUG_DUPLICATE' using errcode = 'P0001';
      else
        raise exception 'NAME_DUPLICATE' using errcode = 'P0001';
      end if;
  end;

  if p_owner_user_id is not null then
    begin
      insert into public.agency_members (agency_id, user_id, member_role, status)
      values (v_agency_id, p_owner_user_id, 'owner', 'active')
      returning id into v_member_id;
    exception
      when unique_violation then
        raise exception 'ALREADY_ACTIVE_MEMBER' using errcode = 'P0001';
    end;

    update public.users
      set role      = 'agent',
          agency_id = v_agency_id
      where id = p_owner_user_id;
  end if;

  if p_token_hash is not null then
    insert into public.agency_invitation_tokens (
      agency_id,
      token,
      created_by_user_id,
      max_uses,
      current_uses
    )
    values (
      v_agency_id,
      p_token_hash,
      p_created_by_user_id,
      p_token_max_uses,
      0
    )
    returning id into v_token_id;
  end if;

  insert into public.admin_actions (
    admin_id,
    action_type,
    entity_type,
    entity_id,
    new_values
  )
  values (
    p_created_by_user_id,
    'create_agency',
    'agency',
    v_agency_id,
    jsonb_build_object(
      'name',             p_name,
      'slug',             p_slug,
      'owner_user_id',    p_owner_user_id,
      'agency_member_id', v_member_id,
      'token_id',         v_token_id
    )
  );

  return query select v_agency_id, v_member_id, v_token_id;
end;
$$;

comment on function public.admin_create_agency_atomic(
  text, text, text, text, text, uuid, uuid, text, integer
) is
  'Migración 0016 (7.6): función unificada de 9 parámetros con DEFAULTs en '
  'los trailing tres. INSERT en agency_members, promoción de rol, token de '
  'invitación y auditoría en admin_actions.';

grant execute on function public.admin_create_agency_atomic(
  text, text, text, text, text, uuid, uuid, text, integer
) to service_role;
