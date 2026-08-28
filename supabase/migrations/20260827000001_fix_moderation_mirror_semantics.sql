-- Migración 20260827000001 — corrección de semántica de los espejos de
-- moderación (tarea #223, derivada del code review del PR #106 de #219;
-- origen: subtarea 223.1). Aditiva pura: create-or-replace de las 2
-- funciones de 20260826000001 que tenían el defecto -- moderate_property_
-- atomic y moderate_ad_atomic. handle_agency_status_change y handle_agent_
-- application_status_change NO se tocan (sin defecto reportado). Ninguna
-- tabla creada, ningún contrato observable roto: firma y `returns` de
-- ambas funciones son IDÉNTICOS a los vigentes (20260826000001) -- estas
-- son las mismas RPCs que los builds instalados ya llaman.
-- Rollback: supabase/migrations/rollbacks/20260827000001_fix_moderation_mirror_semantics.sql
--
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 GOTCHA #168 ("nunca del cuerpo viejo"): las definiciones VIGENTES antes
-- de esta migración (verificadas contra la DB local vía pg_get_functiondef)
-- son ambas de 20260826000001 -- ver esa migración para el contrato base
-- completo. Los cuerpos copiados abajo son VERBATIM esos, con SOLO los 3
-- deltas listados a continuación.
--
-- ── QUÉ corrige cada delta ───────────────────────────────────────────────
--   (a) moderate_property_atomic — deep_link del espejo: '/my-listings' →
--     '/profile/my-listings'. La ruta real del cliente es
--     mobile/app/(protected)/profile/my-listings.tsx (ProfileScreen.tsx:154
--     ya empuja ahí); '/my-listings' no existe → Unmatched Route en el
--     cliente. Aplica a las 3 ramas (approve/needs_changes/reject), CON y
--     SIN revisión activa.
--   (b) moderate_property_atomic — guard del retry-dedup en la rama SIN
--     revisión (p_revision_id null): `v_old_property_status IS DISTINCT
--     FROM p_new_property_status` da TRUE cuando p_new_property_status es
--     NULL ('active' IS DISTINCT FROM NULL = TRUE), así que una llamada sin
--     revisión y sin nuevo status espejeaba una "aprobación" pese a que
--     NADA transicionó. Fix: exigir `p_new_property_status is not null`
--     además de la comparación. El EF vigente siempre manda
--     new_property_status (sin caller vivo hoy para este hoyo), pero el
--     invariante -- sin new_property_status no hay transición que resolver
--     -- debe sostenerse igual.
--   (c) moderate_ad_atomic — 'ad_approved' SOLO cuando el estado ANTERIOR
--     era 'pending_review' (aprobación real). Antes, cualquier →active
--     (incluido un resume de paused→active, retomar un anuncio que un
--     admin había pausado) mandaba «Tu anuncio fue aprobado y ya está
--     activo» -- falso en un resume, el anuncio ya había sido aprobado
--     antes. Decisión de producto (Abraham, 2026-08-27): un resume NO es
--     una resolución y NO se espeja -- ni ad_approved ni ningún otro type
--     (mismo criterio que active↔suspended en agencias, 20260823000002). Un
--     tipo 'ad_resumed' dedicado queda como opción de fase 2, documentada
--     pero NO implementada aquí (nadie pidió avisar del resume; agregarlo
--     ahora sería alcance no pedido).
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1) moderate_property_atomic — verbatim 20260826000001 + deltas (a) y (b).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.moderate_property_atomic(p_admin_id uuid, p_property_id uuid, p_action_type text, p_old_values jsonb, p_new_values jsonb, p_reason text DEFAULT NULL::text, p_new_property_status text DEFAULT NULL::text, p_changed_fields jsonb DEFAULT NULL::jsonb, p_revision_id uuid DEFAULT NULL::uuid, p_revision_status text DEFAULT NULL::text, p_revision_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_rows int;
  -- #219.2: estado ANTERIOR (capturado ANTES de cualquier UPDATE propio) +
  -- cómputo del espejo de resolución.
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

  -- #219.2: snapshot del estado ANTERIOR, antes de tocar ninguna fila --
  -- ancla en memoria para el retry-dedup (un reintento exacto de la MISMA
  -- transición no debe generar un segundo espejo).
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

  -- ══════════════════════════════════════════════════════════════════════
  -- #219.2: espejo de resolución al usuario afectado. Solo los 3 tipos del
  -- catálogo (approve/needs_changes/reject) -- 'suspend' queda fuera a
  -- propósito (sección 3 del RED). El destinatario depende de si HUBO
  -- revisión activa (submitted_by) o fue publicación inicial (owner); el
  -- motivo viene de p_revision_reason con revisión, de p_reason sin ella.
  -- Solo se escribe si el estado REALMENTE transicionó (retry-dedup en
  -- memoria, sección 4 del RED) -- sin índice único, ver cabecera de
  -- 20260826000001.
  -- ══════════════════════════════════════════════════════════════════════
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
      -- #223.1(b): sin p_new_property_status no hubo transición de status
      -- que resolver -- sin este guard, 'activo' IS DISTINCT FROM NULL da
      -- TRUE y espejea una "aprobación" que nunca ocurrió (PROP41).
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
        -- #223.1(a): '/profile/my-listings' -- la ruta real del cliente
        -- (mobile/app/(protected)/profile/my-listings.tsx); '/my-listings'
        -- no existe (Unmatched Route).
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
$function$
;

comment on function public.moderate_property_atomic(uuid, uuid, text, jsonb, jsonb, text, text, jsonb, uuid, text, text) is
  'Aplica una decisión de moderación sobre una propiedad (snapshot de campos '
  'editados + status + resolución de revisión) en una sola transacción, '
  'registra admin_actions, y escribe un espejo en notifications al usuario '
  'afectado cuando la acción RESUELVE el catálogo property_revision_* '
  '(#219.2) -- submitted_by con revisión activa, owner_user_id sin ella, '
  'nunca el admin actor, nunca en un reintento exacto de la misma '
  'transición (sin revisión, exige new_property_status no nulo -- '
  '#223.1b), nunca en "suspend". deep_link ''/profile/my-listings'' '
  '(#223.1a -- ''/my-listings'' no existe, Unmatched Route). Sin bloque '
  'EXCEPTION: cualquier fallo, incluido el del espejo, revierte todo el '
  'evento.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2) moderate_ad_atomic — verbatim 20260826000001 + delta (c).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.moderate_ad_atomic(p_ad_id uuid, p_next_status text, p_rejection_reason text, p_admin_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_rows integer;
  -- #219.2: estado ANTERIOR + cómputo del espejo de resolución.
  v_old_status public.ad_status;
  v_mirror_type text;
  v_ad_title text;
  v_title text;
  v_body text;
begin
  -- Frontera de confianza: `ads.status` tiene 6 valores y solo tres son un
  -- resultado de moderación (210.1 suma 'paused' — retirar un anuncio
  -- activo). Sin este guard, un caller podría empujar 'expired' —una
  -- transición que el trigger sí acepta desde 'active'— saltándose la
  -- semántica de "moderar". Se valida ANTES de tocar la fila para que no
  -- queden efectos parciales.
  if p_next_status is null or p_next_status not in ('active', 'rejected', 'paused') then
    raise exception 'INVALID_NEXT_STATUS' using errcode = 'P0001';
  end if;

  -- Instala el admin para private.resolve_admin_actor(). `true` = is_local:
  -- vive solo dentro de esta transacción, así que no contamina la conexión
  -- del pool para la siguiente petición.
  perform set_config('urbea.admin_actor_id', p_admin_id::text, true);

  -- #219.2: snapshot del estado ANTERIOR antes del UPDATE -- ancla en
  -- memoria para el retry-dedup (sección 5.5 del RED).
  select status into v_old_status from public.ads where id = p_ad_id;

  update public.ads
     set status           = p_next_status::public.ad_status,
         rejection_reason = p_rejection_reason
   where id = p_ad_id;

  get diagnostics v_rows = row_count;

  -- ══════════════════════════════════════════════════════════════════════
  -- #219.2: espejo de resolución a los miembros ACTIVOS owner/admin de la
  -- agencia dueña del anuncio (consulta directa, patrón EXACTO de
  -- notify_ads_expiring_soon 20260822000001) -- nunca agent/viewer/
  -- suspended, nunca el admin actor. Solo si el ad existía (v_rows>0) y el
  -- status REALMENTE transicionó (retry-dedup en memoria).
  --
  -- #223.1(c): 'active' SOLO se espeja como ad_approved cuando el estado
  -- ANTERIOR era 'pending_review' (aprobación real). Cualquier otro
  -- →active (hoy en la práctica solo paused→active, un resume
  -- administrativo -- el guard de p_next_status arriba no admite otro
  -- origen intermedio) NO escribe NINGUNA notificación, ni ad_approved ni
  -- ningún otro type: un resume no es una resolución (mismo criterio que
  -- active↔suspended en agencias, 20260823000002). Fase 2 (no
  -- implementada, opción documentada): un tipo 'ad_resumed' dedicado si
  -- se decide avisar del resume más adelante.
  -- ══════════════════════════════════════════════════════════════════════
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
$function$
;

comment on function public.moderate_ad_atomic(uuid, text, text, uuid) is
  'Mueve un anuncio a active/rejected/paused (guard: solo esos 3 valores) y '
  'escribe un espejo en notifications a los miembros ACTIVOS owner/admin de '
  'la agencia dueña (#219.2) -- nunca agent/viewer/suspended, nunca el '
  'admin actor, nunca en un reintento exacto de la misma transición, nunca '
  'si el ad no existe. ''active'' SOLO se espeja como ad_approved cuando el '
  'estado anterior era ''pending_review'' -- un resume (p.ej. '
  'paused→active) NO se espeja, ningún type (#223.1c; ''ad_resumed'' '
  'dedicado queda como opción de fase 2, no implementada). Sin bloque '
  'EXCEPTION.';
