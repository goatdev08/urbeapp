-- Rollback de 20260816000006_ads_state_machine.sql (subtarea 169.2)
--
-- 1) Restaura el body EXACTO de public.handle_agency_status_change() de
--    20260805000010 (pre-169.2): SOLO {pending_approval->active,
--    pending_approval->rejected}, sin active<->suspended ni cascada a ads.
-- 2) Elimina el trigger + función nuevos de public.ads
--    (ads_status_change / handle_ad_status_change).
-- 3) Elimina las 2 columnas de contabilidad de public.ads
--    (paused_at, paused_by_suspension) -- aditivas de esta migración, sin
--    nada más dependiendo de ellas.
--
-- Re-ejecutable: create or replace + drop trigger/function/column if exists.

-- ════════════════════════════════════════════════════════════════════════════
-- 1) public.handle_agency_status_change() — restaura el body de 20260805000010.
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
        raise exception 'MEMBER_OF_OTHER_AGENCY' using errcode = 'P0001', hint =
          'El creador ya tiene una membresía activa en otra agencia. Remuévelo o '
          'cámbialo de esa agencia (EF manage-agency-member o Studio) antes de '
          'volver a intentar esta aprobación.';
    end;

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

-- ════════════════════════════════════════════════════════════════════════════
-- 2) public.ads — quita el trigger + función nuevos de 169.2.
-- ════════════════════════════════════════════════════════════════════════════

drop trigger if exists ads_status_change on public.ads;
drop function if exists public.handle_ad_status_change();

-- ════════════════════════════════════════════════════════════════════════════
-- 3) public.ads — quita las 2 columnas de contabilidad de D2.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.ads drop column if exists paused_at;
alter table public.ads drop column if exists paused_by_suspension;
