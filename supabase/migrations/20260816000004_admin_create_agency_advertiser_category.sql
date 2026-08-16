-- Migración 20260816000004 — admin_create_agency_atomic: p_advertiser_category
-- (subtarea #168.7, continuación tras el CHECK de 20260816000003).
--
-- Con agencies_categoria_requerida_para_anunciar activo (20260816000003), una
-- organización "solo-publicidad" (can_publish_properties=false,
-- can_advertise=true) ya NO se puede crear vía admin_create_agency_atomic
-- (20260816000001, 11 params): esa función no tiene forma de mandar la
-- categoría, así que el INSERT con can_advertise=true + advertiser_category
-- NULL siempre choca con el CHECK. Decisión de Abraham (2026-08-16): darle la
-- categoría a la RPC de alta.
--
-- Extiende public.admin_create_agency_atomic (última versión: 20260816000001,
-- 11 params) con UN parámetro nuevo, AL FINAL con DEFAULT null (mismo patrón
-- "defaults al final" que ya usa esa función):
--   p_advertiser_category public.advertiser_category default null
-- El default null es exactamente el default de columna de agencies
-- (20260815000001) — una llamada con la firma vieja de 9 O 11 params sigue
-- dando el mismo resultado de hoy (§0.5 regla 2, contrato publicado: los
-- builds instalados llaman la firma vieja vía la EF admin-create-agency).
--
-- Cambia el shape de argumentos (11 → 12), así que hace falta DROP explícito
-- del overload de 11 args antes del CREATE OR REPLACE de 12 args — mismo
-- patrón que 20260816000001:25-37 / 20260604000016:22-44 (sin el DROP,
-- Postgres deja las DOS funciones conviviendo en el catálogo y la llamada por
-- PostgREST queda ambigua).
--
-- Idempotente: drop function if exists (overload de 11 args) + create or replace.
-- Rollback: supabase/migrations/rollbacks/20260816000004_admin_create_agency_advertiser_category.sql
-- Tests: supabase/tests/46_org_advertising_test.sql (sección 8: RETRO1, CAP1,
-- CHECK1, OVERLOAD1) + supabase/tests/05_admin_create_agency_test.sql
-- (tests 9, 14 — firma con array de tipos).

-- ── Eliminar el overload de 11 params (20260816000001) ──────────────────────
do $$
begin
  revoke execute on function public.admin_create_agency_atomic(
    text, text, text, text, text, uuid, uuid, text, integer, boolean, boolean
  ) from service_role;
exception when others then null;
end;
$$;

drop function if exists public.admin_create_agency_atomic(
  text, text, text, text, text, uuid, uuid, text, integer, boolean, boolean
);

-- ── Función de 12 parámetros (trailing 6 con DEFAULT) ───────────────────────
-- Cuerpo idéntico a 20260816000001, más:
--   INSERT en agencies incluye advertiser_category
--   (CHECK agencies_categoria_requerida_para_anunciar de 20260816000003 sigue
--   aplicando sobre el INSERT — la RPC no lo enmascara: si can_advertise=true
--   y advertiser_category queda null, el INSERT lanza 23514 igual que
--   cualquier otro caller de agencies).
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
  p_can_advertise           boolean default false,
  p_advertiser_category     public.advertiser_category default null
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
      can_advertise,
      advertiser_category
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
      p_can_advertise,
      p_advertiser_category
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
      'can_advertise',           p_can_advertise,
      'advertiser_category',     p_advertiser_category
    )
  );

  return query select v_agency_id, v_member_id, v_token_id;
end;
$$;

comment on function public.admin_create_agency_atomic(
  text, text, text, text, text, uuid, uuid, text, integer, boolean, boolean, public.advertiser_category
) is
  'Subtarea #168.7: acepta p_advertiser_category (default null), AL FINAL de '
  'la firma de 168.3 (11 params). Una llamada con la firma vieja de 9 u 11 '
  'params (builds instalados) resuelve con ese default, comportamiento '
  'idéntico al de hoy. El CHECK agencies_categoria_requerida_para_anunciar '
  '(20260816000003) se aplica sobre el INSERT sin enmascararlo: can_advertise'
  '=true sin categoría sigue lanzando 23514. Resto idéntico a 20260816000001 '
  '(capacidad + token + admin_actions).';

-- Grant para la función de 12 params.
grant execute on function public.admin_create_agency_atomic(
  text, text, text, text, text, uuid, uuid, text, integer, boolean, boolean, public.advertiser_category
) to service_role;
