-- Migración 20260805000001 — premium derivado: private.is_premium(uid)
-- Subtarea 71.1 (tarea #71, PRD §4.5 "Usuario premium"). "Premium" es una CAPACIDAD
-- DERIVADA, nunca un rol almacenado: el enum user_role queda {user,agent,admin}, sin
-- tocarse. Un usuario (de cualquier rol) es premium si tiene al menos una
-- public.properties propia NO borrada (deleted_at is null) -- el status (draft/active/
-- closed/...) no filtra, basta que exista y no esté soft-deleted.
--
-- ⚠️ Rama "purchase vigente" DIFERIDA (ponytail: la tabla purchases/video_slots aún no
-- existe en supabase/migrations/ -- pertenece a la épica futura #76, PRD-beta §17
-- "Modelo de pagos". Cuando aterrice, is_premium ganará un segundo `or exists (...)`
-- sobre purchases; por ahora la función cubre EXCLUSIVAMENTE la rama de properties,
-- tal como especifica el RED en supabase/tests/20_premium_derived_test.sql).
--
-- Patrón: helper en schema `private`, SECURITY DEFINER STABLE, `search_path` fijo
-- (superficie de ataque de una función SECURITY DEFINER), EXECUTE explícito solo a
-- `authenticated` (NO blanket a anon) -- mismo criterio que
-- private.can_view_user_as_lead_searcher (migración 20260702000001): las capacidades
-- premium son de gestión de la cuenta propia, nunca de un visitante anónimo.
--
-- NULL o uid inexistente → false sin error: `owner_user_id = uid` con uid NULL nunca
-- es true (semántica SQL de NULL), así que EXISTS resuelve false de forma natural, sin
-- necesidad de un guard explícito.
--
-- Subtarea 71.1 — FASE GREEN. RED: supabase/tests/20_premium_derived_test.sql (plan 16).
-- Idempotente: CREATE OR REPLACE FUNCTION.
-- Rollback: supabase/migrations/rollbacks/20260805000001_premium_derived_helper.sql

create or replace function private.is_premium(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.properties
    where owner_user_id = uid
      and deleted_at is null
  );
$$;

comment on function private.is_premium(uuid) is
  'Capacidad derivada "premium" (PRD §4.5): true si uid tiene al menos una '
  'public.properties propia no borrada (deleted_at is null); el status no filtra. '
  'NUNCA un rol almacenado -- el enum user_role queda {user,agent,admin}. '
  'Rama "purchase vigente" diferida a la épica #76 (PRD-beta §17) -- ver comentario '
  'de cabecera de esta migración.';

grant execute on function private.is_premium(uuid) to authenticated;
