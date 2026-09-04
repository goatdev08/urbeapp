-- Rollback 20260905200001 — identidad pública del publicador para todos los roles (#250 + #254)
--
-- Efecto: la vista vuelve a exponer SOLO role in ('agent','admin') y sin
-- has_phone; register_user_atomic y redeem_invitation_atomic dejan de sembrar
-- el nombre público; el helper desaparece.
--
-- ⚠️ NO DESTRUYE DATOS: los user_preferences.full_name ya sembrados se
-- conservan. Son el nombre público del usuario (dato suyo), no un artefacto de
-- esta migración; borrarlos dejaría a gente sin nombre en pantalla. Si de
-- verdad se quisiera revertir el backfill haría falta un registro de qué filas
-- tocó, que a propósito no se guarda.
--
-- ⚠️ ORDEN: revertir esto DESPUÉS de revertir el cliente (OTA), no antes. El
-- cliente nuevo lee `has_phone` de la vista para decidir el botón de WhatsApp;
-- si la columna desaparece primero, la query del feed falla (PGRST) y el feed
-- se queda sin identidad de agente.
--
-- `drop view` (no `create or replace`): Postgres no deja quitarle columnas a una
-- vista con replace.
drop view if exists public.agent_public_profiles;

create view public.agent_public_profiles
with (security_invoker = false) as
  select up.user_id, up.full_name, up.profile_photo_url
  from public.user_preferences up
  join public.users u on u.id = up.user_id
  where u.role in ('agent', 'admin');

comment on view public.agent_public_profiles is
  'Identidad pública de agentes/admins (nombre + foto R2 key) legible por cualquier sesión autenticada. Brinca la RLS de user_preferences SOLO en estas columnas (#145).';

revoke all on public.agent_public_profiles from anon, public;
grant select on public.agent_public_profiles to authenticated;

-- ── Las dos RPCs vuelven a su cuerpo previo (sin la siembra) ────────────────
create or replace function public.register_user_atomic(
  p_user_id uuid,
  p_ip      inet default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone           text;
  v_date_of_birth   date;
  v_state_id        text;
  v_municipality_id text;
  v_terms_id        uuid;
  v_privacy_id      uuid;
begin
  select phone, date_of_birth, state_id, municipality_id
    into v_phone, v_date_of_birth, v_state_id, v_municipality_id
    from public.users
   where id = p_user_id;

  if v_phone is null or v_date_of_birth is null or v_state_id is null or v_municipality_id is null then
    raise exception 'FIELDS_INCOMPLETE' using errcode = 'P0001';
  end if;

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
end;
$$;

comment on function public.register_user_atomic(uuid, inet) is
  'Registro atómico §5.1/§5.5: valida completitud del perfil (phone/date_of_birth/state_id/municipality_id) + inserta 4 consentimientos, en una transacción. Errores (SQLSTATE P0001): FIELDS_INCOMPLETE, NO_ACTIVE_TERMS, NO_ACTIVE_PRIVACY. Llamar SOLO con service_role.';

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
  update public.agency_invitation_tokens
     set current_uses = current_uses + 1
   where id = p_token_id
     and (max_uses is null or current_uses < max_uses)
  returning agency_invitation_tokens.agency_id into v_agency_id;

  if not found then
    raise exception 'TOKEN_MAX_USES_REACHED' using errcode = 'P0001';
  end if;

  begin
    insert into public.agency_members
      (agency_id, user_id, member_role, status, invitation_token_id)
    values
      (v_agency_id, p_user_id, 'agent', 'active', p_token_id)
    returning id into v_member_id;
  exception when unique_violation then
    raise exception 'ALREADY_ACTIVE_MEMBER' using errcode = 'P0001';
  end;

  update public.users
     set role = 'agent', agency_id = v_agency_id
   where id = p_user_id;

  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;

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

drop function if exists private.seed_public_full_name(uuid);
