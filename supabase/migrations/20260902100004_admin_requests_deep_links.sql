-- Migración 20260902100004 — los avisos de la cola admin apuntan a
-- /admin/requests (tarea #221, exploración 041-M4). ADITIVA: create-or-replace
-- de 2 funciones trigger VIGENTES + 1 UPDATE de datos acotado. Ninguna tabla,
-- columna, policy, grant, índice ni trigger se toca; la firma y el `returns` de
-- ambas funciones son IDÉNTICOS (el único cambio observable es el literal del
-- deep_link).
-- Rollback: supabase/migrations/rollbacks/20260902100004_admin_requests_deep_links.sql
-- Tests: supabase/tests/71_notify_admin_events_test.sql (AGY4/APP4)
--
-- ── HISTORIA (por qué esto es un cierre y no un cambio de opinión) ───────────
-- (1) #219.1 (2026-08-25) fijó '/admin/requests' para admin_agent_application y
--     admin_agency_pending, pero esa pantalla NO existía — mobile/app/admin/
--     solo tenía index/ads/agencies/revisions.
-- (2) #223.2 (review del PR #106) los bajó a '/admin' como destino INTERINO
--     para que el aviso no llevara a una ruta muerta, dejando escrito que #221
--     los re-apuntaría "cuando esa pantalla exista".
-- (3) Hoy la cola unificada /admin/requests existe (M4): se cumple ese pacto.
--
-- 🔴 GOTCHA #168 ("nunca del cuerpo viejo"): los cuerpos de abajo son VERBATIM
-- las definiciones VIGENTES verificadas con pg_get_functiondef contra la base
-- (20260827000002_fix_admin_notify_recipients, que agregó el filtro
-- `u.deleted_at is null` — NO las de 20260825000001, que no lo tienen). Lo
-- ÚNICO que cambia en cada una es el literal '/admin' -> '/admin/requests'.
-- Se conserva `set search_path to ''` y por eso todo va calificado.
--
-- 📋 BACKFILL — aditivo y acotado, no una migración de datos masiva:
--   - Solo los 2 tipos afectados, solo filas con deep_link EXACTAMENTE '/admin'
--     (si alguien ya la corrigió a mano, no se pisa).
--   - Solo avisos NO LEÍDOS y no borrados: son los únicos sobre los que el
--     admin todavía va a hacer tap. Un aviso ya leído es historia — reescribirle
--     el destino no le sirve a nadie y toca filas de más en producción viva.
--   - Idempotente por construcción (a la segunda pasada el WHERE no matchea).

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
    and u.deleted_at is null
  on conflict (user_id, related_entity_id, type) where type = 'admin_agency_pending'
    do nothing;

  return new;
end;
$$;

comment on function public.notify_admin_agency_pending() is
  'AFTER INSERT en agencies (#219.1, destinatarios corregidos en #223.2): '
  'avisa a los admin de plataforma VIVOS cuando nace una inmobiliaria en '
  'pending_approval. deep_link ''/admin/requests'' (#221: fin del interino '
  '''/admin'' de #223.2 — la cola unificada de M4 ya existe).';

update public.notifications
   set deep_link = '/admin/requests'
 where type in ('admin_agent_application', 'admin_agency_pending')
   and deep_link = '/admin'
   and read_at is null
   and deleted_at is null;
