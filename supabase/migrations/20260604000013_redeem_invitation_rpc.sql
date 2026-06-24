-- Migración 0013 — RPC atómica de canje de invitación (redeem_invitation_atomic)
-- Propósito: ejecutar EN UNA SOLA TRANSACCIÓN el canje completo de una invitación de agente,
-- evitando estados parciales si un paso falla:
--   (1) Consumo atómico del token (UPDATE condicional current_uses < max_uses) → barrera anti-carrera.
--   (2) Alta de membresía agency_members (agente activo).
--   (3) Denormalización de public.users (role='agent', agency_id).
--   (4) Registro de los 4 consentimientos legales (terms, privacy, age, whatsapp).
-- La validez del token (existe/no expirado/no revocado/agencia activa) ya la verificó la Edge
-- Function (subtarea 5.2). Aquí el UPDATE condicional es la barrera atómica FINAL contra canjes
-- concurrentes (dos agentes consumiendo el último uso al mismo tiempo).
-- user_preferences NO se toca: es onboarding del BUSCADOR (ubicación/presupuesto/filtros), no aplica a un agente.
-- Se llama SOLO con service_role (la Edge Function); NO se expone a anon/authenticated.
-- Idempotente (create or replace + grants repetibles). Rollback en rollbacks/0013.

create or replace function public.redeem_invitation_atomic(
  p_token_id uuid,
  p_user_id  uuid,
  p_ip       inet default null
)
returns table (agency_id uuid, agency_member_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agency_id  uuid;
  v_member_id  uuid;
  v_terms_id   uuid;
  v_privacy_id uuid;
begin
  -- (1) Consumo atómico del token. Si 0 filas afectadas → agotado entre validación y canje, o inexistente.
  update public.agency_invitation_tokens
     set current_uses = current_uses + 1
   where id = p_token_id
     and (max_uses is null or current_uses < max_uses)
  returning agency_invitation_tokens.agency_id into v_agency_id;

  if not found then
    raise exception 'TOKEN_MAX_USES_REACHED' using errcode = 'P0001';
  end if;

  -- (2) Membresía activa. El índice único parcial (one active per user) impide doble pertenencia.
  begin
    insert into public.agency_members
      (agency_id, user_id, member_role, status, invitation_token_id)
    values
      (v_agency_id, p_user_id, 'agent', 'active', p_token_id)
    returning id into v_member_id;
  exception when unique_violation then
    raise exception 'ALREADY_ACTIVE_MEMBER' using errcode = 'P0001';
  end;

  -- (3) Denormalización del perfil: rol agente + agencia.
  -- (SECURITY DEFINER, propiedad de postgres → evita los column-grants que bloquean a authenticated.)
  update public.users
     set role = 'agent', agency_id = v_agency_id
   where id = p_user_id;

  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- (4) Consentimientos legales (auditoría LFPDPPP). terms/privacy exigen la versión vigente;
  --     age/whatsapp van con terms_version_id NULL (constraint consent_version_presence).
  select id into v_terms_id
    from public.terms_versions
   where doc_type = 'terms' and is_current;
  if v_terms_id is null then
    raise exception 'NO_ACTIVE_TERMS' using errcode = 'P0001';
  end if;

  select id into v_privacy_id
    from public.terms_versions
   where doc_type = 'privacy' and is_current;
  if v_privacy_id is null then
    raise exception 'NO_ACTIVE_PRIVACY' using errcode = 'P0001';
  end if;

  insert into public.user_consents (user_id, consent_type, terms_version_id, ip_address)
  values
    (p_user_id, 'terms',    v_terms_id,   p_ip),
    (p_user_id, 'privacy',  v_privacy_id, p_ip),
    (p_user_id, 'age',      null,         p_ip),
    (p_user_id, 'whatsapp', null,         p_ip);

  agency_id := v_agency_id;
  agency_member_id := v_member_id;
  return next;
end;
$$;

comment on function public.redeem_invitation_atomic(uuid, uuid, inet) is
  'Canje atómico de invitación de agente: consumo de token (UPDATE condicional) + agency_members + denormalización users + 4 consentimientos, en una transacción. Errores (SQLSTATE P0001): TOKEN_MAX_USES_REACHED, ALREADY_ACTIVE_MEMBER, USER_NOT_FOUND, NO_ACTIVE_TERMS, NO_ACTIVE_PRIVACY. Llamar SOLO con service_role.';

-- Seguridad: la lógica de negocio sale por la Edge Function (service_role). No exponer al cliente.
revoke all on function public.redeem_invitation_atomic(uuid, uuid, inet) from public;
revoke all on function public.redeem_invitation_atomic(uuid, uuid, inet) from anon, authenticated;
grant execute on function public.redeem_invitation_atomic(uuid, uuid, inet) to service_role;
