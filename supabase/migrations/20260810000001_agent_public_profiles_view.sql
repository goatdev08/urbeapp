-- Migración 20260810000001 — vista agent_public_profiles (#145.1)
--
-- Problema: full_name y profile_photo_url viven en user_preferences (migración
-- 0015, decisión de la época del onboarding) pero user_prefs_select es "solo tu
-- fila o admin" (migración 0010). TODA lectura ajena devolvía 0 filas EN
-- SILENCIO: el feed mostraba la inicial placeholder, y el perfil público
-- (/profile/[id]) y la AgentCard del detalle caían al fallback para cualquier
-- usuario no-admin sin que nadie lo notara.
--
-- Fix: vista con derechos del OWNER (security_invoker=false, el default de
-- Postgres) que brinca la RLS de user_preferences EXCLUSIVAMENTE para la
-- identidad pública de agentes: user_id, full_name, profile_photo_url. El
-- comportamiento del buscador (presupuesto, ubicación, filtros) y la identidad
-- de usuarios role='user' NO se exponen — consistente con la regla "registrar
-- ≠ exponer" (wiki/conceptos/rls-seguridad) y con la decisión de la tarea 30
-- (la identidad de buscadores solo se lee vía users_select con relación
-- vigente de lead).
--
-- Nota RLS: la RLS de user_preferences NO cambia. La vista es la ÚNICA puerta
-- y es de solo lectura (las vistas sobre join no aceptan INSERT/UPDATE sin
-- reglas explícitas; además solo se otorga SELECT).
--
-- Idempotente: create or replace + revoke/grant re-ejecutables.
-- Rollback: supabase/migrations/rollbacks/20260810000001_agent_public_profiles_view.sql

create or replace view public.agent_public_profiles
with (security_invoker = false) as
  select up.user_id, up.full_name, up.profile_photo_url
  from public.user_preferences up
  join public.users u on u.id = up.user_id
  where u.role in ('agent', 'admin');

comment on view public.agent_public_profiles is
  'Identidad pública de agentes/admins (nombre + foto R2 key) legible por cualquier sesión autenticada. Brinca la RLS de user_preferences SOLO en estas columnas (#145).';

-- Privilegios: solo sesiones autenticadas; anon fuera (el feed exige sesión).
revoke all on public.agent_public_profiles from anon, public;
grant select on public.agent_public_profiles to authenticated;
