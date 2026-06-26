-- Migración 0016 — RPC admin_create_agency_atomic (actualizada: 7.6 — token + admin_actions)
-- Propósito: la Edge Function admin-create-agency llama esta RPC con service_role
-- para insertar una agencia de forma atómica. Levanta P0001 con código de negocio
-- ante conflicto de slug o name únicos en agencias activas (not deleted).
--
-- 7.5: p_owner_user_id uuid DEFAULT NULL:
--   - INSERT en agency_members (member_role=owner, status=active)
--   - UPDATE public.users SET role=agent, agency_id=<nueva> WHERE id=owner
--   - unique_violation en agency_members_one_active_per_user → ALREADY_ACTIVE_MEMBER
--
-- 7.6 (unificada): UNA SOLA función de 9 parámetros con DEFAULTs en los trailing tres.
--   Llamadas con 6/7/9 args resuelven por defaults — sin overloads, sin código muerto.
--   - p_owner_user_id uuid    DEFAULT NULL
--   - p_token_hash    text    DEFAULT NULL → INSERT en agency_invitation_tokens
--   - p_token_max_uses int    DEFAULT NULL → max_uses del token (NULL = ilimitado)
--   - INSERT en admin_actions (action_type=create_agency, new_values contiene token_id)
--   - Devuelve table(agency_id, agency_member_id, token_id)
--
-- Idempotente: drop overload 6-param + drop overload 7-param + create or replace función de 9 params.
-- Rollback: supabase/migrations/rollbacks/20260604000016_admin_create_agency_rpc.sql

-- ── Eliminar overloads anteriores si existen ─────────────────────────────────────────────

-- 6-param (reemplazada en 7.5)
do $$
begin
  revoke execute on function public.admin_create_agency_atomic(text, text, text, text, text, uuid)
    from service_role;
exception when others then null;
end;
$$;

drop function if exists public.admin_create_agency_atomic(text, text, text, text, text, uuid);

-- 7-param overload (backward compat 7.5 → eliminado: la función unificada de 9 con defaults lo absorbe)
do $$
begin
  revoke execute on function public.admin_create_agency_atomic(text, text, text, text, text, uuid, uuid)
    from service_role;
exception when others then null;
end;
$$;

drop function if exists public.admin_create_agency_atomic(text, text, text, text, text, uuid, uuid);

-- ── Función unificada de 9 parámetros (trailing 3 con DEFAULT) ──────────────────────────
-- Patrón ponytail: una sola firma, sin código muerto.
-- Invariante 7.5: owner ya con membresía activa → P0001 ALREADY_ACTIVE_MEMBER.
-- Invariante 7.6: token almacenado como hash, auditoría en admin_actions con token_id.
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
  -- Guard: created_by_user_id es obligatorio (defensa explícita antes del INSERT).
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
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'agencies_slug_unique_active' then
        raise exception 'SLUG_DUPLICATE' using errcode = 'P0001';
      else
        raise exception 'NAME_DUPLICATE' using errcode = 'P0001';
      end if;
  end;

  -- Si se especificó un owner: crear membresía y promover rol del usuario.
  -- Invariante 7.5: unique_violation en agency_members_one_active_per_user → P0001 ALREADY_ACTIVE_MEMBER.
  -- NO hay ON CONFLICT DO NOTHING — el error debe propagarse.
  if p_owner_user_id is not null then
    begin
      insert into public.agency_members (agency_id, user_id, member_role, status)
      values (v_agency_id, p_owner_user_id, 'owner', 'active')
      returning id into v_member_id;
    exception
      when unique_violation then
        raise exception 'ALREADY_ACTIVE_MEMBER' using errcode = 'P0001';
    end;

    -- Promover el rol del owner a 'agent' y asociarlo a la nueva agencia.
    update public.users
      set role      = 'agent',
          agency_id = v_agency_id
      where id = p_owner_user_id;
  end if;

  -- Insertar token inicial de invitación si se proveyó un hash.
  -- El plano NUNCA llega aquí; solo el sha256_hex calculado por la Edge Function.
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

  -- Auditoría: registrar la acción de creación de agencia.
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

-- Grant para la función unificada de 9 params.
grant execute on function public.admin_create_agency_atomic(text, text, text, text, text, uuid, uuid, text, integer)
  to service_role;
