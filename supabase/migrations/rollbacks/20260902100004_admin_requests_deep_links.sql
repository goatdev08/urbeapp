-- Rollback de 20260902100004_admin_requests_deep_links.sql (tarea #221).
--
-- Devuelve los 2 writers al destino INTERINO '/admin' de #223.2 (cuerpos
-- VERBATIM de 20260827000002_fix_admin_notify_recipients, incluido el filtro
-- u.deleted_at is null) y revierte el backfill con el WHERE simétrico (mismos
-- 2 tipos, solo filas no leídas y no borradas que hoy digan '/admin/requests').
--
-- ⚠️ El WHERE del revert también alcanza avisos que hubieran NACIDO con
-- '/admin/requests' después de la migración: no hay forma de distinguirlos (la
-- fila no guarda su origen) y dejarlos apuntando a una pantalla que este
-- rollback declara inexistente sería peor (deep link muerto, justo lo que
-- #223 arregló). Es el comportamiento deseado.

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
    '/admin',
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

create or replace function public.notify_admin_agency_pending()
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
    'admin_agency_pending',
    'Inmobiliaria pendiente de aprobación',
    'La inmobiliaria "' || new.name::text || '" está pendiente de aprobación.',
    '/admin',
    'agency',
    new.id,
    jsonb_build_object('agency_name', new.name::text)
  from public.users u
  where u.role = 'admin'
    and u.deleted_at is null
  on conflict (user_id, related_entity_id, type) where type = 'admin_agency_pending'
    do nothing;

  return new;
end;
$$;

update public.notifications
   set deep_link = '/admin'
 where type in ('admin_agent_application', 'admin_agency_pending')
   and deep_link = '/admin/requests'
   and read_at is null
   and deleted_at is null;
