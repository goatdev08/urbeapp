-- Migración 20260905300001 — GREEN de #257 y #258 (derivadas del smoke #222,
-- pasos 10 y 11): los dos espejos de moderación que quedaban SIN motivo ni
-- solicitante llevan ahora esa información en `data`/`body`.
-- Aditiva pura: create-or-replace de las 2 funciones de trigger VIGENTES.
-- Ningún trigger, tabla, columna, índice ni grant se toca; la firma y el
-- `returns` de ambas son IDÉNTICOS (mismo contrato para los builds
-- instalados). Rollback: supabase/migrations/rollbacks/20260905300001_notificaciones_moderacion_con_motivo.sql
-- Tests (RED, test-author): supabase/tests/97_autosuspension_con_motivo_test.sql,
-- supabase/tests/98_solicitud_agente_con_solicitante_test.sql
--
-- 🔴 GOTCHA #168 ("nunca del cuerpo viejo"): los cuerpos de abajo son VERBATIM
-- las definiciones VIGENTES (verificadas contra la base local) — la de #257
-- viene de 20260828000002_property_reports_autosuspend.sql (no tuvo deltas
-- posteriores) y la de #258 de 20260902100004_admin_requests_deep_links.sql
-- (el último delta fue el deep_link '/admin' -> '/admin/requests') — con SOLO
-- el delta descrito abajo.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 1) #257 — public.notify_property_report_and_autosuspend
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ cambia: se agrega `data->>'rejection_reason'` a los DOS avisos que ya
-- disparaba la ronda de auto-suspensión (property_suspended_by_reports al
-- owner Y admin_report_autosuspend a los admins) — las etiquetas en ESPAÑOL de
-- los motivos agregados de la ventana de 24h, deduplicadas por el ENUM (nunca
-- por `reason_text`: el texto libre puede identificar al reportante,
-- [[privacidad-datos]]), en orden de 1a aparición cronológica, unidas con
-- ' · '. Catálogo verbatim de ReportPropertySheet.tsx:66-73. admin_report_new
-- (el aviso de 1o/2o reporte, ANTES de suspender) NO se toca — fuera del
-- alcance de #257.
--
-- "1a aparición" se ordena por `min(created_at)` de cada motivo dentro de la
-- ventana (el criterio real: cada reporte HTTP es su propia transacción, así
-- que created_at ya distingue el orden). El fixture de test fija created_at
-- EXPLÍCITOS y distintos por reporte (mismo patrón que WINOLD/WINSPREAD de
-- 74_property_reports_autosuspend_test.sql) para que ese orden cronológico no
-- dependa de que dos INSERTs corran en transacciones separadas. Como
-- desempate determinista para un empate exacto de created_at (dos motivos con
-- el MISMO instante, caso de borde que no cambia el resultado observable en
-- ningún fixture real), se usa el orden natural del enum
-- (`property_report_reason`, declarado not_exist_fraud..other) — sin
-- significado de negocio, solo para que el resultado sea reproducible.
-- 🔴 NO usar `ctid` para esto: cambia con cualquier UPDATE de la fila (esta
-- misma tabla no tiene UPDATEs sobre property_reports, pero no es un
-- invariante en el que apoyarse) y no es una técnica correcta de desempate.
--
-- Compat §0.5: `data->>'reason' = 'multiple_reports'` (columna vieja) se
-- conserva byte por byte; el early-return `status = 'suspended'` (guard
-- AJENO a este delta) tampoco se toca.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 2) #258 — public.notify_admin_agent_application
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ cambia: el `body` deja de exponer el enum crudo en inglés entre
-- comillas y en su lugar dice, en español, quién solicitó qué — el nombre
-- PÚBLICO del solicitante (public.agent_public_profiles.full_name, NUNCA su
-- email) + la etiqueta del tipo (independent -> "independiente", under_agency
-- -> "bajo inmobiliaria"). `data` conserva `application_type` (ya existía) y
-- suma `rejection_reason = new.reason` (el motivo que el solicitante escribió
-- al pedir volverse agente independiente, Camino B §4.2 — nullable, la clave
-- viaja igual con valor null cuando no hay motivo; NotificationCard.tsx ya
-- pinta esta clave como bloque "Motivo", #240). El ON CONFLICT DO NOTHING
-- (índice notifications_admin_agent_application_anchor_idx) y el fan-out a
-- admins vivos (role='admin' and deleted_at is null) NO se tocan.
--
-- Fallback de nombre: si agent_public_profiles no tiene fila para
-- new.user_id o el nombre está vacío, "Un solicitante" (nunca el email, nunca
-- NULL en el body).
--
-- Idempotente: create or replace function (mismas 2 funciones, mismas
-- firmas/`returns`/triggers ya instalados).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.notify_property_report_and_autosuspend()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status  public.property_status;
  v_address text;
  v_owner   uuid;
  v_count   int;
  v_reason_label text;
begin
  -- 1) Bloquea la fila de la propiedad (carrera entre reportes concurrentes)
  -- y lee el estado necesario para el resto de la función.
  select status, address, owner_user_id
    into v_status, v_address, v_owner
    from public.properties
   where id = new.property_id
     for update;

  -- 2) Ya suspendida: no-op total. El reporte ya se persistió (este trigger
  -- corre AFTER INSERT), no hace falta tocar nada más.
  if v_status = 'suspended' then
    return new;
  end if;

  -- 3) Ventana deslizante REAL de 24h por created_at, contando
  -- reported_by_user_id DISTINTOS (incluye la fila recién insertada).
  select count(distinct reported_by_user_id)
    into v_count
    from public.property_reports
   where property_id = new.property_id
     and created_at >= now() - interval '24 hours';

  if v_count >= 3 then
    -- #257: etiquetas en español de los motivos agregados de la ventana,
    -- deduplicadas por el ENUM (nunca por reason_text -- privacidad), en
    -- orden de 1a aparición (min(created_at); t.reason -- orden natural del
    -- enum -- como desempate determinista de un empate exacto, ver nota de
    -- cabecera).
    select string_agg(t.label, ' · ' order by t.first_seen, t.reason)
      into v_reason_label
      from (
        select
          reason,
          case reason
            when 'not_exist_fraud' then 'No existe / es un fraude'
            when 'misleading'      then 'Información engañosa'
            when 'false_price'     then 'Precio falso'
            when 'wrong_address'   then 'Dirección incorrecta'
            when 'inappropriate'   then 'Contenido inapropiado'
            when 'duplicate'       then 'Publicación duplicada'
            when 'other'           then 'Otro'
          end as label,
          min(created_at) as first_seen
        from public.property_reports
        where property_id = new.property_id
          and created_at >= now() - interval '24 hours'
        group by reason
      ) t;

    update public.properties
       set status = 'suspended',
           updated_at = now()
     where id = new.property_id;

    insert into public.notifications (
      user_id, type, title, body, deep_link,
      related_entity_type, related_entity_id, data
    )
    select
      u.id,
      'admin_report_autosuspend',
      'Propiedad auto-suspendida por reportes',
      'La propiedad en "' || v_address || '" fue suspendida automáticamente tras acumular reportes.',
      '/admin/reports',
      'property',
      new.property_id,
      jsonb_build_object('address', v_address, 'rejection_reason', v_reason_label)
    from public.users u
    where u.role = 'admin'
      and u.deleted_at is null
      and u.id is distinct from new.reported_by_user_id;

    if v_owner is not null then
      insert into public.notifications (
        user_id, type, title, body, deep_link,
        related_entity_type, related_entity_id, data
      )
      values (
        v_owner,
        'property_suspended_by_reports',
        'Tu propiedad fue suspendida',
        'Tu propiedad en "' || v_address || '" fue suspendida automáticamente por reportes múltiples.',
        '/profile/my-listings',
        'property',
        new.property_id,
        jsonb_build_object(
          'address', v_address,
          'reason', 'multiple_reports',
          'rejection_reason', v_reason_label
        )
      );
    end if;
  elsif v_count > 0 then
    -- v_count puede ser 0 si la fila recién insertada queda FUERA de la
    -- ventana de 24h (created_at backdateado más allá de la ventana, caso
    -- WINOLD del RED) -- en ese caso ningún aviso corresponde, ni siquiera
    -- admin_report_new.
    insert into public.notifications (
      user_id, type, title, body, deep_link,
      related_entity_type, related_entity_id, data
    )
    select
      u.id,
      'admin_report_new',
      'Nuevo reporte de propiedad',
      'La propiedad en "' || v_address || '" recibió un nuevo reporte.',
      '/admin/reports',
      'property',
      new.property_id,
      jsonb_build_object('address', v_address)
    from public.users u
    where u.role = 'admin'
      and u.deleted_at is null
      and u.id is distinct from new.reported_by_user_id;
  end if;

  return new;
