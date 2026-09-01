-- ROLLBACK de 20260903100001_agency_rejection_reason.sql (tarea #234).
-- Deja el backend EXACTAMENTE como estaba antes: el motivo del rechazo vuelve
-- a vivir SOLO en admin_actions y el espejo 'agency_rejected' vuelve a llegar
-- sin el porqué (la limitación que anclaba REJ5 de la suite 84).
--
-- ⚠️ Este rollback SÍ PIERDE DATOS: `drop column rejection_reason` borra los
-- motivos ya escritos. No hay copia — admin_actions conserva el suyo, que es
-- justo por qué esa fila de auditoría se mantuvo. Aplicarlo en el remoto solo
-- con aprobación explícita de Abraham (§0.5).
--
-- ORDEN: primero se restauran las 2 funciones a sus cuerpos previos (así
-- ninguna queda nombrando una columna que ya no existe), después se quita la
-- columna. Idempotente: `create or replace` + `drop column if exists`.
--
-- Tras aplicarlo, la suite 85 falla entera y la 84 falla en REJ5 (ambas
-- describen el mundo POST-#234) — es la señal esperada, no una regresión.

-- ════════════════════════════════════════════════════════════════════════════
-- 1) public.handle_agency_status_change — cuerpo VERBATIM de 20260826000001
--    (el vigente antes de #234, capturado con pg_get_functiondef).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.handle_agency_status_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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

    -- #219.2: espejo de resolución al solicitante. Nunca el admin actor.
    if old.created_by_user_id is distinct from v_admin_id then
      insert into public.notifications (
        user_id, type, title, body, deep_link,
        related_entity_type, related_entity_id, data
      )
      values (
        old.created_by_user_id, 'agency_approved',
        'Tu inmobiliaria fue aprobada',
        'Tu inmobiliaria "' || new.name::text || '" fue aprobada.',
        '/profile', 'agency', new.id,
        jsonb_build_object('agency_name', new.name::text)
      );
    end if;
  elsif old.status = 'pending_approval' and new.status = 'rejected' then
    insert into public.admin_actions (admin_id, action_type, entity_type, entity_id, old_values, new_values)
    values (
      v_admin_id, 'reject_agency', 'agency', new.id,
      jsonb_build_object('status', old.status::text),
      jsonb_build_object('status', new.status::text)
    );

    -- #219.2: espejo de resolución al solicitante. agencies NO tiene
    -- columna de motivo de rechazo -- data NUNCA lleva 'rejection_reason'
    -- aquí (a diferencia de agent_applications).
    if old.created_by_user_id is distinct from v_admin_id then
      insert into public.notifications (
        user_id, type, title, body, deep_link,
        related_entity_type, related_entity_id, data
      )
      values (
        old.created_by_user_id, 'agency_rejected',
        'Tu inmobiliaria fue rechazada',
        'Tu inmobiliaria "' || new.name::text || '" fue rechazada.',
        '/profile', 'agency', new.id,
        jsonb_build_object('agency_name', new.name::text)
      );
    end if;
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
    -- 210.1: marca esta UPDATE como "la cascada legítima" para el guard
    -- AD_PAUSED_BY_SUSPENSION del punto 2 — `true` = is_local, vive solo en
    -- esta transacción. Se limpia justo después del UPDATE para no dejar el
    -- GUC en 'true' por el resto de la transacción (p. ej. si el mismo
    -- caller hiciera otra operación sobre ads después, en la misma request).
    perform set_config('urbea.ad_cascade_reactivation', 'true', true);

    update public.ads
       set status = 'active'
     where agency_id = new.id and status = 'paused' and paused_by_suspension = true;

    perform set_config('urbea.ad_cascade_reactivation', 'false', true);

    insert into public.admin_actions (admin_id, action_type, entity_type, entity_id, old_values, new_values)
    values (
      v_admin_id, 'reactivate_agency', 'agency', new.id,
      jsonb_build_object('status', old.status::text),
      jsonb_build_object('status', new.status::text)
    );
  end if;

  return new;
end;
$function$;

comment on function public.handle_agency_status_change() is null;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) public.resolve_agency_registration — cuerpo VERBATIM de 20260902100003
--    (sin la escritura de rejection_reason). Firma y grants sin cambio.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.resolve_agency_registration(
  p_agency_id uuid,
  p_approve   boolean,
  p_reason    text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid;
  v_status   public.agency_status;
begin
  v_admin_id := private.resolve_admin_actor();

  perform set_config('urbea.admin_actor_id', v_admin_id::text, true);

  select status into v_status
    from public.agencies
   where id = p_agency_id
     and deleted_at is null
   for update;

  if not found then
    raise exception 'AGENCY_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_status <> 'pending_approval' then
    raise exception 'ALREADY_RESOLVED' using errcode = 'P0001';
  end if;

  if not p_approve and (p_reason is null or p_reason !~ '\S') then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  update public.agencies
     set status = case when p_approve then 'active' else 'rejected' end::public.agency_status
   where id = p_agency_id;

  if not p_approve then
    insert into public.admin_actions (
      admin_id, action_type, entity_type, entity_id, old_values, new_values, reason
    )
    values (
      v_admin_id, 'reject_agency_registration', 'agency', p_agency_id,
      jsonb_build_object('status', v_status::text),
      jsonb_build_object('status', 'rejected'),
      p_reason
    );
  end if;
end;
$$;

comment on function public.resolve_agency_registration(uuid, boolean, text) is
  'Puerta ÚNICA para que el admin de plataforma resuelva un REGISTRO de '
  'inmobiliaria (pending_approval -> active|rejected) desde el panel (#221.2). '
  'Cierra el hueco de 71.5/D3: agencies.status está fuera del grant de columna '
  'a authenticated y la EF suspend-agency solo expone suspend|reactivate. '
  'WRAPPER DELGADO: valida al actor (private.resolve_admin_actor), 3 guards de '
  'puerta y UN update — la membresía owner, la promoción de role, '
  'approved_by_admin_id, la auditoría del cambio de estado y el espejo a '
  'notifications los aplica ENTERO el trigger handle_agency_status_change. '
  'Errores P0001: STATUS_CHANGE_REQUIRES_ADMIN, AGENCY_NOT_FOUND (inexistente '
  'o soft-deleted), ALREADY_RESOLVED, REASON_REQUIRED. El motivo del rechazo '
  'se guarda en admin_actions (action_type reject_agency_registration) porque '
  'agencies no tiene columna para él; el espejo agency_rejected NO lo lleva '
  '(limitación conocida, ver cabecera de la migración).';

revoke execute on function public.resolve_agency_registration(uuid, boolean, text) from public, anon;
grant execute on function public.resolve_agency_registration(uuid, boolean, text)
  to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) La columna, al final: ya nadie la nombra.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.agencies
  drop column if exists rejection_reason;
