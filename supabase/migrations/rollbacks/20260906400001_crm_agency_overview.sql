-- Rollback: 20260906400001_crm_agency_overview.sql (subtarea 269.1)
-- Quita la RPC nueva. Aditiva pura: ninguna tabla tocada, ningún helper compartido creado
-- (ponytail full: sin private.can_manage_agency_overview, una sola función) — nada más que
-- restaurar.

drop function if exists public.crm_agency_overview(uuid);
