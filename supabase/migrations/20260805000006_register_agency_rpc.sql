-- Migración — RPC atómica de autoregistro de inmobiliaria (register_agency_atomic),
-- subtarea 71.4 (§4.7, flujo SEPARADO de admin-create-agency).
--
-- Propósito: la Edge Function NUEVA register-agency llama esta RPC con service_role
-- para insertar una agencia de forma atómica cuando el caller es un PROSPECTO
-- autenticado (no un admin) dando de alta su propia inmobiliaria. La agencia nace
-- SIEMPRE con status='pending_approval' — nunca 'active': el INSERT lo escribe
-- EXPLÍCITO en el VALUES (no confía en el DEFAULT de la columna, migración
-- 20260604000003, para que el invariante sobreviva aunque ese default cambie).
-- Verificado por pgTAP 24_register_agency_test.sql #6.
--
-- NO se extiende/reusa admin_create_agency_atomic (migración 0016): esa función
-- asume caller=admin + status='active' inmediato + owner/token opcionales en la
-- MISMA transacción (flujo inverso — el admin aprueba al crear). Aquí NO se crea
-- agency_members ni se promueve users.role: la activación (incluida la membresía
-- owner del creador) es responsabilidad de la subtarea 71.5 (aprobación admin vía
-- state machine sobre UPDATE), ver contrato completo y SEAMs documentados en
-- supabase/tests/24_register_agency_test.sql.
--
-- Delta de validación vs admin_create_agency_atomic: aquí contact_name/contact_phone/
-- contact_email son OBLIGATORIOS (PRD §4.7 "se capturan datos de empresa: razón
-- social, contacto, logotipo" en el registro self-service) — las columnas de
-- public.agencies siguen sin NOT NULL (admin_create_agency_atomic las deja
-- opcionales), la RPC valida con guard clauses propias (P0001 FIELDS_INCOMPLETE).
-- logo_url sigue opcional (se resuelve aparte vía mint-r2-url, tarea #69).
--
-- Errores tipados (SQLSTATE P0001): CREATED_BY_REQUIRED, FIELDS_INCOMPLETE,
-- SLUG_DUPLICATE, NAME_DUPLICATE, USER_NOT_FOUND (FK violation de
-- created_by_user_id contra public.users, remapeada — mismo patrón que
-- admin_create_agency_atomic para SLUG_DUPLICATE/NAME_DUPLICATE).
--
-- Endurecimiento de grants (NO el patrón viejo de admin_create_agency_atomic, que
-- deja el grant PUBLIC default sin revocar): revoke all from public/anon/authenticated
-- + grant execute a service_role — mismo endurecimiento que register_user_atomic
-- (20260729000001) y upgrade_to_agent_atomic (20260805000004).
--
-- Atomicidad: una función PL/pgSQL es un solo statement — si una excepción escapa
-- sin ser atrapada, Postgres revierte TODOS los efectos de la invocación.
-- Idempotente (create or replace + grants repetibles). Rollback en rollbacks/.

create or replace function public.register_agency_atomic(
  p_name               text,
  p_slug               text,
  p_contact_name       text,
  p_contact_phone      text,
  p_contact_email      text,
  p_created_by_user_id uuid,
  p_logo_url           text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agency_id  uuid;
  v_constraint text;
begin
  -- (1) Guards defensivos, en orden: created_by primero (sin creador no hay a
  --     quién atribuir la agencia), luego completitud de contacto (SEAM 3 —
  --     obligatorio en self-service, a diferencia de admin_create_agency_atomic).
  if p_created_by_user_id is null then
    raise exception 'CREATED_BY_REQUIRED' using errcode = 'P0001';
  end if;

  if p_contact_name is null or p_contact_phone is null or p_contact_email is null then
    raise exception 'FIELDS_INCOMPLETE' using errcode = 'P0001';
  end if;

  -- (2) INSERT atómico. status='pending_approval' explícito (nunca 'active' —
  --     la activación es responsabilidad de 71.5). Duplicados de slug/name
  --     (SEAM 4: el unique parcial no filtra por status, así que una agencia
  --     'pending_approval' YA bloquea un slug/name repetido) y usuario
  --     inexistente (FK created_by_user_id -> public.users) se remapean a
  --     códigos de negocio tipados.
  begin
    insert into public.agencies (
      name,
      slug,
      contact_name,
      contact_phone,
      contact_email,
      logo_url,
      status,
      created_by_user_id
    )
    values (
      p_name,
      p_slug,
      p_contact_name,
      p_contact_phone,
      p_contact_email,
      p_logo_url,
      'pending_approval',
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
    when foreign_key_violation then
      raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end;

  return v_agency_id;
end;
$$;

comment on function public.register_agency_atomic(text, text, text, text, text, uuid, text) is
  'Autoregistro de inmobiliaria por un prospecto autenticado (§4.7, subtarea 71.4): inserta la agencia con status=pending_approval (NUNCA active), sin crear agency_members ni promover users.role (activación = subtarea 71.5). Errores (SQLSTATE P0001): CREATED_BY_REQUIRED, FIELDS_INCOMPLETE, SLUG_DUPLICATE, NAME_DUPLICATE, USER_NOT_FOUND. Llamar SOLO con service_role.';

-- Seguridad: la lógica de negocio sale por la Edge Function (service_role). No exponer al cliente.
revoke all on function public.register_agency_atomic(text, text, text, text, text, uuid, text) from public;
revoke all on function public.register_agency_atomic(text, text, text, text, text, uuid, text) from anon, authenticated;
grant execute on function public.register_agency_atomic(text, text, text, text, text, uuid, text) to service_role;
