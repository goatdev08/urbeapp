-- ROLLBACK de 20260905100001_motivo_en_espejos_de_rechazo.sql (#237).
--
-- Restaura las TRES funciones a su forma anterior: el motivo vuelve a viajar
-- solo en `data.rejection_reason` y el `body` vuelve a callar el porqué. Es
-- decir, reabre deliberadamente el hueco — solo tiene sentido si el cambio de
-- texto rompiera algo inesperado en un lector que nadie recordaba.
--
-- Cuerpos copiados de pg_get_functiondef sobre producción ANTES de aplicar la
-- migración (2026-09-02). Firmas y grants intactos: `create or replace` no los
-- toca, y el trigger de agent_applications nunca se recreó.
--
-- Round-trip probado: aplicar -> rollback -> re-aplicar, con la suite 93 en
-- FAIL después del rollback (5 asserts) y en PASS después de re-aplicar.

create or replace function public.moderate_ad_atomic(
  p_ad_id uuid, p_next_status text, p_rejection_reason text, p_admin_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rows integer;
  v_old_status public.ad_status;
  v_mirror_type text;
  v_ad_title text;
  v_title text;
  v_body text;
begin
  if p_next_status is null or p_next_status not in ('active', 'rejected', 'paused') then
    raise exception 'INVALID_NEXT_STATUS' using errcode = 'P0001';
  end if;
  perform set_config('urbea.admin_actor_id', p_admin_id::text, true);
  select status into v_old_status from public.ads where id = p_ad_id;
  update public.ads
     set status           = p_next_status::public.ad_status,
         rejection_reason = p_rejection_reason
   where id = p_ad_id;
  get diagnostics v_rows = row_count;
  if v_rows > 0
     and v_old_status is distinct from p_next_status::public.ad_status
     and (p_next_status <> 'active' or v_old_status = 'pending_review')
  then
    v_mirror_type := case p_next_status
      when 'active' then 'ad_approved'
      when 'rejected' then 'ad_rejected'
      when 'paused' then 'ad_paused'
    end;
    select title into v_ad_title from public.ads where id = p_ad_id;
    v_title := case p_next_status
      when 'active' then 'Tu anuncio fue aprobado'
      when 'rejected' then 'Tu anuncio fue rechazado'
      when 'paused' then 'Tu anuncio fue pausado'
    end;
    v_body := case p_next_status
      when 'active' then 'Tu anuncio "' || v_ad_title || '" fue aprobado y ya está activo.'
      when 'rejected' then 'Tu anuncio "' || v_ad_title || '" fue rechazado.'
      when 'paused' then 'Tu anuncio "' || v_ad_title || '" fue retirado (pausado) por un administrador.'
    end;
    insert into public.notifications (
      user_id, type, title, body, deep_link,
      related_entity_type, related_entity_id, data
    )
    select
      am.user_id, v_mirror_type, v_title, v_body, '/ads',
      'ad', p_ad_id,
      jsonb_build_object('ad_title', v_ad_title)
        || case when p_rejection_reason is not null
             then jsonb_build_object('rejection_reason', p_rejection_reason)
             else '{}'::jsonb
           end
    from public.ads a
    join public.agency_members am
      on am.agency_id = a.agency_id
     and am.status = 'active'
     and am.member_role in ('owner', 'admin')
     and am.user_id is distinct from p_admin_id
    where a.id = p_ad_id;
  end if;
  return v_rows;
end;
$function$;

create or replace function public.moderate_property_atomic(
  p_admin_id uuid, p_property_id uuid, p_action_type text,
  p_old_values jsonb, p_new_values jsonb,
  p_reason text default null::text,
  p_new_property_status text default null::text,
  p_changed_fields jsonb default null::jsonb,
  p_revision_id uuid default null::uuid,
  p_revision_status text default null::text,
  p_revision_reason text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_rows int;
  v_old_revision_status property_revision_status;
  v_old_property_status property_status;
  v_should_mirror boolean := false;
  v_mirror_type text;
  v_recipient uuid;
  v_reason text;
  v_property_address text;
  v_title text;
  v_body text;
begin
  if p_admin_id is null or p_property_id is null then
    raise exception 'admin_id y property_id son requeridos' using errcode = 'P0001';
  end if;
  if p_action_type is null or trim(p_action_type) = '' then
    raise exception 'action_type es requerido' using errcode = 'P0001';
  end if;
  if p_revision_id is not null and p_revision_status is null then
    raise exception 'revision_status es requerido al resolver una revisión' using errcode = 'P0001';
  end if;
  if p_revision_id is not null then
    select status into v_old_revision_status
    from public.property_revisions where id = p_revision_id;
  end if;
  select status into v_old_property_status
  from public.properties where id = p_property_id;
  if p_changed_fields is not null then
    update public.properties set
      operation_type = case when p_changed_fields ? 'operation_type'
        then (p_changed_fields->>'operation_type')::operation_type else operation_type end,
      property_type = case when p_changed_fields ? 'property_type'
        then (p_changed_fields->>'property_type')::property_type else property_type end,
      price = case when p_changed_fields ? 'price'
        then (p_changed_fields->>'price')::numeric else price end,
      bedrooms = case when p_changed_fields ? 'bedrooms'
        then (p_changed_fields->>'bedrooms')::integer else bedrooms end,
      bathrooms = case when p_changed_fields ? 'bathrooms'
        then (p_changed_fields->>'bathrooms')::integer else bathrooms end,
      square_meters = case when p_changed_fields ? 'square_meters'
        then (p_changed_fields->>'square_meters')::numeric else square_meters end,
      built_square_meters = case when p_changed_fields ? 'built_square_meters'
        then (p_changed_fields->>'built_square_meters')::numeric else built_square_meters end,
      half_bathrooms = case when p_changed_fields ? 'half_bathrooms'
        then (p_changed_fields->>'half_bathrooms')::integer else half_bathrooms end,
      currency = case when p_changed_fields ? 'currency'
        then p_changed_fields->>'currency' else currency end,
      address = case when p_changed_fields ? 'address'
        then p_changed_fields->>'address' else address end,
      location = case when p_changed_fields ? 'location'
        then (p_changed_fields->>'location')::extensions.geography else location end,
      price_visible = case when p_changed_fields ? 'price_visible'
        then (p_changed_fields->>'price_visible')::boolean else price_visible end,
      pet_friendly = case when p_changed_fields ? 'pet_friendly'
        then (p_changed_fields->>'pet_friendly')::boolean else pet_friendly end,
      allows_no_guarantor = case when p_changed_fields ? 'allows_no_guarantor'
        then (p_changed_fields->>'allows_no_guarantor')::boolean else allows_no_guarantor end,
      student_friendly = case when p_changed_fields ? 'student_friendly'
        then (p_changed_fields->>'student_friendly')::boolean else student_friendly end,
      description = case when p_changed_fields ? 'description'
        then p_changed_fields->>'description' else description end,
      updated_at = now()
    where id = p_property_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'propiedad % no encontrada al aplicar el snapshot', p_property_id
        using errcode = 'P0001';
    end if;
  end if;
  if p_new_property_status is not null then
    update public.properties
       set status = p_new_property_status::property_status,
           updated_at = now()
     where id = p_property_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'propiedad % no encontrada al mover status', p_property_id
        using errcode = 'P0001';
    end if;
  end if;
  if p_revision_id is not null then
    update public.property_revisions
       set status = p_revision_status::property_revision_status,
           reviewed_by_admin_id = p_admin_id,
           reviewed_at = now(),
           rejection_reason = p_revision_reason
     where id = p_revision_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'revisión % no encontrada al resolverla', p_revision_id
        using errcode = 'P0001';
    end if;
  end if;
  insert into public.admin_actions
    (admin_id, action_type, entity_type, entity_id, old_values, new_values, reason)
  values
    (p_admin_id, p_action_type, 'property', p_property_id, p_old_values, p_new_values, p_reason);
  if p_action_type in ('approve', 'needs_changes', 'reject') then
    v_mirror_type := case p_action_type
      when 'approve' then 'property_revision_approved'
      when 'needs_changes' then 'property_revision_needs_changes'
      when 'reject' then 'property_revision_rejected'
    end;
    if p_revision_id is not null then
      if v_old_revision_status is distinct from p_revision_status::property_revision_status then
        v_should_mirror := true;
      end if;
      select submitted_by into v_recipient
      from public.property_revisions where id = p_revision_id;
      v_reason := p_revision_reason;
    else
      if p_new_property_status is not null
         and v_old_property_status is distinct from p_new_property_status::property_status then
        v_should_mirror := true;
      end if;
      select owner_user_id into v_recipient
      from public.properties where id = p_property_id;
      v_reason := p_reason;
    end if;
    if v_should_mirror and v_recipient is not null and v_recipient is distinct from p_admin_id then
      select address into v_property_address from public.properties where id = p_property_id;
      v_title := case p_action_type
        when 'approve' then 'Tu propiedad fue aprobada'
        when 'needs_changes' then 'Tu propiedad necesita cambios'
        when 'reject' then 'Tu propiedad fue rechazada'
      end;
      v_body := case p_action_type
        when 'approve' then 'Tu propiedad en "' || v_property_address || '" fue aprobada y ya está activa.'
        when 'needs_changes' then 'Tu propiedad en "' || v_property_address || '" necesita cambios antes de poder publicarse.'
        when 'reject' then 'Tu propiedad en "' || v_property_address || '" fue rechazada.'
      end;
      insert into public.notifications (
        user_id, type, title, body, deep_link,
        related_entity_type, related_entity_id, data
      )
      values (
        v_recipient, v_mirror_type, v_title, v_body, '/profile/my-listings',
        'property', p_property_id,
        jsonb_build_object('address', v_property_address)
          || case when v_reason is not null
               then jsonb_build_object('rejection_reason', v_reason)
               else '{}'::jsonb
             end
      );
    end if;
  end if;
end;
$function$;

create or replace function public.handle_agent_application_status_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
    if old.user_id is distinct from v_admin_id then
      insert into public.notifications (
        user_id, type, title, body, deep_link,
        related_entity_type, related_entity_id, data
      )
      values (
        old.user_id, 'agent_application_approved',
        'Tu solicitud de agente fue aprobada',
        'Tu solicitud de agente fue aprobada.',
        '/profile', 'agent_application', new.id,
        jsonb_build_object('application_type', new.application_type::text)
      );
    end if;
  else
    insert into public.admin_actions (admin_id, action_type, entity_type, entity_id, old_values, new_values, reason)
    values (
      v_admin_id, 'reject_agent_application', 'agent_application', new.id,
      jsonb_build_object('status', old.status::text),
      jsonb_build_object('status', new.status::text),
      new.rejection_reason
    );
    if old.user_id is distinct from v_admin_id then
      insert into public.notifications (
        user_id, type, title, body, deep_link,
        related_entity_type, related_entity_id, data
      )
      values (
        old.user_id, 'agent_application_rejected',
        'Tu solicitud de agente fue rechazada',
        'Tu solicitud de agente fue rechazada.',
        '/profile', 'agent_application', new.id,
        jsonb_build_object('application_type', new.application_type::text)
          || jsonb_build_object('rejection_reason', new.rejection_reason)
      );
    end if;
  end if;
  return new;
end;
$function$;
