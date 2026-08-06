-- Migración — Aprobaciones admin vía estado (subtarea 71.5, PRD §4.7/§4.8)
-- Propósito: dos TRIGGERS BEFORE UPDATE (public.agencies, public.agent_applications)
-- que validan la máquina de estados y registran auditoría en admin_actions cuando el
-- super-admin de beta aprueba/rechaza vía UPDATE directo en Supabase Studio/SQL. NO
-- hay Edge Functions aquí (decisión de Abraham 2026-08-05, ver subtarea): Studio corre
-- como `postgres` (bypassea RLS), así que la máquina de estados y la auditoría SOLO
-- pueden vivir en el trigger, que corre SIEMPRE sin importar el rol del actor.
--
-- Contrato completo, las 9 decisiones de seam (D1-D9) y los 78 asserts pgTAP:
-- supabase/tests/25_admin_approvals_test.sql (léelo primero, es la fuente de verdad).
-- Resumen de las decisiones que este archivo implementa:
--   D1/D2 agencies: SOLO {pending_approval->active, pending_approval->rejected}.
--   D3    agencies.status YA está excluido del GRANT de columna a `authenticated`
--         (20260604000008:409-412) -> el único camino real de aprobación es Studio;
--         el trigger no necesita duplicar el check de actor para `authenticated`
--         en agencies (ya bloqueado, estructural). agent_applications SÍ admite el
--         camino admin-vía-JWT (sin esa restricción de columna).
--   D4    actor = coalesce(auth.uid() si es admin real, GUC de sesión
--         `urbea.admin_actor_id` si apunta a un admin real) -> helper
--         private.resolve_admin_actor(), sin ninguno -> STATUS_CHANGE_REQUIRES_ADMIN.
--   D5    aprobar agencia: agency_members(owner,active) + users.role='agent' +
--         users.agency_id=<nueva> (idempotente); conflicto de membresía activa en
--         OTRA agencia -> ALREADY_ACTIVE_MEMBER (remapeo del unique_violation del
--         índice agency_members_one_active_per_user), rollback total del UPDATE.
--   D6    rechazar agencia: solo status + auditoría, approved_by_admin_id intacto.
--   D7    agent_applications: SOLO {pending->approved, pending->rejected}, finales
--         inmutables; rechazar exige rejection_reason no NULL.
--   D8    aprobar application: SOLO 'independent' promueve role='agent' (agency_id
--         se deja como esté); reviewed_by_admin_id/reviewed_at en AMBOS approve/reject.
--   D9    admin_actions inmutable: mismo patrón que user_consents (20260727000003)
--         -- REVOKE UPDATE/DELETE/TRUNCATE de anon/authenticated; el INSERT directo
--         de un admin sigue permitido (política admin_actions_insert vigente).
--
-- Ambos triggers llevan `for each row when (old.status is distinct from new.status)`:
-- un UPDATE que reescribe el mismo status es un no-op benigno, ni siquiera llega al
-- check de actor (edge case 8, INVARIANTE ya hoy sin trigger -- lo preservamos).
--
-- SECURITY DEFINER en ambas funciones de trigger: los efectos (agency_members, users,
-- admin_actions) deben aplicarse sin importar el rol/RLS/GRANT de columna del actor
-- que disparó el UPDATE (Studio=postgres ya bypassea todo; pero el camino admin-vía-JWT
-- de agent_applications SÍ está sujeto al GRANT de columna que excluye role/agency_id
-- de `authenticated` sobre public.users, 20260604000008:404-407 -- SECURITY DEFINER,
-- corriendo como el dueño de la función [postgres, quien aplica migraciones], bypasea
-- ese GRANT igual que bypasea RLS).
--
-- Idempotente: create or replace + drop trigger if exists + revoke repetible.
-- Rollback: supabase/migrations/rollbacks/20260805000007_admin_approval_transitions.sql

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Helper: resolución del admin actor (D3/D4)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function private.resolve_admin_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_jwt_uid uuid;
  v_guc_uid uuid;
