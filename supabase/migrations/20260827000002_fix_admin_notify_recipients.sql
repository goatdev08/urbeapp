-- Migración 20260827000002 — corrección de destinatarios y deep_link de los
-- 4 escritores admin_notify_* de 20260825000001 (tarea #223, derivada del
-- code review del PR #106 de #219; origen: subtarea 223.2). Aditiva pura:
-- create-or-replace de las 4 funciones -- notify_admin_ad_pending,
-- notify_admin_agency_pending, notify_admin_agent_application,
-- notify_admin_revision_pending. Ningún trigger, tabla ni índice creado o
-- modificado: los 4 `when` y las 6 definiciones de trigger de 20260825000001
-- siguen intactas (esta migración solo reemplaza el cuerpo de las 4
-- funciones a las que ya apuntan). Ningún contrato observable roto: firma y
-- `returns` de las 4 funciones son IDÉNTICOS a los vigentes (20260825000001)
-- -- son las mismas funciones de trigger que los builds instalados ya usan.
-- Rollback: supabase/migrations/rollbacks/20260827000002_fix_admin_notify_recipients.sql
--
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 GOTCHA #168 ("nunca del cuerpo viejo"): las definiciones VIGENTES antes
-- de esta migración (verificadas contra la DB local vía pg_get_functiondef)
-- son las 4 de 20260825000001 -- ver esa migración para el contrato base
-- completo (catálogo de eventos, índices de idempotencia, semántica
-- BLOQUEANTE sin bloque EXCEPTION). Los cuerpos copiados abajo son VERBATIM
-- esos, con SOLO los deltas listados a continuación.
--
-- ── QUÉ corrige cada delta ───────────────────────────────────────────────
--   (a) Fan-out sin admins borrados, en LAS 4 FUNCIONES: el `from
--     public.users u where u.role = 'admin'` no filtraba `deleted_at`, así
--     que un admin dado de baja seguía recibiendo los 4 avisos. Fix: añadir
--     `and u.deleted_at is null`. Motivo doble -- (1) semántico: un admin
--     borrado no debe seguir en la cola de trabajo; (2) de performance:
--     users_role_idx (20260604000002:34-35) es un índice PARCIAL `where
--     deleted_at is null` -- sin ese mismo predicado en el WHERE, la query no
--     lo puede usar y cae en seq scan sobre public.users, DENTRO de la
--     transacción bloqueante del evento (sección 7 del RED, DECISIÓN ABRAHAM
--     2026-08-25: sin bloque EXCEPTION, cualquier fallo del escritor aborta
--     el evento entero -- un seq scan lento no es un fallo, pero corre en el
--     camino caliente igual).
--   (b) deep_link vivo, SOLO en notify_admin_agency_pending y
--     notify_admin_agent_application: '/admin/requests' nunca existió como
--     ruta del cliente (mobile/app/admin/ solo tiene _layout.tsx, index.tsx,
--     ads/, agencies/, revisions/) -- Unmatched Route si alguien lo
--     navegara. Fix: '/admin' (destino INTERINO -- el índice admin es
--     justo la lista de inmobiliarias y el hub de las colas). #221 (M4
--     solicitudes) re-apuntará a '/admin/requests' cuando esa pantalla
--     exista; notify_admin_ad_pending ('/admin/ads') y
--     notify_admin_revision_pending ('/admin/revisions') YA apuntaban a
--     rutas reales -- no se tocan.
--
-- ── D-KEY/D-TYPE/D-LINK (catálogo v1, PRD §22.4 -- corregido) ───────────────
--   admin_ad_pending          → deep_link '/admin/ads'      · related_entity_type 'ad'
--   admin_revision_pending    → deep_link '/admin/revisions'· related_entity_type 'property_revision'
--   admin_agent_application   → deep_link '/admin'          · related_entity_type 'agent_application'
--   admin_agency_pending      → deep_link '/admin'          · related_entity_type 'agency'
--   🔴 CORREGIDO (#223.2): admin_agent_application y admin_agency_pending
--   llevaban '/admin/requests' en 20260825000001 -- esa ruta nunca existió.
--   Ver delta (b) arriba.
--   data lleva 'ad_title' (ads) / 'address' (revisiones) / 'application_type'
--   (solicitudes) / 'agency_name' (inmobiliarias) -- snake_case, sin colisionar
--   con title/body de la fila (que son del AVISO, no de la entidad). Sin
--   cambio respecto a 20260825000001.
--
-- Idempotente: create or replace function (mismas 4 funciones, mismas
-- firmas/`returns`/triggers ya instalados).
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1) notify_admin_ad_pending — verbatim 20260825000001 + delta (a).
-- ════════════════════════════════════════════════════════════════════════════

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
    and u.deleted_at is null
  on conflict (user_id, related_entity_id, type) where type = 'admin_ad_pending'
    do nothing;

  return new;
