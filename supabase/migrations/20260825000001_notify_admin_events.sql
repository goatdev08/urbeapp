-- Migración 20260825000001 — public.notifications: 4 escritores admin (subtarea
-- #219.1, tarea 219 "panel admin centro operativo", exploración 041). Aditiva
-- pura: 4 funciones trigger nuevas + 4 triggers nuevos + 3 índices únicos
-- parciales nuevos + public.purge_notifications() + job de pg_cron nuevo.
-- Ninguna tabla creada (public.notifications YA existe, 20260604000007);
-- ningún contrato publicado tocado (§0.5 producción viva). NO se toca
-- public.handle_ad_status_change() (20260816000006) — el nuevo trigger de ads
-- es un AFTER UPDATE independiente, la máquina de estados sigue siendo la
-- ÚNICA autoridad de la transición en sí.
-- Contrato completo (edge cases, invariantes 🔒, decisiones D-KEY/D-ANCLA, la
-- semántica BLOQUEANTE de Abraham 2026-08-25): ver cabecera de
-- supabase/tests/71_notify_admin_events_test.sql (RED, 2026-08-25).
-- Rollback: supabase/migrations/rollbacks/20260825000001_notify_admin_events.sql
--
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ: 4 eventos con fuente viva avisan a TODOS los public.users.role='admin'
-- (admin de PLATAFORMA, sin relación con agency_members — distinto del owner/
-- admin de organización de notify_ads_expiring_soon, 20260822000001):
--   (a) ads: entra a pending_review por NACIMIENTO (AFTER INSERT, WHEN
--       new.status='pending_review' -- camino REAL del wizard de anuncios
--       vía create_ad_campaign_atomic, 20260820000005, que inserta el ad YA
--       en pending_review, #219.6) o por draft→pending_review (AFTER
--       UPDATE, WHEN old.status='draft' and new.status='pending_review' --
--       camino de Studio vía grant_ad_slot_atomic). La democión de SISTEMA
--       active→pending_review (#192, 20260818000001) sigue SIN disparar —
--       contrato explícito, ninguna WHEN clause matchea esa transición.
--   (b) agencies: SOLO nacer en pending_approval (AFTER INSERT, WHEN
--       new.status='pending_approval'). Un INSERT directo con status='active'
--       (bypaseando la cola) NO dispara.
--   (c) agent_applications: SOLO nacer en pending (AFTER INSERT, WHEN
--       new.status='pending'). Un INSERT directo con status='approved' NO
--       dispara.
--   (d) property_revisions: nace pending por INSERT (AFTER INSERT, WHEN
--       new.status='pending') Y re-entra por UPDATE needs_changes→pending
--       (AFTER UPDATE, WHEN old.status='needs_changes' and
--       new.status='pending') — AMBOS disparan, cada re-envío genera avisos
--       NUEVOS (nunca deduplicado, decisión fijada en el RED sección 5: el
--       conteo crece 2→4→6 en 2 re-envíos sucesivos). Los dos triggers
--       comparten la MISMA función — related_entity_id es siempre new.id (la
--       revisión), así que no hace falta distinguir el camino dentro del
--       cuerpo.
--
-- ── Por qué (a)-(c) SÍ llevan índice único parcial + ON CONFLICT DO NOTHING y
--    (d) NO ────────────────────────────────────────────────────────────────
-- Cada una de las 3 entidades de (a)-(c) solo puede nacer/transicionar UNA vez
-- en la vida hacia el estado que dispara el aviso (la matriz de ads no permite
-- volver a draft; agencies/agent_applications solo nacen una vez) — un índice
-- único parcial sobre (user_id, related_entity_id, type) es el invariante de
-- ESQUEMA correcto: incluso si algo disparara el trigger dos veces para la
-- misma entidad, el segundo INSERT es un no-op silencioso (ON CONFLICT DO
-- NOTHING), NUNCA un error — mismo patrón que
-- notifications_ad_expiring_soon_anchor_idx (20260822000001). 3 índices
-- separados (uno por type), no uno combinado con `type in (...)`: el ON
-- CONFLICT ... WHERE debe machear EXACTAMENTE el predicado del índice arbiter
-- (mismo criterio literal que 20260822000001), y un índice por type es más
-- simple de razonar que una lista IN compartida.
-- (d) property_revisions es DISTINTO a propósito: el re-envío needs_changes→
-- pending es un contrato explícito de "SÍ debe avisar de nuevo" (RED sección
-- 5) — la misma revisión (new.id fijo) debe poder generar N avisos por N
-- re-envíos. Un índice sobre (user_id, related_entity_id, type) la
-- bloquearía en el primer re-envío. No se añade un diferenciador (p.ej.
-- reviewed_at) porque el detalle de implementación no está pedido por el RED
-- (solo el comportamiento observable: nunca se deduplica) — un índice
-- parcial+on conflict sin diferenciador sería CONTRARIO al contrato, así que
-- sencillamente no se pone protección de idempotencia para este evento
-- (YAGNI: no hay ninguna forma real de que este trigger se dispare dos veces
-- para el MISMO evento — a diferencia de un job batch que corre a diario,
-- este es un trigger de fila, una sola ejecución por INSERT/UPDATE real).
--
-- ── 🔒 Semántica BLOQUEANTE (DECISIÓN ABRAHAM 2026-08-25) ────────────────────
-- El INSERT hacia notifications vive en la MISMA transacción del evento, SIN
-- bloque EXCEPTION: si el escritor truena por cualquier motivo que NO sea el
-- conflicto de ancla esperado, la transacción entera revierte (ni la fuente
-- se escribe, ni el aviso) — coherente con admin_actions
-- (handle_ad_status_change, 20260816000006: "sin bloque EXCEPTION a
-- propósito, cualquier fallo debe propagar"). El ON CONFLICT DO NOTHING de
-- (a)-(c) NO es una excepción capturada -- es un camino sin error, el mismo
-- INSERT declarativo simplemente no afecta filas cuando la llave ya existe;
-- cualquier OTRO fallo (el trigger "veneno" de fault-injection del RED
-- sección 7, o cualquier error real de datos) sigue sin bloque
-- EXCEPTION y aborta todo, incluyendo lo que el BEFORE trigger de la máquina
-- de estados (admin_actions) ya había escrito en la MISMA transacción del
-- statement (atomicidad de statement, no necesita savepoint explícito).
--
-- ── D-KEY/D-TYPE/D-LINK (catálogo v1, PRD §22.4) ─────────────────────────────
--   admin_ad_pending          → deep_link '/admin/ads'      · related_entity_type 'ad'
--   admin_revision_pending    → deep_link '/admin/revisions'· related_entity_type 'property_revision'
--   admin_agent_application   → deep_link '/admin/requests' · related_entity_type 'agent_application'
--   admin_agency_pending      → deep_link '/admin/requests' · related_entity_type 'agency'
--   data lleva 'ad_title' (ads) / 'address' (revisiones) / 'application_type'
--   (solicitudes) / 'agency_name' (inmobiliarias) — snake_case, sin colisionar
--   con title/body de la fila (que son del AVISO, no de la entidad).
--
-- ── public.purge_notifications() ─────────────────────────────────────────────
-- Patrón EXACTO de public.purge_ad_impressions (20260817000002) en firma
-- (returns void, security definer, set search_path=''), pero frontera propia:
-- 30 días por created_at (retención prometida por el comment de
-- 20260604000007:70), independiente de read_at (una fila leída también se
-- borra) y de deleted_at (una fila ya borrada por el usuario a los 40 días
-- también se purga físicamente — el comment original promete 30 días de
-- retención, no "retención tras que alguien la borre"). Frontera `<`
-- estricta: exactamente 30 días se CONSERVA, 31 se BORRA (mismo criterio que
-- purge_ad_impressions/90d). Programada vía pg_cron REUSADO (jobname
-- purge_notifications_daily, horario '0 11 * * *' UTC — distinto de
-- rollup_ad_impressions_monthly_daily 0 8, purge_ad_impressions_daily 0 9 y
-- notify_ads_expiring_soon_daily 0 15 UTC, para no competir I/O).
--
-- Idempotente: create unique index if not exists, create or replace function,
-- drop trigger if exists + create trigger, create extension if not exists,
-- cron.schedule idempotente por jobname (confirmado empíricamente en 170.5/
-- 171.4: mismo jobname actualiza in-place, no duplica).
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Índices únicos parciales de idempotencia — SOLO los 3 eventos de disparo
--    único. Parciales SOLO por `type`, nunca por `deleted_at` (un aviso
--    BORRADO sigue anclando — misma decisión que
--    notifications_ad_expiring_soon_anchor_idx, 20260822000001).
-- ════════════════════════════════════════════════════════════════════════════

create unique index if not exists notifications_admin_ad_pending_anchor_idx
  on public.notifications (user_id, related_entity_id, type)
  where type = 'admin_ad_pending';
comment on index public.notifications_admin_ad_pending_anchor_idx is
  'Ancla de idempotencia de admin_ad_pending (#219.1). Parcial SOLO por type '
  '-- un aviso BORRADO por el admin sigue ocupando la llave (mismo criterio '
  'que notifications_ad_expiring_soon_anchor_idx, 20260822000001).';

create unique index if not exists notifications_admin_agency_pending_anchor_idx
  on public.notifications (user_id, related_entity_id, type)
  where type = 'admin_agency_pending';
comment on index public.notifications_admin_agency_pending_anchor_idx is
  'Ancla de idempotencia de admin_agency_pending (#219.1). Ver comment de '
  'notifications_admin_ad_pending_anchor_idx.';

create unique index if not exists notifications_admin_agent_application_anchor_idx
  on public.notifications (user_id, related_entity_id, type)
  where type = 'admin_agent_application';
comment on index public.notifications_admin_agent_application_anchor_idx is
  'Ancla de idempotencia de admin_agent_application (#219.1). Ver comment de '
  'notifications_admin_ad_pending_anchor_idx.';

-- admin_revision_pending NO lleva índice de idempotencia a propósito: el
-- re-envío needs_changes->pending debe generar avisos NUEVOS cada vez (ver
-- cabecera). Un índice sobre (user_id, related_entity_id, type) rompería ese
-- contrato en el primer re-envío.

-- ════════════════════════════════════════════════════════════════════════════
-- 2) admin_ad_pending — trigger AFTER UPDATE en public.ads.
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

drop trigger if exists ads_notify_admin_pending on public.ads;
create trigger ads_notify_admin_pending
  after update on public.ads
  for each row
  when (old.status = 'draft' and new.status = 'pending_review')
  execute function public.notify_admin_ad_pending();

-- Camino real del wizard de anuncios (#219.6): create_ad_campaign_atomic
-- (20260820000005) inserta el ad YA en pending_review -- jamás pasa por
-- draft, así que el AFTER UPDATE de arriba nunca se dispara para ese
-- INSERT. Trigger AFTER INSERT independiente, MISMA función: el ON
-- CONFLICT DO NOTHING sobre notifications_admin_ad_pending_anchor_idx ya
-- protege el doble disparo si algún día un ad pasara por ambos caminos
-- (INSERT directo a pending_review + UPDATE draft->pending_review nunca
-- ocurren para la misma fila, pero el ancla compartida lo cubre de todos
-- modos).
drop trigger if exists ads_notify_admin_pending_insert on public.ads;
create trigger ads_notify_admin_pending_insert
  after insert on public.ads
  for each row
  when (new.status = 'pending_review')
  execute function public.notify_admin_ad_pending();

-- ════════════════════════════════════════════════════════════════════════════
-- 3) admin_agency_pending — trigger AFTER INSERT en public.agencies.
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

drop trigger if exists agencies_notify_admin_pending on public.agencies;
create trigger agencies_notify_admin_pending
  after insert on public.agencies
  for each row
  when (new.status = 'pending_approval')
  execute function public.notify_admin_agency_pending();

-- ════════════════════════════════════════════════════════════════════════════
-- 4) admin_agent_application — trigger AFTER INSERT en public.agent_applications.
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

drop trigger if exists agent_applications_notify_admin_pending on public.agent_applications;
create trigger agent_applications_notify_admin_pending
  after insert on public.agent_applications
  for each row
  when (new.status = 'pending')
  execute function public.notify_admin_agent_application();

-- ════════════════════════════════════════════════════════════════════════════
-- 5) admin_revision_pending — 2 triggers (INSERT + re-envío UPDATE) en
--    public.property_revisions, MISMA función. Sin índice de idempotencia
--    (ver cabecera): cada re-envío genera avisos NUEVOS a propósito.
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

