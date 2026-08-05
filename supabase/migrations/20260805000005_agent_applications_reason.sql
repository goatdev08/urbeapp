-- Migración — columna `reason` en public.agent_applications, subtarea 71.3
-- Propósito: Camino B del wizard de upgrade (§4.2) — motivo opcional que el
-- solicitante escribe al pedir volverse agente independiente (application_type=
-- 'independent'). Nullable: "docs no obligatorios en beta" aplica también al
-- motivo mismo, no solo a los adjuntos.
-- La tabla, RLS (agent_app_select/insert/update/delete, migración
-- 20260604000008/20260604000010) y el índice anti-duplicados
-- (agent_app_one_pending_per_user, migración 20260604000003) YA EXISTEN — se
-- reusan tal cual (decisión de Abraham 2026-08-05, checkpoint RED de la
-- subtarea): esta migración solo agrega el delta de columna.
-- Idempotente (add column if not exists). Rollback en rollbacks/.

alter table public.agent_applications
  add column if not exists reason text;

comment on column public.agent_applications.reason is
  'Motivo del solicitante para volverse agente (Camino B, §4.2). Nullable — docs/motivo no obligatorios en beta.';
