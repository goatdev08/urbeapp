-- ROLLBACK de 20260905300001_notificaciones_moderacion_con_motivo (#257/#258).
-- Restaura las 2 funciones de trigger a sus definiciones VIGENTES ANTERIORES,
-- VERBATIM:
--   public.notify_property_report_and_autosuspend ->
--     20260828000002_property_reports_autosuspend.sql (sin rejection_reason).
--   public.notify_admin_agent_application ->
--     20260902100004_admin_requests_deep_links.sql (body en inglés entre
--     comillas, sin nombre del solicitante, data sin rejection_reason).
-- No borra datos: las notificaciones ya escritas con `rejection_reason` se
-- conservan (son historia real). Solo revierte el comportamiento futuro.
-- Idempotente (create or replace). Ningún otro objeto se toca.

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
begin
  select status, address, owner_user_id
    into v_status, v_address, v_owner
    from public.properties
   where id = new.property_id
     for update;

  if v_status = 'suspended' then
    return new;
  end if;

  select count(distinct reported_by_user_id)
    into v_count
    from public.property_reports
   where property_id = new.property_id
     and created_at >= now() - interval '24 hours';

  if v_count >= 3 then
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
      jsonb_build_object('address', v_address)
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
        jsonb_build_object('address', v_address, 'reason', 'multiple_reports')
      );
    end if;
  elsif v_count > 0 then
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
  'admins + property_suspended_by_reports al owner. Guard "nunca el actor": '
  'excluye solo al admin cuyo id sea el reported_by_user_id de ESTE evento. '
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
begin
  insert into public.notifications (
    user_id, type, title, body, deep_link,
    related_entity_type, related_entity_id, data
  )
  select
    u.id,
    'admin_agent_application',
    'Nueva solicitud de agente',
    'Nueva solicitud de agente de tipo "' || new.application_type::text || '".',
    '/admin/requests',
    'agent_application',
    new.id,
    jsonb_build_object('application_type', new.application_type::text)
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
  '#223.2): avisa a los admin de plataforma VIVOS cuando nace una solicitud en '
  'pending. deep_link ''/admin/requests'' (#221: fin del interino ''/admin'' de '
  '#223.2 — la cola unificada de M4 ya existe).';