begin
  -- Camino 1: JWT authenticated con role=admin real (PostgREST, agent_applications).
  v_jwt_uid := auth.uid();
  if v_jwt_uid is not null and exists (
    select 1 from public.users where id = v_jwt_uid and role = 'admin'
  ) then
    return v_jwt_uid;
  end if;

  -- Camino 2: GUC de sesión (Studio/SQL editor, auth.uid() es NULL ahí). Convención:
  -- `select set_config('urbea.admin_actor_id', '<uuid-del-admin>', true);` antes del
  -- UPDATE. Un valor no-uuid o vacío se trata igual que "no identificado".
  begin
    v_guc_uid := nullif(current_setting('urbea.admin_actor_id', true), '')::uuid;
  exception
    when invalid_text_representation then
      v_guc_uid := null;
  end;

  if v_guc_uid is not null and exists (
    select 1 from public.users where id = v_guc_uid and role = 'admin'
  ) then
    return v_guc_uid;
  end if;

  raise exception 'STATUS_CHANGE_REQUIRES_ADMIN' using errcode = 'P0001';
end;
$$;

comment on function private.resolve_admin_actor() is
  'D4: resuelve el admin actor para los triggers de aprobación de 71.5 -- '
  'coalesce(auth.uid() si es admin real, GUC de sesión urbea.admin_actor_id si apunta '
  'a un admin real). Sin ninguno de los dos -> STATUS_CHANGE_REQUIRES_ADMIN (P0001). '
  'Deliberadamente NO hay heurística "primer admin de la tabla" (no determinista con '
  'el seed demo). Convención Studio: '
  '`select set_config(''urbea.admin_actor_id'', ''<uuid>'', true);` antes del UPDATE.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Trigger: public.agencies (D1/D2/D5/D6)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.handle_agency_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid;
begin
  -- D2: única máquina de estados soportada por esta migración.
  if not (old.status = 'pending_approval' and new.status in ('active', 'rejected')) then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001';
  end if;

  -- D3/D4: exige un admin identificado. En la práctica esto SOLO se ejecuta vía
  -- Studio (agencies.status está fuera del GRANT de columna a `authenticated`, ver
  -- cabecera D3) -- pero el trigger lo exige igual, sin asumir el camino de entrada.
  v_admin_id := private.resolve_admin_actor();

  if new.status = 'active' then
    -- D5: aprobar -> membresía owner activa + promoción/denormalización del creador.
    -- Sin ON CONFLICT DO NOTHING: el unique_violation debe propagarse tipado y
    -- abortar TODO el UPDATE (atomicidad de sentencia -- ninguna insert/update previa
    -- de este bloque sobrevive si truena).
    begin
      insert into public.agency_members (agency_id, user_id, member_role, status)
      values (new.id, old.created_by_user_id, 'owner', 'active');
    exception
      when unique_violation then
        raise exception 'ALREADY_ACTIVE_MEMBER' using errcode = 'P0001';
    end;

    update public.users
       set role      = 'agent',
           agency_id = new.id
     where id = old.created_by_user_id;

    new.approved_by_admin_id := v_admin_id;

    insert into public.admin_actions (admin_id, action_type, entity_type, entity_id, old_values, new_values)
    values (
      v_admin_id, 'approve_agency', 'agency', new.id,
      jsonb_build_object('status', old.status::text),
      jsonb_build_object('status', new.status::text)
    );
  else
    -- D6: rechazar -> solo status + auditoría. approved_by_admin_id NO se toca
    -- (queda en lo que ya traía la fila -- el nombre de la columna es "aprobado por").
    insert into public.admin_actions (admin_id, action_type, entity_type, entity_id, old_values, new_values)
    values (
      v_admin_id, 'reject_agency', 'agency', new.id,
      jsonb_build_object('status', old.status::text),
      jsonb_build_object('status', new.status::text)
    );
  end if;

  return new;
end;
$$;