end;
$$;

comment on function public.notify_property_report_and_autosuspend() is
  'AFTER INSERT en property_reports (#220.2): ventana deslizante REAL de 24h '
  'por created_at, contando reported_by_user_id DISTINTOS -- 1o/2o reporte '
  'de la ventana avisa admin_report_new a los admins vivos (role=admin, '
  'deleted_at is null); si la fila recién insertada queda FUERA de la '
  'ventana (backdateada, WINOLD del RED) el conteo puede ser 0 y entonces '
  'NO se notifica nada. Al llegar a 3 distintos suspende la propiedad '
  '(guard status<>suspended + for update, SIN índice único -- permite '
  're-suspensión tras restaurar) y avisa admin_report_autosuspend a los '
  'admins + property_suspended_by_reports al owner, ambos con '
  '`rejection_reason` (#257): etiquetas en español de los motivos agregados '
  'de la ventana, deduplicadas por el ENUM (nunca por reason_text -- '
  'privacidad), en orden de 1a aparición. Guard "nunca el actor": excluye '
  'solo al admin cuyo id sea el reported_by_user_id de ESTE evento. '
  'Propiedad ya suspended = no-op total (ni suspende de nuevo ni notifica), '
  'el reporte igual se persiste como auditoría. NO escribe en admin_actions '
  '(decisión Abraham 2026-08-28: sin actor humano, admin_id es NOT NULL FK '
  'restrict). Sin bloque EXCEPTION: cualquier fallo, incluido el del '
  'escritor de notifications, revierte todo el evento (fault-injection '
  'FAULTA/FAULTB del RED).';

