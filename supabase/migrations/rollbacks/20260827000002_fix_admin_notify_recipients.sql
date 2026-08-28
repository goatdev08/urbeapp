-- Rollback: 20260827000002_fix_admin_notify_recipients.sql (subtarea #223.2).
-- Restaura VERBATIM las 4 definiciones de 20260825000001 -- notify_admin_
-- ad_pending, notify_admin_agency_pending, notify_admin_agent_application,
-- notify_admin_revision_pending -- previas a los deltas de #223.2 (filtro
-- deleted_at is null en las 4, deep_link '/admin/requests' en 2). Incluye el
-- `comment on function` original de cada una (mismo criterio que el
-- rollback de 223.1: no repetir el hueco de 20260825000001, que dejaba los
-- comments sin restaurar). Ningún trigger, tabla ni índice se toca -- solo
-- los cuerpos de las 4 funciones a las que ya apuntan.

create or replace function public.notify_admin_ad_pending()
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
    'admin_ad_pending',
    'Anuncio pendiente de revisión',
    'El anuncio "' || new.title || '" está pendiente de revisión.',
    '/admin/ads',
    'ad',
    new.id,
    jsonb_build_object('ad_title', new.title)
  from public.users u
  where u.role = 'admin'
  on conflict (user_id, related_entity_id, type) where type = 'admin_ad_pending'
    do nothing;

  return new;
end;
$$;

comment on function public.notify_admin_ad_pending() is
  'AFTER INSERT/UPDATE en ads (#219.1, #219.6): avisa a TODOS los admin de '
  'plataforma cuando un anuncio entra a pending_review por nacimiento '
  '(INSERT, camino real del wizard vía create_ad_campaign_atomic) o por '
  'draft->pending_review (UPDATE, camino Studio vía grant_ad_slot_atomic) '
  '-- ninguna otra transición dispara, incluida la democión de sistema '
  'active->pending_review de #192. El ON CONFLICT DO NOTHING sobre '
  'notifications_admin_ad_pending_anchor_idx protege el doble disparo. NO '
  'reemplaza ni toca public.handle_ad_status_change (20260816000006), que '
  'sigue siendo la única autoridad de la transición en sí.';

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
    '/admin/requests',
    'agency',
    new.id,
    jsonb_build_object('agency_name', new.name::text)
  from public.users u
  where u.role = 'admin'
  on conflict (user_id, related_entity_id, type) where type = 'admin_agency_pending'
    do nothing;

  return new;
end;
$$;

comment on function public.notify_admin_agency_pending() is
  'AFTER INSERT en agencies (#219.1): avisa a TODOS los admin de plataforma '
  'cuando una inmobiliaria nace en pending_approval (WHEN clause -- un '
  'INSERT directo con status distinto, p.ej. active, NO dispara).';

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
  on conflict (user_id, related_entity_id, type) where type = 'admin_agent_application'
    do nothing;

  return new;
end;
$$;

comment on function public.notify_admin_agent_application() is
  'AFTER INSERT en agent_applications (#219.1): avisa a TODOS los admin de '
  'plataforma cuando una solicitud nace en pending (WHEN clause -- un '
  'INSERT directo con status distinto, p.ej. approved, NO dispara).';

create or replace function public.notify_admin_revision_pending()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_address text;
begin
  select p.address into v_address
  from public.properties p
  where p.id = new.property_id;

  insert into public.notifications (
    user_id, type, title, body, deep_link,
    related_entity_type, related_entity_id, data
  )
  select
    u.id,
    'admin_revision_pending',
    'Revisión de propiedad pendiente',
    'La propiedad en "' || v_address || '" tiene una revisión pendiente de aprobación.',
    '/admin/revisions',
    'property_revision',
    new.id,
    jsonb_build_object('address', v_address)
  from public.users u
  where u.role = 'admin';

  return new;
end;
$$;

comment on function public.notify_admin_revision_pending() is
  'AFTER INSERT/UPDATE en property_revisions (#219.1): avisa a TODOS los '
  'admin de plataforma cuando una revisión nace en pending (INSERT) o '
  're-entra a pending desde needs_changes (UPDATE, el re-envío). Ambos '
  'caminos generan avisos NUEVOS cada vez -- NUNCA deduplicado (decisión '
  'fijada en el RED, 71_notify_admin_events_test.sql sección 5): a '
  'diferencia de admin_ad_pending/admin_agency_pending/'
  'admin_agent_application, esta entidad SÍ puede re-disparar el mismo '
  'evento de negocio legítimamente varias veces en su vida.';
