-- Migración 20260816000001 — admin_create_agency_atomic: params de capacidad
-- (subtarea #168.3, exploración 039).
--
-- Extiende public.admin_create_agency_atomic (última versión: 20260604000016,
-- 9 params) con 2 parámetros nuevos, AL FINAL con DEFAULT (mismo patrón
-- "defaults al final" que ya usa esa función):
--   p_can_publish_properties boolean default true
--   p_can_advertise           boolean default false
-- Los defaults son EXACTAMENTE el default de columna de agencies
-- (20260815000001) — una llamada con la firma vieja de 9 params sigue dando
-- el mismo resultado de hoy (§0.5 regla 2, contrato publicado: los builds
-- instalados llaman la firma vieja vía la EF admin-create-agency).
--
-- Cambia el shape de argumentos (9 → 11), así que hace falta DROP explícito
-- del overload de 9 args antes del CREATE OR REPLACE de 11 args — mismo
-- patrón que 20260604000016:22-44 (sin el DROP, Postgres deja las DOS
-- funciones conviviendo en el catálogo y la llamada por PostgREST queda
-- ambigua).
--
-- Idempotente: drop function if exists (overload viejo) + create or replace.
-- Rollback: supabase/migrations/rollbacks/20260816000001_admin_create_agency_capacity_params.sql
-- Tests: supabase/tests/46_org_advertising_test.sql (sección 8: RETRO1, CAP1,
-- CHECK1, OVERLOAD1).

-- ── Eliminar el overload de 9 params (20260604000016) ───────────────────────
do $$
begin
  revoke execute on function public.admin_create_agency_atomic(
    text, text, text, text, text, uuid, uuid, text, integer
  ) from service_role;
exception when others then null;
end;
$$;

drop function if exists public.admin_create_agency_atomic(
  text, text, text, text, text, uuid, uuid, text, integer
);

-- ── Función de 11 parámetros (trailing 2 con DEFAULT) ───────────────────────
-- Cuerpo idéntico a 20260604000016, más:
--   INSERT en agencies incluye can_publish_properties/can_advertise
--   (CHECK agencies_al_menos_una_capacidad de 20260815000001 sigue aplicando
--   sobre el INSERT — la RPC no lo enmascara).
create or replace function public.admin_create_agency_atomic(
  p_name                    text,
  p_slug                    text,
  p_contact_name            text,
  p_contact_phone           text,
  p_contact_email           text,
  p_created_by_user_id      uuid,
  p_owner_user_id           uuid    default null,
  p_token_hash              text    default null,
  p_token_max_uses          integer default null,
  p_can_publish_properties  boolean default true,
  p_can_advertise           boolean default false
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
      created_by_user_id,
      can_publish_properties,
      can_advertise
    )
    values (
      p_name,
      p_slug,
      p_contact_name,
      p_contact_phone,
      p_contact_email,
      'active',
      p_created_by_user_id,
      p_can_publish_properties,
      p_can_advertise
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
      'name',                    p_name,
      'slug',                    p_slug,
      'owner_user_id',           p_owner_user_id,
      'agency_member_id',        v_member_id,
      'token_id',                v_token_id,
      'can_publish_properties',  p_can_publish_properties,
      'can_advertise',           p_can_advertise
    )
  );

  return query select v_agency_id, v_member_id, v_token_id;
end;
$$;

comment on function public.admin_create_agency_atomic(
  text, text, text, text, text, uuid, uuid, text, integer, boolean, boolean
) is
  'Subtarea #168.3: acepta p_can_publish_properties (default true) y '
  'p_can_advertise (default false) — mismos defaults que las columnas de '
  'agencies (20260815000001). Una llamada con la firma vieja de 9 params '
  '(builds instalados) resuelve con esos defaults, comportamiento idéntico '
  'al de hoy. El CHECK agencies_al_menos_una_capacidad se aplica sobre el '
  'INSERT sin enmascararlo. Resto idéntico a 20260604000016 (token + '
  'admin_actions).';

-- Grant para la función de 11 params.
grant execute on function public.admin_create_agency_atomic(
  text, text, text, text, text, uuid, uuid, text, integer, boolean, boolean
) to service_role;