create or replace function public.notify_admin_agent_application()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type_label text;
  v_applicant_name text;
begin
  v_type_label := case new.application_type
    when 'independent'  then 'independiente'
    when 'under_agency'  then 'bajo inmobiliaria'
  end;

  -- #258: nombre PÚBLICO del solicitante (agent_public_profiles.full_name,
  -- NUNCA su email). Fallback si no hay fila o el nombre está vacío/blanco.
  v_applicant_name := coalesce(
    (select nullif(btrim(app.full_name), '')
       from public.agent_public_profiles app
      where app.user_id = new.user_id),
    'Un solicitante'
  );

  insert into public.notifications (
    user_id, type, title, body, deep_link,
    related_entity_type, related_entity_id, data
  )
  select
    u.id,
    'admin_agent_application',
    'Nueva solicitud de agente',
    v_applicant_name || ' solicitó volverse agente ' || v_type_label || '.',
    '/admin/requests',
    'agent_application',
    new.id,
    jsonb_build_object(
      'application_type', new.application_type::text,
      'rejection_reason', new.reason
    )
  from public.users u
  where u.role = 'admin'
    and u.deleted_at is null
  on conflict (user_id, related_entity_id, type) where type = 'admin_agent_application'
    do nothing;

  return new;
end;
$$;

comment on function public.notify_admin_agent_application() is
  'AFTER INSERT en agent_applications (#219.1, destinatarios corregidos en '
  '#223.2, deep_link a la cola unificada en #221): avisa a los admin de '
  'plataforma VIVOS cuando nace una solicitud en pending. body en español '
  'con el nombre público del solicitante (agent_public_profiles.full_name, '
  'NUNCA su email -- fallback "Un solicitante") y la etiqueta del tipo '
  '(independent -> "independiente", under_agency -> "bajo inmobiliaria") '
  '(#258). data conserva application_type y suma rejection_reason = '
  'new.reason (el motivo que el solicitante escribió, nullable).';
