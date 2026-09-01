-- Migración 20260831000001 — tarea 225: admin_create_agency_atomic NO debe
-- DEGRADAR a un administrador de plataforma al asignarlo owner.
-- Rollback: supabase/migrations/rollbacks/20260831000001_admin_create_agency_no_degrada_admin.sql
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL BUG: el UPDATE del owner iba SIN condicionar —
--     set role = 'agent', agency_id = v_agency_id
-- así que asignar a un usuario con role='admin' como owner de una organización
-- nueva lo bajaba a 'agent' en silencio y le quitaba el panel de administrador.
-- Ocurrió en PRODUCCIÓN el 2026-08-31 al crear la organización «Desarrolladora»
-- con la cuenta de Abraham (se restauró en la MISMA transacción del alta, así
-- que producción quedó correcta — pero el RPC seguía mal).
--
-- LA REGLA YA ESTABA DECIDIDA: la migración 20260805000010 ("FIX 2: nunca
-- degradar a un admin") añadió exactamente este guard a los DOS triggers de
-- aprobación — public.handle_agency_status_change y
-- public.handle_agent_application_status_change. Este RPC se quedó fuera de
-- aquel barrido: mismo patrón «una invariante implementada en dos capas y
-- anclada en una sola» que produjo 5 hallazgos en #220.
--
-- 🔒 agency_id SÍ se denormaliza SIEMPRE, también para el admin: un admin
-- puede ser owner de una organización, y necesita el vínculo para publicar a
-- su nombre. Por eso el guard va en el VALOR de `role` (case when …) y NO en
-- el WHERE de la sentencia: un `where id = p_owner_user_id and role <> 'admin'`
-- salvaría el rol pero se saltaría también la denormalización, dejando al
-- admin sin organización. Es literalmente la advertencia que ya está escrita
-- en el comentario de 20260805000010:129 ("un WHERE role<>'admin' la
-- excluiría en silencio"). Anclado por el assert 23 de
-- supabase/tests/05_admin_create_agency_test.sql.
--
-- ADITIVA y compatible hacia atrás (§0.5): mismo nombre, MISMA firma de 12
-- params, mismo tipo de retorno, mismos errores tipados (SLUG_DUPLICATE,
-- NAME_DUPLICATE, ALREADY_ACTIVE_MEMBER), mismo admin_actions. El único
-- cambio observable para un caller es el caso que hoy está MAL. Los builds
-- instalados y la EF admin-create-agency no notan nada. No requiere OTA.
-- Idempotente: create or replace.
-- ════════════════════════════════════════════════════════════════════════════

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

    -- 225: nunca degradar a un admin. El guard va en el VALOR, no en el WHERE
    -- (ver cabecera): agency_id se denormaliza para TODOS los owners.
    -- Idéntico al de 20260805000010 en los dos triggers de aprobación.
    update public.users
      set role      = case when role = 'admin' then role else 'agent' end,
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
  'Crea una organización ACTIVA con capacidades, opcionalmente con owner y '
  'token de invitación, y audita en admin_actions. Firma de 12 params '
  '(#168.7): una llamada vieja de 9 u 11 resuelve con los defaults, '
  'comportamiento idéntico. ⭐ #225: el owner que YA es admin de plataforma '
  'CONSERVA role=admin (guard `case when role = ''admin'' then role else '
  '''agent'' end`, el mismo de 20260805000010 en los dos triggers de '
  'aprobación) — antes lo degradaba a ''agent'' y le quitaba el panel de '
  'administrador. agency_id se denormaliza SIEMPRE, también para el admin: '
  'el guard va en el VALOR, nunca en el WHERE.';

grant execute on function public.admin_create_agency_atomic(
  text, text, text, text, text, uuid, uuid, text, integer, boolean, boolean, public.advertiser_category
) to service_role;
