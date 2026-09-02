-- ════════════════════════════════════════════════════════════════════════════
-- #237 — El motivo del rechazo VIAJA a la persona en los tres espejos que
-- quedaron fuera de #234: anuncio, revisión de propiedad y solicitud de agente.
--
-- ── EL HUECO, REPRODUCIDO EN PRODUCCIÓN (2026-09-02) ────────────────────────
-- Un admin rechazó una promoción escribiendo «Prueba». El motivo se guardó en
-- `ads.rejection_reason` y en `data.rejection_reason` de la notificación… y lo
-- que llegó al anunciante fue «Tu anuncio "…" fue rechazado.», sin el porqué.
-- Causa: NotificationCard.tsx (mobile/src/features/notifications/components/)
-- renderiza EXCLUSIVAMENTE `title` y `body`; `data` no se lee en ninguna
-- superficie viva. #234 ya había resuelto esto para el espejo de inmobiliaria y
-- dejó anotados los otros tres — esta migración los alinea.
--
-- ── FORMA (la misma de #234, palabra por palabra) ───────────────────────────
--     v_reason := case when <motivo> ~ '\S' then <motivo> end;
--     body     := <body de hoy> || coalesce(' Motivo: ' || v_reason, '')
-- `~ '\S'` y NUNCA trim(): trim() solo recorta el espacio ASCII y deja pasar
-- tabuladores y saltos de línea (hallazgo 220.1), con lo que un motivo en
-- blanco produciría un body terminado en «Motivo: » vacío — peor que callar.
-- Sin motivo, el body queda BYTE POR BYTE como hoy: es lo que protege a las
-- filas históricas y a cualquier camino que no capture el motivo.
--
-- 🔴 El guard vale para el BODY y para `data.rejection_reason`, pero NO para lo
-- que se PERSISTE ni para la auditoría: `ads.rejection_reason` y
-- `admin_actions.reason` siguen guardando lo que el admin escribió, tal cual.
-- Son registros de lo ocurrido, no mensajes; normalizarlos ahí sería reescribir
-- la evidencia.
--
-- ── 🔴 PRODUCCIÓN VIVA (§0.5) ──────────────────────────────────────────────
--   · Aditivo en lo observable: cambia el TEXTO de un body que el cliente ya
--     pinta. Ningún contrato se rompe — sin motivo el texto es idéntico.
--   · SIN OTA: el cliente no cambia (ya renderiza `body`), así que esto se
--     puede desplegar solo. Es lo contrario de #202.
--   · Firmas y grants intactos: `create or replace` sobre las tres funciones,
--     misma lista de argumentos (anclada por SIG1/SIG2 de la suite 93). El
--     trigger de agent_applications no se recrea: solo su función.
--   · Idempotente y con rollback en supabase/migrations/rollbacks/.
--
-- ALCANCE: 'needs_changes' de una revisión TAMBIÉN lleva el motivo — «tu
-- propiedad necesita cambios» sin decir cuáles es la versión más inútil de este
-- bug, no la más leve. Aprobar nunca lo lleva, aunque el llamador mande uno.
-- Tests: supabase/tests/93_motivo_espejos_rechazo_test.sql (17 asserts).
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1) ANUNCIO — public.moderate_ad_atomic
-- ────────────────────────────────────────────────────────────────────────────
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
  v_reason text;
begin
  if p_next_status is null or p_next_status not in ('active', 'rejected', 'paused') then
    raise exception 'INVALID_NEXT_STATUS' using errcode = 'P0001';
  end if;

  -- #237: motivo normalizado SOLO para lo que se comunica. Lo que se persiste
  -- abajo sigue siendo p_rejection_reason crudo (el CHECK
  -- ads_rejection_reason_matches_status exige NOT NULL exactamente cuando el
  -- estado es 'rejected', y un motivo en blanco lo satisface: por eso este
  -- caso es alcanzable y hay que atajarlo aquí).
  v_reason := case when p_rejection_reason ~ '\S' then p_rejection_reason end;

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
    -- El motivo se pega SOLO en la rama de rechazo: es la única en la que el
    -- CHECK permite que exista uno.
    v_body := case p_next_status
      when 'active' then 'Tu anuncio "' || v_ad_title || '" fue aprobado y ya está activo.'
      when 'rejected' then 'Tu anuncio "' || v_ad_title || '" fue rechazado.'
        || coalesce(' Motivo: ' || v_reason, '')
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
        || case when v_reason is not null
             then jsonb_build_object('rejection_reason', v_reason)
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

-- ────────────────────────────────────────────────────────────────────────────
-- 2) REVISIÓN DE PROPIEDAD — public.moderate_property_atomic
-- ────────────────────────────────────────────────────────────────────────────
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

    -- #237: un único punto de normalización, después de que las dos ramas de
    -- arriba hayan elegido de dónde sale el motivo. La columna
    -- property_revisions.rejection_reason ya quedó escrita con el valor crudo.
    v_reason := case when v_reason ~ '\S' then v_reason end;

    if v_should_mirror and v_recipient is not null and v_recipient is distinct from p_admin_id then
      select address into v_property_address from public.properties where id = p_property_id;
      v_title := case p_action_type
        when 'approve' then 'Tu propiedad fue aprobada'
        when 'needs_changes' then 'Tu propiedad necesita cambios'
        when 'reject' then 'Tu propiedad fue rechazada'
      end;
      -- 'approve' no lleva motivo aunque el llamador mande uno: aprobar no
      -- necesita justificarse y el texto de hoy se conserva byte por byte.
      v_body := case p_action_type
        when 'approve' then 'Tu propiedad en "' || v_property_address || '" fue aprobada y ya está activa.'
        when 'needs_changes' then 'Tu propiedad en "' || v_property_address || '" necesita cambios antes de poder publicarse.'
          || coalesce(' Motivo: ' || v_reason, '')
        when 'reject' then 'Tu propiedad en "' || v_property_address || '" fue rechazada.'
          || coalesce(' Motivo: ' || v_reason, '')
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

-- ────────────────────────────────────────────────────────────────────────────
-- 3) SOLICITUD DE AGENTE — public.handle_agent_application_status_change
--    Solo se reemplaza la FUNCIÓN; el trigger que la cuelga de la tabla no se
--    toca (anclado por SIG3 de la suite 93).
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.handle_agent_application_status_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_admin_id uuid;
  v_reason text;
begin
  if not (old.status = 'pending' and new.status in ('approved', 'rejected')) then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001';
  end if;
  -- La exigencia sigue siendo NOT NULL, no «con contenido»: endurecerla aquí
  -- rompería a un llamador vivo y no es lo que #237 arregla. Por eso el blanco
  -- es alcanzable y lo ataja el guard de abajo.
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
    -- #237: normalizado para el mensaje; la auditoría de abajo conserva lo que
    -- el admin escribió, tal cual.
    v_reason := case when new.rejection_reason ~ '\S' then new.rejection_reason end;

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
        'Tu solicitud de agente fue rechazada.'
          || coalesce(' Motivo: ' || v_reason, ''),
        '/profile', 'agent_application', new.id,
        jsonb_build_object('application_type', new.application_type::text)
          || case when v_reason is not null
               then jsonb_build_object('rejection_reason', v_reason)
               else '{}'::jsonb
             end
      );
    end if;
  end if;
  return new;
end;
$function$;
