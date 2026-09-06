-- Rollback: 20260906100004_crm_lead_detail_activity.sql (subtarea 266.5)
-- Quita las 2 RPC nuevas. Aditiva pura: ninguna tabla tocada, ningún helper nuevo (se reusó
-- private.can_view_lead tal cual) — nada más que restaurar.

drop function if exists public.crm_lead_detail(uuid);
drop function if exists public.lead_activity(uuid, int, timestamptz);
