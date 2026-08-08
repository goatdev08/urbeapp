-- Migración 20260807000002 — lead_status: agrega los 4 valores nuevos del embudo (subtarea 75.1)
-- Bug reportado por el usuario ("los estados no se cambian ni se muestran correctamente"):
-- LeadExpandedView.tsx pinta 7 estados tappables pero lead_status_updater.ts (Edge Function)
-- tenía una máquina ESTRICTA con estados terminales — cada toque "inválido" truena 400
-- INVALID_TRANSITION. PRD §19.8 pide un embudo real con whatsapp_opened/interested/
-- closed_won_rent/closed_won_sale y transiciones libres (el fix de transiciones vive en
-- la Edge Function, subtarea 75.1 GREEN; esta migración solo extiende el enum).
--
-- Los 7 valores legacy ('new','contacted','in_progress','visit_scheduled','closed_won',
-- 'closed_lost','discarded') se CONSERVAN sin tocar — Postgres no puede vaciar un enum
-- (no existe ALTER TYPE ... DROP VALUE), y hay apps v1.0.3 en la calle contra esta misma
-- base (regla expand·migrate·contract, ver CLAUDE.md OTA). Nada de RENAME VALUE ni DROP.
--
-- 🔴 GOTCHA: `ALTER TYPE ... ADD VALUE` puede correr dentro de una transacción, pero el
-- valor nuevo NO se puede USAR (comparar, castear, insertar) hasta que esa transacción
-- haga COMMIT — error: "unsafe use of new value of enum type". Cada migración de Supabase
-- corre en su propia transacción, así que esta migración va SOLA (solo agrega valores,
-- ningún statement los usa); el data-fix (UPDATE ... status='whatsapp_opened') y el resto
-- del schema (is_follow_up, lead_status_history) viven en la siguiente migración
-- (20260807000003), que corre después y ya ve el enum committeado.
-- Precedente idéntico: 20260805000002_agency_member_role_values.sql (mismo gotcha,
-- misma separación en dos migraciones consecutivas).
--
-- Idempotente: ADD VALUE IF NOT EXISTS.
-- Rollback: supabase/migrations/rollbacks/20260807000002_lead_status_reconcile_enum.sql
--   (no-op documentado: un valor de enum agregado NO se puede eliminar en Postgres).

alter type lead_status add value if not exists 'whatsapp_opened';
alter type lead_status add value if not exists 'interested';
alter type lead_status add value if not exists 'closed_won_rent';
alter type lead_status add value if not exists 'closed_won_sale';