end;
$$;

comment on function public.notify_admin_ad_pending() is
  'AFTER INSERT/UPDATE en ads (#219.1, #219.6): avisa a los admin de '
  'plataforma VIVOS (deleted_at is null -- #223.2a) cuando un anuncio entra '
  'a pending_review por nacimiento (INSERT, camino real del wizard vía '
  'create_ad_campaign_atomic) o por draft->pending_review (UPDATE, camino '
  'Studio vía grant_ad_slot_atomic) -- ninguna otra transición dispara, '
  'incluida la democión de sistema active->pending_review de #192. El ON '
  'CONFLICT DO NOTHING sobre notifications_admin_ad_pending_anchor_idx '
  'protege el doble disparo. NO reemplaza ni toca '
  'public.handle_ad_status_change (20260816000006), que sigue siendo la '
  'única autoridad de la transición en sí.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2) notify_admin_agency_pending — verbatim 20260825000001 + deltas (a),(b).
-- ════════════════════════════════════════════════════════════════════════════

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

comment on function public.notify_admin_agency_pending() is
  'AFTER INSERT en agencies (#219.1): avisa a los admin de plataforma VIVOS '
  '(deleted_at is null -- #223.2a) cuando una inmobiliaria nace en '
  'pending_approval (WHEN clause -- un INSERT directo con status distinto, '
  'p.ej. active, NO dispara). deep_link ''/admin'' (#223.2b -- '
  '''/admin/requests'' no existe, Unmatched Route; destino interino hasta '
  'que #221 cree /admin/requests).';

-- ════════════════════════════════════════════════════════════════════════════
-- 3) notify_admin_agent_application — verbatim 20260825000001 + deltas (a),(b).
-- ════════════════════════════════════════════════════════════════════════════

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

comment on function public.notify_admin_agent_application() is
  'AFTER INSERT en agent_applications (#219.1): avisa a los admin de '
  'plataforma VIVOS (deleted_at is null -- #223.2a) cuando una solicitud '
  'nace en pending (WHEN clause -- un INSERT directo con status distinto, '
  'p.ej. approved, NO dispara). deep_link ''/admin'' (#223.2b -- '
  '''/admin/requests'' no existe, Unmatched Route; destino interino hasta '
  'que #221 cree /admin/requests).';

-- ════════════════════════════════════════════════════════════════════════════
-- 4) notify_admin_revision_pending — verbatim 20260825000001 + delta (a).
-- ════════════════════════════════════════════════════════════════════════════

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
  where u.role = 'admin'
    and u.deleted_at is null;

  return new;
end;
$$;

comment on function public.notify_admin_revision_pending() is
  'AFTER INSERT/UPDATE en property_revisions (#219.1): avisa a los admin de '
  'plataforma VIVOS (deleted_at is null -- #223.2a) cuando una revisión '
  'nace en pending (INSERT) o re-entra a pending desde needs_changes '
  '(UPDATE, el re-envío). Ambos caminos generan avisos NUEVOS cada vez -- '
  'NUNCA deduplicado (decisión fijada en el RED, '
  '71_notify_admin_events_test.sql sección 5): a diferencia de '
  'admin_ad_pending/admin_agency_pending/admin_agent_application, esta '
  'entidad SÍ puede re-disparar el mismo evento de negocio legítimamente '
  'varias veces en su vida.';
