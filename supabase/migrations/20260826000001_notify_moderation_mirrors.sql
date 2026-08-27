-- Migración 20260826000001 — espejos de RESOLUCIÓN al usuario afectado
-- (subtarea #219.2, tarea 219 "panel admin centro operativo", exploración
-- 041). Aditiva pura: create-or-replace de 4 funciones/triggers VIGENTES,
-- cada una gana un INSERT hacia public.notifications cuando la moderación
-- RESUELVE un evento. Ninguna tabla creada (public.notifications YA existe,
-- 20260604000007). Ningún contrato observable tocado: firma y `returns` de
-- las 4 funciones son IDÉNTICOS a los vigentes (efecto nuevo = INSERT
-- interno adicional, sin try/catch, misma transacción -- DECISIÓN ABRAHAM
-- igual que #219.1: fallo del espejo = BLOQUEANTE, revierte TODO el evento).
-- Contrato completo (edge cases, D-KEY/D-TYPE/D-LINK, convención DELTA vs
-- INVARIANTE): ver cabecera de
-- supabase/tests/72_notify_moderation_mirrors_test.sql (RED, 2026-08-25).
-- Rollback: supabase/migrations/rollbacks/20260826000001_notify_moderation_mirrors.sql
--
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 GOTCHA #168 ("nunca del cuerpo viejo"): las definiciones VIGENTES,
-- verificadas contra la DB local vía pg_get_functiondef (NO contra el
-- nombre de archivo de la migración que las creó por última vez), son:
--   - public.moderate_property_atomic          → 20260815000005 (sin cambios
--     posteriores; el plan original SÍ apuntaba bien aquí).
--   - public.moderate_ad_atomic                → 20260823000002 (#210.1
--     "ad_takedown", NO 20260822000002 como asumía el plan original -- ese
--     create-or-replace AMPLIÓ el guard de p_next_status para admitir
--     también 'paused', además de active/rejected).
--   - public.handle_agency_status_change       → 20260823000002 (#210.1,
--     NO 20260805000007 -- agregó las transiciones active↔suspended,
--     cascada de suspensión de organización #169.2).
--   - public.handle_agent_application_status_change → 20260805000010 (FIX 2
--     de admin_approval_fixes; NO 20260805000007 — gotcha #168).
-- Los cuerpos copiados abajo son VERBATIM esas definiciones vigentes, solo
-- con el bloque del espejo AÑADIDO -- ninguna línea preexistente se quitó
-- ni se reordenó de forma observable.
--
-- ── QUÉ escribe cada función (destinatario / tipo / deep_link) ──────────────
--   moderate_property_atomic (approve/needs_changes/reject, NUNCA suspend):
--     CON revisión activa (p_revision_id no nulo) → submitted_by de la
--     revisión, motivo = p_revision_reason. SIN revisión (publicación
--     inicial) → owner_user_id de la propiedad, motivo = p_reason. MISMO
--     trío de tipos (property_revision_approved/needs_changes/rejected) en
--     ambas ramas -- el destinatario cambia, el tipo no. deep_link
--     '/my-listings', related_entity_type 'property',
--     related_entity_id = property_id, data->>'address' siempre.
--   moderate_ad_atomic (active/rejected/paused → ad_approved/ad_rejected/
--     ad_paused): miembros ACTIVOS owner/admin de agency_members de la
--     agencia dueña del anuncio (consulta directa, patrón EXACTO de
--     notify_ads_expiring_soon 20260822000001), NUNCA agent/viewer/
--     suspended. deep_link '/ads' (mismo que notify_ads_expiring_soon),
--     related_entity_type 'ad', data->>'ad_title'.
--   handle_agency_status_change (SOLO pending_approval→active/rejected;
--     active↔suspended de #210.1 NO resuelve este catálogo): solicitante
--     (old.created_by_user_id). deep_link '/profile', related_entity_type
--     'agency', data->>'agency_name'. agencies NO tiene columna de motivo
--     de rechazo -- data NUNCA lleva 'rejection_reason' aquí.
--   handle_agent_application_status_change (pending→approved/rejected):
--     solicitante (user_id). deep_link '/profile', related_entity_type
--     'agent_application', data->>'application_type'; 'rejection_reason' en
--     la rama rejected (columna NOT NULL al rechazar, D7 71.5). Se genera
--     IGUAL para application_type='under_agency' pese a que D8 (71.5) no
--     promueve su role en esa rama.
--   Nunca el admin actor, en ninguno de los 4 -- guard explícito
--   `<> p_admin_id` / `<> v_admin_id` en cada INSERT.
--
-- ── Idempotencia: SIN índice único, comparación en memoria ──────────────────
-- A diferencia de #219.1 (job batch, índice de idempotencia necesario), aquí
-- cada llamada es una decisión administrativa explícita, sin cron que la
-- reinvoque sola. moderate_property_atomic y moderate_ad_atomic capturan el
-- estado ANTERIOR de la entidad ANTES de cualquier UPDATE propio y solo
-- escriben el espejo si el estado solicitado es REALMENTE distinto del
-- anterior (un reintento exacto de la MISMA transición no duplica). Los 2
-- triggers (agencies/agent_applications) ya tienen esa garantía gratis vía
-- su `WHEN (old.status IS DISTINCT FROM new.status)` -- un UPDATE que
-- reescribe el mismo status ni siquiera dispara la función.
--
-- ── 🔒 Semántica BLOQUEANTE (DECISIÓN ABRAHAM, igual que #219.1) ────────────
-- El INSERT hacia notifications vive en la MISMA transacción/statement del
-- evento, SIN bloque EXCEPTION: si el escritor truena, TODO el evento se
-- aborta (propiedad/anuncio/agencia/solicitud NO transiciona, admin_actions
-- NO queda huérfano). Verificado por fault-injection en el RED sección 8.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1) moderate_property_atomic — verbatim 20260815000005 + espejo.
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
  -- memoria, sección 4 del RED) -- sin índice único, ver cabecera del
  -- archivo de migración.
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
      if v_old_property_status is distinct from p_new_property_status::property_status then
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
        v_recipient, v_mirror_type, v_title, v_body, '/my-listings',
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
  'transición, nunca en "suspend". Sin bloque EXCEPTION: cualquier fallo, '
  'incluido el del espejo, revierte todo el evento.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2) moderate_ad_atomic — verbatim 20260823000002 + espejo.
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
  -- ══════════════════════════════════════════════════════════════════════
  if v_rows > 0 and v_old_status is distinct from p_next_status::public.ad_status then
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
  'si el ad no existe. Sin bloque EXCEPTION.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3) handle_agency_status_change — verbatim 20260823000002 + espejo (SOLO
--    en las 2 ramas pending_approval→active/rejected -- active↔suspended de
--    #210.1 NO resuelve el catálogo agency_approved/agency_rejected).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.handle_agency_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

comment on function public.handle_agency_status_change() is
  'BEFORE UPDATE en agencies: aplica la cascada de aprobación/rechazo/'
  'suspensión/reactivación (#210.1/#169.2) y escribe un espejo en '
  'notifications al solicitante (created_by_user_id) SOLO cuando la '
  'transición resuelve pending_approval→active/rejected (#219.2) -- '
  'active↔suspended NO escribe espejo (no es una resolución de solicitud). '
  'Nunca el admin actor. agencies no tiene columna de motivo de rechazo, '
  'así que el espejo de agency_rejected nunca lleva rejection_reason.';

-- ════════════════════════════════════════════════════════════════════════════
-- 4) handle_agent_application_status_change — verbatim 20260805000010 +
--    espejo.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.handle_agent_application_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

    -- #219.2: espejo de resolución al solicitante. Se genera IGUAL para
    -- application_type='under_agency' pese a que arriba NO se le promueve
    -- el role (D8, 71.5) -- desde su perspectiva, su solicitud igual fue
    -- resuelta. Nunca el admin actor.
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

    -- #219.2: espejo de resolución al solicitante, con motivo (columna
    -- NOT NULL en esta rama, ver guard arriba). Nunca el admin actor.
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
$function$
;

comment on function public.handle_agent_application_status_change() is
  'BEFORE UPDATE en agent_applications: resuelve pending→approved/rejected '
  '(promueve role solo si independent, D7/D8 de #71.5) y escribe un espejo '
  'en notifications al solicitante (user_id) en ambas ramas (#219.2), '
  'incluido under_agency pese a no promover su role -- con rejection_reason '
  'en la rama rejected. Nunca el admin actor.';
