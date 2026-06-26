-- Migración 0016 — RPC admin_create_agency_atomic (actualizada: 7.5 — owner_user_id)
-- Propósito: la Edge Function admin-create-agency llama esta RPC con service_role
-- para insertar una agencia de forma atómica. Levanta P0001 con código de negocio
-- ante conflicto de slug o name únicos en agencias activas (not deleted).
--
-- 7.5: añade p_owner_user_id uuid DEFAULT NULL:
--   - INSERT en agency_members (member_role=owner, status=active)
--   - UPDATE public.users SET role=agent, agency_id=<nueva> WHERE id=owner
--   - unique_violation en agency_members_one_active_per_user → ALREADY_ACTIVE_MEMBER
--
-- Idempotente: drop 6-param + create or replace 7-param (DEFAULT NULL en p_owner_user_id
-- mantiene compatibilidad con llamadas de 6 argumentos).
-- Rollback: supabase/migrations/rollbacks/20260604000016_admin_create_agency_rpc.sql

-- Eliminar la versión anterior de 6 parámetros si existe (fue reemplazada por la de 7).
do $$
begin
  revoke execute on function public.admin_create_agency_atomic(text, text, text, text, text, uuid)
    from service_role;
exception when others then null; -- no existe o ya fue revocado: continuar
end;
$$;

drop function if exists public.admin_create_agency_atomic(text, text, text, text, text, uuid);

create or replace function public.admin_create_agency_atomic(
  p_name                text,
  p_slug                text,
  p_contact_name        text,
  p_contact_phone       text,
  p_contact_email       text,
  p_created_by_user_id  uuid,
  p_owner_user_id       uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency_id  uuid;
  v_constraint text;
begin
  -- Guard: created_by_user_id es obligatorio (defensa explícita antes del INSERT)
  if p_created_by_user_id is null then
    raise exception 'created_by_user_id es requerido'
      using errcode = 'P0001';
  end if;

  -- INSERT atómico de la agencia. status='active': el admin aprueba al crear directamente.
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
      -- Determinar qué índice único fue violado para devolver el código de negocio correcto.
      -- agencies_slug_unique_active → slug duplicado entre agencias no borradas.
      -- agencies_name_unique_active → name duplicado entre agencias no borradas.
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'agencies_slug_unique_active' then
        raise exception 'SLUG_DUPLICATE' using errcode = 'P0001';
      else
        raise exception 'NAME_DUPLICATE' using errcode = 'P0001';
      end if;
  end;

  -- Si se especificó un owner: crear membresía y promover rol del usuario.
  if p_owner_user_id is not null then
    begin
      insert into public.agency_members (agency_id, user_id, member_role, status)
      values (v_agency_id, p_owner_user_id, 'owner', 'active');
    exception
      when unique_violation then
        -- El índice agency_members_one_active_per_user garantiza max 1 membresía activa por usuario.
        raise exception 'ALREADY_ACTIVE_MEMBER' using errcode = 'P0001';
    end;

    -- Promover el rol del owner a 'agent' y asociarlo a la nueva agencia.
    update public.users
      set role      = 'agent',
          agency_id = v_agency_id
      where id = p_owner_user_id;
  end if;

  return v_agency_id;
end;
$$;

-- Sólo el service_role (Edge Function) puede ejecutar la RPC.
-- No se expone a anon ni a authenticated (RLS no aplica porque es SECURITY DEFINER).
grant execute on function public.admin_create_agency_atomic(text, text, text, text, text, uuid, uuid)
  to service_role;
