-- Migración 20260828000002 — trigger de auto-suspensión 3/24h en
-- public.property_reports + notificaciones de ambos lados (subtarea #220.2,
-- tarea 220 "reportes de propiedad y auto-moderación", exploración 041-M2).
-- Aditiva pura: 1 función trigger nueva + 1 trigger AFTER INSERT nuevo sobre
-- public.property_reports (que ya existe, 20260604000007). Ninguna tabla
-- creada, ningún contrato observable roto. Ningún efecto sobre filas
-- existentes al migrar (el trigger es AFTER INSERT: nunca re-evalúa el
-- histórico de property_reports ya insertado antes de esta migración) — gate
-- §0.5 producción viva.
-- Contrato completo (edge cases, D-KEY/D-TYPE/D-LINK, convención DELTA vs
-- INVARIANTE): ver cabecera de
-- supabase/tests/74_property_reports_autosuspend_test.sql (RED, 2026-08-28).
-- Rollback: supabase/migrations/rollbacks/20260828000002_property_reports_autosuspend.sql
--
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ: un trigger AFTER INSERT en public.property_reports, MISMA transacción
-- del INSERT, SIN bloque EXCEPTION (🔒 decisión 041/219, reafirmada para
-- 220.2 por Abraham 2026-08-28 — cualquier fallo del escritor de
-- notificaciones revierte el reporte entero, fault-injection FAULTA/FAULTB
-- del RED):
--   1. Bloquea la fila de la propiedad (`for update`, carrera entre reportes
--      concurrentes) y lee su status/address/owner_user_id.
--   2. Si YA está 'suspended' → no-op total (ni admin_report_new ni
--      admin_report_autosuspend), pero el reporte SÍ se persiste (la fila
--      de property_reports no la toca este guard).
--   3. Si NO está suspendida: cuenta, en una ventana deslizante REAL de 24h
--      por created_at (created_at >= now() - interval '24 hours'), cuántos
--      reported_by_user_id DISTINTOS reportaron esa property_id —
--      incluyendo la fila recién insertada (misma transacción, MVCC ve su
--      propia escritura).
--        - conteo >= 3 → status = 'suspended' + admin_report_autosuspend
--          (a los admins) + property_suspended_by_reports (al owner).
--        - conteo 1 o 2 → admin_report_new (a los admins).
--   Fan-out a admins: public.users role='admin' AND deleted_at is null
--   (lección 223.2, índice parcial users_role_idx). Guard "nunca el actor":
--   se excluye SOLO al admin cuyo id sea reported_by_user_id de LA FILA QUE
--   DISPARA el evento — un admin que reportó una propiedad SÍ recibe los
--   avisos de reportes AJENOS sobre esa misma propiedad, solo nunca el aviso
--   de su PROPIO reporte (mismo guard que 219.1/219.2).
--   NO escribe en admin_actions (decisión Abraham 2026-08-28: sin actor
--   humano, admin_actions.admin_id es NOT NULL FK restrict).
--
-- ── Idempotencia: guard `status <> 'suspended'` + `for update`, SIN índice
--    único de dedupe ─────────────────────────────────────────────────────
-- A diferencia de admin_ad_pending/admin_agency_pending/
-- admin_agent_application (219.1, disparo único en la vida de la entidad),
-- una propiedad SÍ puede volver a acumular >=3 reportes distintos en ventana
-- tras ser restaurada a mano por un admin (RESUS del RED) — mismo criterio
-- que admin_revision_pending: un índice único de idempotencia bloquearía esa
-- re-suspensión legítima. El `for update` sobre la fila de properties
-- resuelve la carrera de dos reportes concurrentes intentando suspender a la
-- vez (ambos ven el mismo conteo; el segundo en tomar el lock ve el status
-- ya 'suspended' tras el commit/espera del primero — en pgTAP de un solo
-- backend esto no se ejerce con concurrencia real, pero es el patrón
-- correcto para producción).
--
-- ── D-KEY/D-TYPE/D-LINK (catálogo, decisión test-author fijada en el RED) ───
--   admin_report_new          → deep_link '/admin/reports' (nace en #220.4,
--     MISMA tarea — no es ruta muerta al cerrar) · related_entity_type
--     'property' · data->>'address'.
--   admin_report_autosuspend  → deep_link '/admin/reports' · related_entity_type
--     'property' · data->>'address'.
--   property_suspended_by_reports → deep_link '/profile/my-listings' (ruta
--     viva, mobile/app/(protected)/profile/my-listings.tsx) ·
--     related_entity_type 'property' · data->>'address' Y data->>'reason' =
--     'multiple_reports'.
--
-- Idempotente: create or replace function, drop trigger if exists + create
-- trigger.
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
  'admins + property_suspended_by_reports al owner. Guard "nunca el actor": '
  'excluye solo al admin cuyo id sea el reported_by_user_id de ESTE evento. '
  'Propiedad ya suspended = no-op total (ni suspende de nuevo ni notifica), '
  'el reporte igual se persiste como auditoría. NO escribe en admin_actions '
  '(decisión Abraham 2026-08-28: sin actor humano, admin_id es NOT NULL FK '
  'restrict). Sin bloque EXCEPTION: cualquier fallo, incluido el del '
  'escritor de notifications, revierte todo el evento (fault-injection '
  'FAULTA/FAULTB del RED).';

drop trigger if exists property_reports_notify_and_autosuspend on public.property_reports;
create trigger property_reports_notify_and_autosuspend
  after insert on public.property_reports
  for each row
  execute function public.notify_property_report_and_autosuspend();