drop trigger if exists property_revisions_notify_admin_insert on public.property_revisions;
create trigger property_revisions_notify_admin_insert
  after insert on public.property_revisions
  for each row
  when (new.status = 'pending')
  execute function public.notify_admin_revision_pending();

drop trigger if exists property_revisions_notify_admin_resubmit on public.property_revisions;
create trigger property_revisions_notify_admin_resubmit
  after update on public.property_revisions
  for each row
  when (old.status = 'needs_changes' and new.status = 'pending')
  execute function public.notify_admin_revision_pending();

-- ════════════════════════════════════════════════════════════════════════════
-- 6) public.purge_notifications() + pg_cron — retención 30 días.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.purge_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Frontera `<` estricta: exactamente 30 días se CONSERVA (dentro de la
  -- ventana de retención prometida por el comment de 20260604000007:70), 31
  -- días se BORRA. Independiente de read_at (una fila leída también se
  -- borra) y de deleted_at (una fila ya borrada por el usuario también se
  -- purga físicamente al rebasar la ventana -- la retención es del DATO, no
  -- "retención tras que alguien la borre").
  delete from public.notifications
   where created_at < now() - interval '30 days';
end;
$$;

comment on function public.purge_notifications() is
  'Borra de notifications lo que rebasa 30 días por created_at (frontera `<` '
  'estricta -- exactamente 30 días se conserva), sin importar read_at ni '
  'deleted_at. Programada diario vía pg_cron (jobname '
  'purge_notifications_daily, 0 11 * * * UTC -- horario distinto de '
  'rollup_ad_impressions_monthly_daily 0 8, purge_ad_impressions_daily 0 9 y '
  'notify_ads_expiring_soon_daily 0 15 UTC, para no competir I/O). Patrón '
  'EXACTO de public.purge_ad_impressions (20260817000002).';

revoke execute on function public.purge_notifications() from public, anon, authenticated;
grant execute on function public.purge_notifications() to service_role;

-- No-op de reutilización si una migración previa (170.5/171.4) ya instaló la
-- extensión; nunca un segundo mecanismo.
create extension if not exists pg_cron with schema cron;

select cron.schedule(
  'purge_notifications_daily',
  '0 11 * * *',
  'select public.purge_notifications();'
);
