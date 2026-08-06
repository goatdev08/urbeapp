-- Rollback de 20260805000010_admin_approval_fixes.sql (fix 99)
--
-- Re-ejecutable: create or replace restaura los bodies EXACTOS de 000007 (pre-fix):
-- error ALREADY_ACTIVE_MEMBER sin hint, y promoción incondicional a role='agent'
-- (reabre la degradación silenciosa de admin, a propósito -- es el estado previo).

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
