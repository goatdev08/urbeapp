-- Rollback: 20260906100003_crm_leads_page_funnel.sql (subtarea 266.4)
-- Quita las 2 RPC nuevas y el helper private.can_manage_agent_pipeline. Aditiva pura:
-- ninguna tabla tocada, get_lead_stats intacto — nada más que restaurar. Orden: los
-- dependientes (RPC públicas) antes que el helper que llaman.

drop function if exists public.crm_leads_page(uuid, text, jsonb, int, text);
drop function if exists public.crm_funnel(uuid, int);
drop function if exists private.can_manage_agent_pipeline(uuid);
