-- Migración — RPC atómica de upgrade a agente (upgrade_to_agent_atomic), subtarea 71.3
-- Propósito: Camino A del wizard de upgrade (§4.2) — un usuario YA EXISTENTE con
-- role='user' canjea un código de invitación de agencia (mismo código en claro que
-- hoy valida la EF validate-invitation) y sube a role='agent', asociado a la agencia
-- del token, en una sola transacción.
--
-- ESPEJO de redeem_invitation_atomic (migración 20260604000013) pero para un usuario
-- que YA EXISTE (no crea auth.user) — por eso NO se refactoriza redeem_invitation_atomic
-- (decisión de Abraham 2026-08-05, PLAN de la subtarea; cero riesgo de regresión sobre
-- una RPC ya probada). A diferencia de redeem_invitation_atomic, esta RPC recibe el
-- CÓDIGO EN CLARO (no un p_token_id ya resuelto) porque aquí no hace falta partir
-- validar+canjear en dos pasos (no hay creación de auth.user en medio): hashea con
-- extensions.digest(p_token,'sha256')+encode(...,'hex') — mismo algoritmo que
-- _shared/crypto.ts:sha256_hex — para buscar el token por hash.
--
-- Orden de validación (idéntico en espíritu a validate_invitation_token,
-- _shared/invitation.ts): TOKEN_NOT_FOUND -> TOKEN_REVOKED -> TOKEN_EXPIRED ->
-- TOKEN_MAX_USES_REACHED -> AGENCY_INACTIVE. Después, ALREADY_AGENT se resuelve
-- leyendo public.users.role ANTES de consumir el token (ni el token ni la membresía
-- se tocan si el usuario ya es agent/admin). USER_NOT_FOUND se resuelve en el mismo
-- paso (ausencia de fila en public.users). Solo entonces se consume el token
-- (UPDATE condicional, barrera anti-carrera, igual que redeem_invitation_atomic) y
-- se inserta agency_members; ALREADY_ACTIVE_MEMBER es el backstop atómico del índice
-- único agency_members_one_active_per_user para el caso de estado inconsistente
-- (membresía activa preexistente pero users.role todavía en 'user').
--
-- NO inserta en user_consents: el usuario ya consintió al registrarse
-- (register_user_atomic, migración 20260729000001) — repetir el consentimiento en
-- el upgrade no aplica aquí.
--
-- Atomicidad: una función PL/pgSQL es un solo statement — si una excepción escapa
-- sin ser atrapada, Postgres revierte TODOS los efectos de la invocación (incluido
-- el consumo del token hecho en pasos previos dentro de la misma llamada).
--
-- Se llama SOLO con service_role (la Edge Function upgrade-to-agent); NO se expone
-- a anon/authenticated. Idempotente (create or replace + grants repetibles).
-- Rollback en rollbacks/.

create or replace function public.upgrade_to_agent_atomic(
  p_user_id uuid,
  p_token   text
)
returns table (agency_id uuid, agency_member_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash          text;
  v_token_id      uuid;
  v_agency_id     uuid;
  v_max_uses      int;
  v_current_uses  int;
  v_expires_at    timestamptz;
  v_revoked_at    timestamptz;
  v_agency_status text;
  v_role          text;
  v_member_id     uuid;
begin
  -- (1) Hashear el código en claro y buscar el token + agencia asociada.
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select t.id, t.agency_id, t.max_uses, t.current_uses, t.expires_at, t.revoked_at,
         a.status
    into v_token_id, v_agency_id, v_max_uses, v_current_uses, v_expires_at, v_revoked_at,
         v_agency_status
    from public.agency_invitation_tokens t
    join public.agencies a on a.id = t.agency_id
   where t.token = v_hash;

  if v_token_id is null then
    raise exception 'TOKEN_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_revoked_at is not null then
    raise exception 'TOKEN_REVOKED' using errcode = 'P0001';
  end if;

  if v_expires_at is not null and v_expires_at <= now() then
    raise exception 'TOKEN_EXPIRED' using errcode = 'P0001';
  end if;

  if v_max_uses is not null and v_current_uses >= v_max_uses then
    raise exception 'TOKEN_MAX_USES_REACHED' using errcode = 'P0001';
  end if;

  if v_agency_status <> 'active' then
    raise exception 'AGENCY_INACTIVE' using errcode = 'P0001';
  end if;

  -- (2) Estado del usuario. Sin fila -> USER_NOT_FOUND. role ya agent/admin ->
  --     ALREADY_AGENT (ninguno de los dos consume el token todavía).
  select role into v_role from public.users where id = p_user_id;

  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_role in ('agent', 'admin') then
    raise exception 'ALREADY_AGENT' using errcode = 'P0001';
  end if;

  -- (3) Consumo atómico del token (UPDATE condicional, barrera anti-carrera —
  --     mismo patrón que redeem_invitation_atomic).
  update public.agency_invitation_tokens
     set current_uses = current_uses + 1
   where id = v_token_id
     and (max_uses is null or current_uses < max_uses);

  if not found then
    raise exception 'TOKEN_MAX_USES_REACHED' using errcode = 'P0001';
  end if;

  -- (4) Membresía activa. El índice único parcial (one active per user) es el
  --     backstop atómico del caso "estado inconsistente" (role='user' pero ya
  --     tiene una membresía activa) -> ALREADY_ACTIVE_MEMBER.
  begin
    insert into public.agency_members
      (agency_id, user_id, member_role, status, invitation_token_id)
    values
      (v_agency_id, p_user_id, 'agent', 'active', v_token_id)
    returning id into v_member_id;
  exception when unique_violation then
    raise exception 'ALREADY_ACTIVE_MEMBER' using errcode = 'P0001';
  end;

  -- (5) Denormalización del perfil: rol agente + agencia.
  update public.users
     set role = 'agent', agency_id = v_agency_id
   where id = p_user_id;

  agency_id := v_agency_id;
  agency_member_id := v_member_id;
  return next;
end;
$$;

comment on function public.upgrade_to_agent_atomic(uuid, text) is
  'Camino A del wizard de upgrade a agente (§4.2): valida el código de invitación en claro (hash sha256) + sube role a agent + agency_members + denormalización users, en una transacción. NO inserta user_consents (el usuario ya consintió al registrarse). Errores (SQLSTATE P0001): TOKEN_NOT_FOUND, TOKEN_REVOKED, TOKEN_EXPIRED, TOKEN_MAX_USES_REACHED, AGENCY_INACTIVE, ALREADY_AGENT, ALREADY_ACTIVE_MEMBER, USER_NOT_FOUND. Llamar SOLO con service_role.';

-- Seguridad: la lógica de negocio sale por la Edge Function (service_role). No exponer al cliente.
revoke all on function public.upgrade_to_agent_atomic(uuid, text) from public;
revoke all on function public.upgrade_to_agent_atomic(uuid, text) from anon, authenticated;
grant execute on function public.upgrade_to_agent_atomic(uuid, text) to service_role;
