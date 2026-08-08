-- Rollback: 20260807000003_lead_status_reconcile.sql
-- Deshace el trigger de historial, la tabla lead_status_history y la columna
-- leads.is_follow_up. Ejecutar ANTES de intentar revertir 20260807000002 (el enum).
--
-- Nota: el data-fix ('new' → 'whatsapp_opened') NO se revierte — no hay forma de
-- distinguir qué filas eran 'new' antes de la migración de las que ya estaban en
-- 'whatsapp_opened' por escritura normal después de aplicarla (mismo criterio que
-- supabase/migrations/rollbacks/20260701000001_engagement_count_triggers.sql: no
-- reconstruir datos derivados/mutados para no perder información). Si se requiere
-- forzar manualmente: UPDATE public.leads SET status = 'new' WHERE status = 'whatsapp_opened';
-- -- pero eso reescribiría también leads que llegaron a whatsapp_opened legítimamente
-- después del deploy, así que NO se incluye como statement automático de este rollback.

drop trigger if exists trg_lead_status_history on public.leads;
drop function if exists public.log_lead_status_change();

drop policy if exists lead_status_history_select on public.lead_status_history;
drop table if exists public.lead_status_history;

alter table public.leads drop column if exists is_follow_up;
