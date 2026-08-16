-- Migración 20260815000001 — Capacidades sobre public.agencies + helper
-- private.org_can_advertise (tarea #168.1, exploración 039).
-- Aditiva e idempotente. Rollback: rollbacks/20260815000001_org_advertising_capability.sql
-- Tests: supabase/tests/46_org_advertising_test.sql
--
-- Propósito: `agencies` deja de ser "solo puede publicar propiedades" -- gana
--   capacidades independientes (publicar / anunciarse) que 169-171 compondrán
--   en policies y en la EF de anuncios. Esta subtarea SOLO sienta el schema:
--   columnas + enum + CHECK + helper. Nada de RLS/EF nuevas (eso es 168.3+).
--
-- 🔴 Producción viva (§0.5): puramente ADITIVA. Los defaults
--   (can_publish_properties=true, can_advertise=false, advertiser_category=null)
--   son EL comportamiento de hoy -- cero backfill, cero riesgo para filas reales.
--
-- ── advertiser_category: enum NUEVO (no ALTER TYPE ADD VALUE) ──────────────
-- Al ser un tipo nuevo, el gotcha "ADD VALUE no puede correr en la misma
-- transacción que su uso" (ver 20260805000002 / 20260809000002) NO aplica acá.
-- Envuelto en do $$ … $$ solo por idempotencia (create type no admite
-- if not exists).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'advertiser_category') then
    create type public.advertiser_category as enum
      ('credito_hipotecario', 'seguros', 'mudanzas', 'limpieza', 'notaria', 'avaluos', 'otro');
  end if;
end $$;

-- ── Columnas de capacidad sobre agencies ────────────────────────────────────
alter table public.agencies
  add column if not exists can_publish_properties boolean not null default true,
  add column if not exists can_advertise boolean not null default false,
  -- NULLABLE a propósito: la llena el admin al ENCENDER can_advertise, no al
  -- crear la organización (sin CHECK condicional contra can_advertise).
  add column if not exists advertiser_category public.advertiser_category null;

-- ── CHECK: toda organización debe tener al menos una capacidad activa ──────
-- Nombrado explícito (el mensaje de Postgres para violación de CHECK incluye
-- el nombre del constraint -- lo verifica el test literal).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agencies_al_menos_una_capacidad'
      and conrelid = 'public.agencies'::regclass
  ) then
    alter table public.agencies
      add constraint agencies_al_menos_una_capacidad
      check (can_publish_properties or can_advertise);
  end if;
end $$;

-- ── private.org_can_advertise: SEAM que compondrán las policies de 169-171 ─
-- false si: id inexistente | deleted_at no nulo | status <> 'active' |
-- can_advertise = false. true en el happy path. Patrón de
-- private.agency_role_of (20260805000003:14): security definer, search_path
-- fijo, sql stable.
create or replace function private.org_can_advertise(p_agency_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select can_advertise
       from public.agencies
      where id = p_agency_id
        and deleted_at is null
        and status = 'active'),
    false
  );
$$;

comment on function private.org_can_advertise(uuid) is
  'RLS/EF: true si la organización p_agency_id existe, no está borrada '
  '(deleted_at is null), está activa (status=''active'') y tiene la capacidad '
  'can_advertise encendida. SEAM que 169-171 compondrán con agency_role_of '
  'para las policies/EF de anuncios (subtarea #168.1).';

grant execute on function private.org_can_advertise(uuid) to authenticated;

-- ── Comentario de tabla actualizado: agencies ya no es "solo publica" ──────
comment on table public.agencies is
  'Organización: entidad organizacional (no es un rol). Puede publicar propiedades y/o anunciarse según sus capacidades.';

-- 🔒 Seguridad -- NO tocar el grant column-level de 20260604000008:411-412.
-- Los column-grants son opt-in: can_publish_properties/can_advertise/
-- advertiser_category quedan DELIBERADAMENTE fuera de
-- `grant update (...) on public.agencies to authenticated`, así que el
-- cliente (incluido el owner legítimo, que sí pasa la RLS) no puede
-- encenderlas vía UPDATE directo por PostgREST. Solo un flujo con
-- service_role (EF futura de 169-171) podrá tocarlas.
