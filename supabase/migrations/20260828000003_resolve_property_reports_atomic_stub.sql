-- Migración 20260828000003 — STUB (RED, subtarea #220.3, tarea 220 "reportes de
-- usuarios y auto-moderación", exploración 041-M3).
--
-- 🔴 ESTE ES UN STUB DE LA FASE RED — sin lógica de negocio. Existe solo para que
-- la suite pgTAP 75_moderate_property_report_resolution_test.sql pueda LLAMAR la
-- función (evita el error de catálogo 42883 "function does not exist", que
-- abortaría la transacción entera y rompería el patrón `begin;...rollback;` de
-- una sola transacción que usan todas las suites de este repo) y falle por
-- ASERCIÓN (los efectos esperados — status/reports/notifications/admin_actions
-- — simplemente no ocurren) en vez de por error de sintaxis/catálogo.
--
-- GREEN (siguiente migración, create-or-replace de la MISMA firma, patrón
-- idéntico a 20260827000001 sobre 20260826000001) debe implementar:
--   - Guard: p_action_type in ('restore','request_changes','keep_suspended','delete')
--     si no, excepción P0001 INVALID_ACTION_TYPE. p_admin_id/p_property_id NOT NULL.
--   - Lock FOR UPDATE de la propiedad; si no existe, excepción P0001.
--   - Idempotencia SIN índice único (retry-dedup en memoria, ver bitácora 220.3):
--       restore/request_changes: no-op TOTAL si old_status <> 'suspended'.
--       keep_suspended: además exige >=1 reporte 'new' pendiente.
--       delete: además exige deleted_at IS NULL.
--   - Cierre de reportes: property_reports SET status='resolved',
--     reviewed_by_admin_id=p_admin_id, reviewed_at=now(), resolution=p_reason
--     WHERE property_id=p_property_id AND status='new' (nunca toca otra
--     propiedad ni reportes ya resueltos/descartados — WHERE status='new' es
--     idempotente por construcción).
--   - Transición properties.status: restore→active, request_changes→
--     needs_changes, keep_suspended→sin cambio, delete→sin cambio +
--     deleted_at=now() (NUNCA deleted_soft/deleted_hard).
--   - admin_actions SIEMPRE que hubo trabajo real (entity_type='property').
--   - Espejo a notifications al OWNER (nunca al admin actor), deep_link
--     '/profile/my-listings', related_entity_type 'property', type según
--     acción (property_report_restored/needs_changes/kept_suspended/deleted).
--   - SIN bloque EXCEPTION (mismo criterio que 219.1/219.2/220.2): el fallo del
--     INSERT de notifications revierte TODO el evento.
--
-- Rollback: supabase/migrations/rollbacks/20260828000003_resolve_property_reports_atomic_stub.sql

create or replace function public.resolve_property_reports_atomic(
  p_admin_id    uuid,
  p_property_id uuid,
  p_action_type text,
  p_reason      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 🔴 STUB RED: no-op a propósito. Cero escrituras — deja que las
  -- aserciones de la suite 75 fallen limpio contra el estado sin cambios.
  return;
end;
$$;

comment on function public.resolve_property_reports_atomic(uuid, uuid, text, text) is
  '🔴 STUB RED (subtarea 220.3) — sin lógica todavía. Ver cabecera de esta '
  'migración y supabase/tests/75_moderate_property_report_resolution_test.sql '
  'para el contrato completo que el GREEN debe implementar.';

grant execute on function public.resolve_property_reports_atomic(uuid, uuid, text, text) to service_role;
