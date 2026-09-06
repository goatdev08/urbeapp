-- Rollback: 20260906200001_crm_suggested_message.sql (subtarea 267.4)
-- Quita la RPC nueva. Aditiva pura: ninguna tabla tocada, ningún helper nuevo (se reusó
-- private.can_view_lead tal cual) — nada más que restaurar.

drop function if exists public.crm_suggested_message(uuid);
