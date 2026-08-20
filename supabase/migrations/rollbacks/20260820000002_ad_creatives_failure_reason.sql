-- Rollback: 20260820000002_ad_creatives_failure_reason.sql (tarea #189)
--
-- ⚠️ DESTRUCTIVO: `drop column` BORRA las razones ya registradas. No hay forma
-- de recuperarlas. Solo revertir si la columna resultara ser el problema, y
-- ANTES desplegar un cliente que no dependa de ella (el `select('status,
-- failure_reason')` de useAdUpload fallaría con 42703 contra una tabla sin la
-- columna). Es decir: si esto se revierte, el orden es cliente-OTA-primero,
-- igual que cualquier contract (CLAUDE.md §0.5, precedente #116).
--
-- Re-ejecutable (if exists).

alter table public.ad_creatives
  drop column if exists failure_reason;
