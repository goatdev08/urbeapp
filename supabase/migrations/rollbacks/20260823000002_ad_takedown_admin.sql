-- Rollback de 20260823000002_ad_takedown_admin.sql (subtarea #210.1).
--
-- Restaura VERBATIM los TRES cuerpos vigentes ANTES de esta migración:
--   · public.moderate_ad_atomic       ← 20260822000002 (guard solo active/rejected)
--   · public.handle_ad_status_change  ← 20260822000003 (sin guard de suspensión)
--   · public.handle_agency_status_change ← 20260816000006 (sin el GUC de cascada)
--
-- ⚠️ Efecto: 'paused' vuelve a ser INVALID_NEXT_STATUS en la RPC — un admin
-- ya NO podrá pausar/resumir anuncios activos desde la Edge Function
-- moderate-ad (500/409 según el caso). El guard AD_PAUSED_BY_SUSPENSION
-- desaparece: un UPDATE directo o una RPC futura podrían volver a resucitar
-- un ad pausado por suspensión de organización sin que nada lo impida. La
-- cascada de reactivación de organización (169.2) sigue funcionando igual
-- que siempre (el GUC que instalaba ya no existe en ningún lado, así que su
-- ausencia es inofensiva). No se pierde ningún dato: ningún anuncio cambia
-- de estado al revertir, y la auditoría ya escrita en admin_actions queda
-- intacta.

create or replace function public.moderate_ad_atomic(
  p_ad_id            uuid,
  p_next_status      text,
  p_rejection_reason text,
  p_admin_id         uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  if p_next_status is null or p_next_status not in ('active', 'rejected') then
    raise exception 'INVALID_NEXT_STATUS' using errcode = 'P0001';
  end if;

  perform set_config('urbea.admin_actor_id', p_admin_id::text, true);

  update public.ads
     set status           = p_next_status::public.ad_status,
         rejection_reason = p_rejection_reason
   where id = p_ad_id;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.moderate_ad_atomic(uuid, text, text, uuid) is
  'Modera un anuncio (subtarea #208.1): instala p_admin_id en el GUC '
  'urbea.admin_actor_id (transacción local) y hace UN update sobre public.ads. '
  'La validez de la transición, el guard de organización suspendida y la '
  'auditoría en admin_actions los aplica el trigger handle_ad_status_change() '
  '— esta RPC NO los duplica. p_next_status solo admite active|rejected '
  '(INVALID_NEXT_STATUS si no). Devuelve las filas afectadas: 0 = el anuncio '
  'no existe (sin excepción, para que el caller responda 404), 1 = moderado. '
  'SOLO service_role: instala un admin_actor arbitrario.';

revoke execute on function public.moderate_ad_atomic(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.moderate_ad_atomic(uuid, text, text, uuid)
  to service_role;

create or replace function public.handle_ad_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid;
begin
  if not (
    (old.status = 'draft' and new.status = 'pending_review')
    or (old.status = 'pending_review' and new.status in ('active', 'rejected'))
    or (old.status = 'active' and new.status in ('paused', 'expired', 'rejected', 'pending_review'))
    or (old.status = 'paused' and new.status = 'active')
  ) then
    raise exception 'INVALID_AD_STATUS_TRANSITION' using errcode = 'P0001';
  end if;

  if old.status = 'active' and new.status = 'pending_review' then
    if old.description is distinct from new.description then
      return new;
    else
      raise exception 'INVALID_AD_STATUS_TRANSITION' using errcode = 'P0001';
    end if;
  end if;

  v_admin_id := private.resolve_admin_actor();

  if old.status = 'pending_review' and new.status = 'active' then
    if exists (
      select 1 from public.agencies where id = new.agency_id and status = 'suspended'
    ) then
      raise exception 'ORGANIZATION_SUSPENDED' using errcode = 'P0001';
    end if;
  end if;

  if old.status = 'active' and new.status = 'paused' then
    new.paused_at := now();
  elsif old.status = 'paused' and new.status = 'active' then
    new.ends_at := old.ends_at + (now() - old.paused_at);
    new.paused_at := null;
    new.paused_by_suspension := false;
  end if;

  insert into public.admin_actions (admin_id, action_type, entity_type, entity_id, old_values, new_values)
  values (
    v_admin_id, 'change_ad_status', 'ad', new.id,
    jsonb_build_object('status', old.status::text),
    jsonb_build_object('status', new.status::text)
  );

  return new;
end;
$$;

comment on function public.handle_ad_status_change() is
  'Trigger BEFORE UPDATE en ads (169.2 + #192 + 208.1): ÚNICA autoridad de la '
  'máquina de estados {draft→pending_review, pending_review→{active,rejected}, '
  'active→{paused,expired,rejected,pending_review}, paused→active}, más '
  'active→pending_review SOLO como democión de SISTEMA (la descripción '
  'cambió en el mismo UPDATE — sin admin, sin auditoría). 208.1 agregó '
  'pending_review→rejected: rechazar en revisión es el acto normal de '
  'moderación y antes era INALCANZABLE (había que activar el anuncio '
  'primero, publicando lo que se quería rechazar). Para las demás '
  'transiciones exige un admin identificado (private.resolve_admin_actor), '
  'bloquea activar bajo una organización suspendida (ORGANIZATION_SUSPENDED), '
  'aplica D2 "pausar el reloj" y registra SIEMPRE en admin_actions en la '
  'misma transacción.';

create or replace function public.handle_agency_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid;
begin
  if not (
    (old.status = 'pending_approval' and new.status in ('active', 'rejected'))
    or (old.status = 'active' and new.status = 'suspended')
    or (old.status = 'suspended' and new.status = 'active')
  ) then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001';
  end if;

  v_admin_id := private.resolve_admin_actor();

  if old.status = 'pending_approval' and new.status = 'active' then
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
  elsif old.status = 'pending_approval' and new.status = 'rejected' then
    insert into public.admin_actions (admin_id, action_type, entity_type, entity_id, old_values, new_values)
    values (
      v_admin_id, 'reject_agency', 'agency', new.id,
      jsonb_build_object('status', old.status::text),
      jsonb_build_object('status', new.status::text)
    );
  elsif old.status = 'active' and new.status = 'suspended' then
    update public.ads
       set status = 'paused', paused_by_suspension = true
     where agency_id = new.id and status = 'active';

    insert into public.admin_actions (admin_id, action_type, entity_type, entity_id, old_values, new_values)
    values (
      v_admin_id, 'suspend_agency', 'agency', new.id,
      jsonb_build_object('status', old.status::text),
      jsonb_build_object('status', new.status::text)
    );
  elsif old.status = 'suspended' and new.status = 'active' then
    update public.ads
       set status = 'active'
     where agency_id = new.id and status = 'paused' and paused_by_suspension = true;

    insert into public.admin_actions (admin_id, action_type, entity_type, entity_id, old_values, new_values)
    values (
      v_admin_id, 'reactivate_agency', 'agency', new.id,
      jsonb_build_object('status', old.status::text),
      jsonb_build_object('status', new.status::text)
    );
  end if;

  return new;
end;
$$;

comment on function public.handle_agency_status_change() is
  'Trigger BEFORE UPDATE en agencies (71.5, fix 99, 169.2): valida la máquina '
  'de estados {pending_approval->active, pending_approval->rejected, '
  'active->suspended, suspended->active}, exige un admin identificado (D3/D4), '
  'aplica D5 (aprobar: membresía owner + promoción SOLO si no era admin + '
  'agency_id, SOLO en pending_approval->active) / D6 (rechazar: solo '
  'auditoría) / cascada D2 169.2 (suspender: pausa los ads active de la '
  'agencia; reactivar: revive SOLO los que pausó esa cascada). '
  'pending_approval->suspended sigue fuera de alcance -- INVALID_STATUS_TRANSITION.';
