-- Migración 20260809000002 — property_status: agrega los 10 estados operativos del PRD §15.4
-- (subtarea 73.1)
-- El enum property_status (20260604000001) tenía 7 valores ('draft','pending_review',
-- 'needs_changes','active','paused','closed','suspended' — MVP simplificado del ciclo de vida
-- completo de 16 estados del PRD). El wizard de 5 pasos y el flujo de moderación/pago
-- (subtareas 73.x en adelante) necesitan estados operativos más finos: uploading_media,
-- media_failed, pending_payment, approved, expired, rented, sold, rejected, deleted_soft,
-- deleted_hard. Esta migración SOLO extiende el enum -- ningún statement en este archivo
-- compara, castea ni referencia los valores nuevos (el mismo gotcha de ADD VALUE + uso en la
-- misma transacción que 20260805000002 y 20260807000002).
--
-- DECISIÓN (usuario 2026-08-09, ver subtarea 73.1): aditivo puro. 'closed' se MANTIENE VIVO
-- en el enum -- NO se deprecia, NO se elimina -- solo para filas históricas ya escritas con
-- closed_reason (incluye 'withdrawn' del modelo antiguo, que el PRD §15 nuevo no contempla
-- como estado propio). Código nuevo (subtarea 73.8 en adelante) usará
-- rented/sold/expired/deleted_soft/deleted_hard directo; nunca volverá a escribir 'closed'.
-- Enum final: 17 valores = 7 originales + 10 nuevos. SIN backfill de datos existentes.
--
-- 🔴 GOTCHA: `ALTER TYPE ... ADD VALUE` no puede convivir en la misma transacción con código
-- que USE el valor nuevo (comparaciones, casts, políticas RLS, constraints) -- error "unsafe
-- use of new value of enum type". Supabase corre cada archivo de migración en su propia
-- transacción, así que esta migración va SOLA. Cualquier lógica que referencie estos valores
-- nuevos debe vivir en una migración posterior. Precedente idéntico:
-- 20260805000002_agency_member_role_values.sql y 20260807000002_lead_status_reconcile_enum.sql.
--
-- Idempotente: ADD VALUE IF NOT EXISTS.
-- Rollback: supabase/migrations/rollbacks/20260809000002_property_status_operational_values.sql
--   (no-op documentado: un valor de enum agregado NO se puede eliminar en Postgres).

alter type property_status add value if not exists 'uploading_media';
alter type property_status add value if not exists 'media_failed';
alter type property_status add value if not exists 'pending_payment';
alter type property_status add value if not exists 'approved';
alter type property_status add value if not exists 'expired';
alter type property_status add value if not exists 'rented';
alter type property_status add value if not exists 'sold';
alter type property_status add value if not exists 'rejected';
alter type property_status add value if not exists 'deleted_soft';
alter type property_status add value if not exists 'deleted_hard';
