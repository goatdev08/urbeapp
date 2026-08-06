-- Migración — Fixes de aprobación admin (tarea derivada #99, origen subtarea 71.5)
-- Propósito: dos hallazgos ALTO del review del PR #41 sobre el trigger de 000007
-- (handle_agency_status_change / handle_agent_application_status_change):
--
--   FIX 1 (deadlock de aprobación, decisión de producto de Abraham 2026-08-05:
--   "error tipado + guía manual", NO auto-switch): aprobar una agencia cuyo
--   creador YA tiene membresía activa en OTRA agencia (subió por token mientras
--   esperaba) truena por el índice único agency_members_one_active_per_user. Antes
--   se remapeaba al mismo código que admin_create_agency_atomic/switch_agency_atomic
--   (ALREADY_ACTIVE_MEMBER), sin ninguna guía de qué hacer -- se renombra a
--   MEMBER_OF_OTHER_AGENCY (P0001) con HINT operativo explícito. Sigue abortando
--   TODA la transacción (atomicidad sin cambios) -- el admin debe remover/cambiar
--   al usuario de su agencia actual (manage-agency-member o Studio) y reintentar.
--
--   FIX 2 (degradación silenciosa de admin, sin decisión de producto -- defecto
--   claro): el UPDATE de promoción era incondicional (`role = 'agent'`). Si el
--   creador de la agencia (o el solicitante de una application 'independent') YA
--   es 'admin', quedaba degradado a 'agent' sin aviso. Ambos triggers ahora
--   preservan role='admin' con un guard -- un admin SÍ puede terminar como owner
--   de una agencia (la fila agency_members(owner,active) se sigue creando siempre,
--   y users.agency_id se sigue denormalizando siempre) sin perder su rol.
--
-- Contrato y los 8 asserts nuevos: supabase/tests/25_admin_approvals_test.sql
-- (§6 renombrado, §7-bis y §11-bis nuevos). CREATE OR REPLACE sobre las mismas
-- firmas de 20260805000007 -- no se tocan triggers ni grants, solo los bodies.
--
-- Idempotente: create or replace. Rollback: restaura los bodies originales de 000007.
-- Rollback: supabase/migrations/rollbacks/20260805000010_admin_approval_fixes.sql

create or replace function public.handle_agency_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid;
begin
  if not (old.status = 'pending_approval' and new.status in ('active', 'rejected')) then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001';
  end if;

  v_admin_id := private.resolve_admin_actor();

  if new.status = 'active' then
    begin
      insert into public.agency_members (agency_id, user_id, member_role, status)
      values (new.id, old.created_by_user_id, 'owner', 'active');
    exception
      when unique_violation then
        -- FIX 1: antes ALREADY_ACTIVE_MEMBER (mismo código que las RPCs de alta/
        -- switch, sin contexto). Aquí el significado es distinto -- el admin
        -- necesita saber que debe actuar manualmente antes de reintentar.
        -- Nota: agency_members tiene 2 índices únicos parciales (0003) que este
        -- INSERT podría violar: agency_members_one_active_per_user (el real -- el
        -- creador ya activo en OTRA agencia) y agency_members_agency_user_active
        -- (mismo agencia+usuario). El segundo es INALCANZABLE aquí: el WHEN de
        -- este trigger solo dispara con old.status='pending_approval', y D2
        -- garantiza que pending_approval->active ocurre a lo más una vez por
        -- agencia -- no puede existir ya una fila (new.id, creator, active) antes
        -- de este INSERT. MEMBER_OF_OTHER_AGENCY es siempre certero.
        raise exception 'MEMBER_OF_OTHER_AGENCY' using errcode = 'P0001', hint =
          'El creador ya tiene una membresía activa en otra agencia. Remuévelo o '
          'cámbialo de esa agencia (EF manage-agency-member o Studio) antes de '
          'volver a intentar esta aprobación.';
    end;

    -- FIX 2: nunca degradar a un admin. agency_id SÍ se denormaliza siempre (un
    -- admin puede ser owner de la agencia); role solo se promueve si no era admin.
    update public.users
       set role      = case when role = 'admin' then role else 'agent' end,
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
  'Trigger BEFORE UPDATE en agencies (subtarea 71.5, fix 99): valida la máquina de '
  'estados {pending_approval->active, pending_approval->rejected} (D1/D2), exige un '
  'admin identificado (D3/D4), aplica los efectos de D5 (aprobar: membresía owner + '
  'promoción SOLO si no era admin + agency_id siempre) o D6 (rechazar: solo '
  'auditoría). Conflicto de membresía activa en otra agencia -> MEMBER_OF_OTHER_AGENCY '
  '(fix 99, antes ALREADY_ACTIVE_MEMBER sin guía).';

create or replace function public.handle_agent_application_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid;
begin
  if not (old.status = 'pending' and new.status in ('approved', 'rejected')) then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001';
  end if;

  if new.status = 'rejected' and new.rejection_reason is null then
    raise exception 'REJECTION_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_admin_id := private.resolve_admin_actor();

  new.reviewed_by_admin_id := v_admin_id;
  new.reviewed_at := now();

  if new.status = 'approved' then
    -- FIX 2: mismo guard e idioma que agencies (CASE, no WHERE) -- así la fila
    -- del admin sigue matcheando el UPDATE si en el futuro se agrega otra
    -- columna a esta sentencia; un WHERE role<>'admin' la excluiría en silencio.
    if old.application_type = 'independent' then
      update public.users
         set role = case when role = 'admin' then role else 'agent' end
       where id = old.user_id;
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
  'Trigger BEFORE UPDATE en agent_applications (subtarea 71.5, fix 99): valida la '
  'máquina de estados {pending->approved, pending->rejected} (D7), exige '
  'rejection_reason al rechazar, exige un admin identificado (D3/D4), promueve '
  'role=agent SOLO si application_type=independent Y el solicitante no era ya admin '
  '(D8 + fix 99) y registra en admin_actions.';
