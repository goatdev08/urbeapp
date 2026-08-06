-- Migración 20260805000009 — switch_agency_atomic + cierre del gap de suspensión
-- en properties_insert (subtarea 71.6, PRD §4.6/§4.7).
-- Requiere que 20260805000008 ya haya committeado el valor 'suspended' del enum
-- agency_member_status (corre después, migración separada por el ADD VALUE gotcha
-- -- ver header de esa migración).
--
-- ════════════════════════════════════════════════════════════════════════════
-- 1) RPC switch_agency_atomic — transición atómica de agencia (PRD §4.6)
-- ════════════════════════════════════════════════════════════════════════════
-- Espejo de upgrade_to_agent_atomic (20260805000004): una función PL/pgSQL es un
-- solo statement, así que si una excepción escapa Postgres revierte TODOS los
-- efectos -- misma garantía de atomicidad, sin necesitar probarla aparte.
--
-- Orden de validación (barreras, una por RAISE EXCEPTION P0001) -- ver contrato
-- completo en el header de supabase/tests/26_agency_member_management_test.sql:
--   1. NOT_CURRENT_MEMBER      -- p_user_id no tiene una membresía status='active' HOY.
--   2. SAME_AGENCY             -- p_target_agency_id = la agencia actual (no-op explícito).
--   3. TARGET_AGENCY_NOT_FOUND -- p_target_agency_id no existe en `agencies`.
--   4. TARGET_AGENCY_INACTIVE  -- existe pero status <> 'active'.
--   5. ALREADY_ACTIVE_MEMBER   -- backstop atómico del índice único
--      agency_members_one_active_per_user (unique_violation al insertar la fila nueva).
--
-- Efectos (happy path, en una transacción):
--   (a) la membresía VIEJA pasa a status='removed', removed_at=now() -- el
--       member_role histórico NO se toca (queda como registro, no se sobrescribe).
--   (b) se INSERTA una membresía NUEVA en la agencia destino: member_role='agent'
--       SIEMPRE (un owner/admin que cambia de agencia entra como agente raso en
--       la nueva -- no "hereda" jerarquía), status='active'.
--   (c) users.agency_id se denormaliza al nuevo valor. users.role NO se toca.
--   (d) orden que nunca viola agency_members_one_active_per_user: se desactiva la
--       membresía vieja ANTES de insertar la nueva, en la misma transacción.
--
-- TODO/ponytail(#78): followers se conservan gratis porque el follow es al AGENTE
-- (user_id), nunca a la agencia -- esta RPC no toca ninguna tabla de follows (no
-- existe aún). Cuando #78 exista, agregar ahí un assert que confirme que
-- switch_agency_atomic no la toca.
--
-- Grants: solo service_role (la llamará la futura EF/pantalla de "cambiar de
-- agencia" -- fuera del alcance de esta subtarea). Idempotente (create or replace
-- + grants repetibles). Rollback en rollbacks/.

create or replace function public.switch_agency_atomic(
  p_user_id uuid,
  p_target_agency_id uuid
)
returns table (old_agency_id uuid, new_agency_id uuid, agency_member_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_member_id uuid;
  v_old_agency_id uuid;
  v_target_status text;
  v_new_member_id uuid;
begin
  -- (1) Membresía activa actual del usuario.
  select id, agency_id into v_old_member_id, v_old_agency_id
    from public.agency_members
   where user_id = p_user_id and status = 'active'
   limit 1;

  if v_old_member_id is null then
    raise exception 'NOT_CURRENT_MEMBER' using errcode = 'P0001';
  end if;

  -- (2) No-op explícito: cambiar a la misma agencia se rechaza (evita duplicar
  --     fila o pisar removed_at con un no-op).
  if v_old_agency_id = p_target_agency_id then
    raise exception 'SAME_AGENCY' using errcode = 'P0001';
  end if;

  -- (3)(4) Agencia destino: debe existir y estar activa.
  select status into v_target_status
    from public.agencies
   where id = p_target_agency_id;

  if not found then
    raise exception 'TARGET_AGENCY_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_target_status <> 'active' then
    raise exception 'TARGET_AGENCY_INACTIVE' using errcode = 'P0001';
  end if;

  -- (5) Desactivar la membresía vieja ANTES de crear la nueva -- nunca deja
  --     observable un estado con 2 filas activas (una función PL/pgSQL es un
  --     solo statement: los efectos intermedios no son visibles ni siquiera
  --     dentro de la misma transacción de un caller externo).
  update public.agency_members
     set status = 'removed', removed_at = now()
   where id = v_old_member_id;

  begin
    insert into public.agency_members (agency_id, user_id, member_role, status)
    values (p_target_agency_id, p_user_id, 'agent', 'active')
    returning id into v_new_member_id;
  exception when unique_violation then
    raise exception 'ALREADY_ACTIVE_MEMBER' using errcode = 'P0001';
  end;

  -- (6) Denormalización del perfil: agencia nueva. role NO se toca (el usuario
  --     ya era agent/admin antes de cambiar de agencia).
  update public.users
     set agency_id = p_target_agency_id
   where id = p_user_id;

  old_agency_id := v_old_agency_id;
  new_agency_id := p_target_agency_id;
  agency_member_id := v_new_member_id;
  return next;
end;
$$;

comment on function public.switch_agency_atomic(uuid, uuid) is
  'Cambio atómico de agencia (§4.6): desactiva la membresía activa actual (status=removed) '
  'e inserta una nueva en la agencia destino (member_role=agent siempre, status=active), '
  'denormaliza users.agency_id. Followers se conservan gratis (el follow es al agente, no '
  'a la agencia) -- verificación explícita diferida a #78. Errores (SQLSTATE P0001): '
  'NOT_CURRENT_MEMBER, SAME_AGENCY, TARGET_AGENCY_NOT_FOUND, TARGET_AGENCY_INACTIVE, '
  'ALREADY_ACTIVE_MEMBER. Llamar SOLO con service_role.';

revoke all on function public.switch_agency_atomic(uuid, uuid) from public;
revoke all on function public.switch_agency_atomic(uuid, uuid) from anon, authenticated;
grant execute on function public.switch_agency_atomic(uuid, uuid) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Cierre del gap de suspensión en properties_insert (hallazgo sección J del
--    RED, supabase/tests/26_agency_member_management_test.sql).
-- ════════════════════════════════════════════════════════════════════════════
-- La policy vigente (20260604000010) solo miraba users.role, nunca
-- agency_members.status: un agente cuya membresía de agencia dejó de estar
-- 'active' (suspendida o removida) seguía pudiendo insertar properties con
-- agency_id de esa agencia. Cambio mínimo: cuando agency_id no es null, exigir
-- que el caller tenga una membresía ACTIVA en esa agencia
-- (private.agency_role_of ya encapsula exactamente "rol activo o NULL",
-- 20260805000003) -- reuso del helper existente, sin agregar uno nuevo.
--
-- El agente INDEPENDIENTE (users.agency_id null, sin fila en agency_members)
-- sigue publicando sin restricción adicional: agency_id es null en su INSERT,
-- así que la cláusula nueva no aplica (comportamiento actual respetado,
-- verificado en la sección J-29 [INVARIANTE] del RED).

drop policy if exists properties_insert on public.properties;
create policy properties_insert on public.properties for insert to authenticated
  with check (
    owner_user_id = (select auth.uid())
    and private.current_user_role() in ('agent', 'admin')
    and (agency_id is null or private.agency_role_of(agency_id) is not null)
  );
