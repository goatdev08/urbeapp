-- Migración 0016 — RPC admin_create_agency_atomic
-- Propósito: la Edge Function admin-create-agency llama esta RPC con service_role
-- para insertar una agencia de forma atómica. Levanta P0001 con código de negocio
-- ante conflicto de slug o name únicos en agencias activas (not deleted).
--
-- Firma extensible para 7.5 (agency_member del owner + UPDATE users) y
-- 7.6 (token + admin_actions) sin romper la firma existente.
--
-- Idempotente: create or replace function + grants repetibles.
-- Rollback: supabase/migrations/rollbacks/20260604000016_admin_create_agency_rpc.sql

create or replace function public.admin_create_agency_atomic(
  p_name                text,
  p_slug                text,
  p_contact_name        text,
  p_contact_phone       text,
  p_contact_email       text,
  p_created_by_user_id  uuid
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

  -- INSERT atómico. status='active': el admin aprueba la agencia al crearla directamente.
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

  return v_agency_id;
end;
$$;

-- Sólo el service_role (Edge Function) puede ejecutar la RPC.
-- No se expone a anon ni a authenticated (RLS no aplica porque es SECURITY DEFINER).
grant execute on function public.admin_create_agency_atomic(text, text, text, text, text, uuid)
  to service_role;
