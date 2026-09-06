-- Rollback: 20260906100005_crm_radar_anon.sql (subtarea 266.6)
-- Aditiva pura (1 función nueva en `public`, ninguna tabla/columna tocada, ningún helper
-- nuevo — se reusó private.can_manage_agent_pipeline de 266.4 tal cual): el rollback es
-- simplemente eliminarla.

drop function if exists public.crm_radar_anon(uuid, int);