comment on function public.handle_agency_status_change() is
  'Trigger BEFORE UPDATE en agencies (subtarea 71.5): valida la máquina de estados '
  '{pending_approval->active, pending_approval->rejected} (D1/D2), exige un admin '
  'identificado (D3/D4), aplica los efectos de D5 (aprobar: membresía owner + '
  'promoción + agency_id) o D6 (rechazar: solo auditoría) y registra en admin_actions. '
  'Solo se dispara si status realmente cambia (WHEN clause del CREATE TRIGGER).';

drop trigger if exists agencies_status_change on public.agencies;
create trigger agencies_status_change
  before update on public.agencies
  for each row
  when (old.status is distinct from new.status)
  execute function public.handle_agency_status_change();

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Trigger: public.agent_applications (D7/D8)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.handle_agent_application_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid;
begin
  -- D7: única máquina de estados soportada; approved/rejected son terminales.
  if not (old.status = 'pending' and new.status in ('approved', 'rejected')) then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001';
  end if;

  if new.status = 'rejected' and new.rejection_reason is null then
    raise exception 'REJECTION_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  -- D3/D4: mismo helper que agencies. Aquí SÍ hay camino admin-vía-JWT real
  -- (agent_applications no tiene la restricción de columna de D3): igual se exige
  -- el actor identificado para cubrir el caso Studio-sin-identificarse (§9).
  v_admin_id := private.resolve_admin_actor();

  -- D8: reviewed_by_admin_id/reviewed_at se setean en AMBOS approve y reject.
  new.reviewed_by_admin_id := v_admin_id;
  new.reviewed_at := now();

  if new.status = 'approved' then
    -- D8: SOLO 'independent' promueve; 'under_agency' se resuelve por otro flujo
    -- (redeem-invitation) -- agency_id se deja como esté, sin constraint cruzado.
    if old.application_type = 'independent' then
      update public.users set role = 'agent' where id = old.user_id;
    end if;

    insert into public.admin_actions (admin_id, action_type, entity_type, entity_id, old_values, new_values)
    values (
      v_admin_id, 'approve_agent_application', 'agent_application', new.id,
      jsonb_build_object('status', old.status::text),
      jsonb_build_object('status', new.status::text)
    );
  else
    insert into public.admin_actions (admin_id, action_type, entity_type, entity_id, old_values, new_values, reason)
    values (
      v_admin_id, 'reject_agent_application', 'agent_application', new.id,
      jsonb_build_object('status', old.status::text),
      jsonb_build_object('status', new.status::text),
      new.rejection_reason
    );
  end if;

  return new;
end;
$$;

comment on function public.handle_agent_application_status_change() is
  'Trigger BEFORE UPDATE en agent_applications (subtarea 71.5): valida la máquina de '
  'estados {pending->approved, pending->rejected} (D7), exige rejection_reason al '
  'rechazar, exige un admin identificado (D3/D4), promueve role=agent SOLO si '
  'application_type=independent (D8) y registra en admin_actions. Solo se dispara si '
  'status realmente cambia (WHEN clause del CREATE TRIGGER).';

drop trigger if exists agent_applications_status_change on public.agent_applications;
create trigger agent_applications_status_change
  before update on public.agent_applications
  for each row
  when (old.status is distinct from new.status)
  execute function public.handle_agent_application_status_change();

-- ════════════════════════════════════════════════════════════════════════════
-- 4) admin_actions: inmutabilidad append-only (D9, patrón user_consents 20260727000003)
-- ════════════════════════════════════════════════════════════════════════════
-- El INSERT directo de un admin autenticado sigue permitido (política
-- admin_actions_insert vigente desde 0008/0010) -- solo se cierra UPDATE/DELETE/
-- TRUNCATE, que hoy no tienen ninguna restricción explícita (UPDATE/DELETE ya
-- fallaban por ausencia de política RLS -- 0 filas silenciosas, no excepción -- pero
-- TRUNCATE no respeta RLS y hereda el GRANT default de Supabase: mismo agujero que
-- user_consents documentó, tarea #92 pendiente de cerrarlo de forma sistémica).
revoke update, delete on public.admin_actions from authenticated;
revoke truncate on public.admin_actions from anon, authenticated;
