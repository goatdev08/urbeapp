-- Migración 20260809000004 — property_video_slots: abstracción de vigencia del
-- slot de video consumido al publicar (subtarea 73.4, absorbe 73.5, PRD §2.2/§17.1).
--
-- Propósito: TODA publicación consume un "slot" de video — en beta, siempre
-- gratis (video_slot_free, is_free default true, sin lógica de pago todavía).
-- Esta tabla es la semilla mínima que #76 (pagos) extenderá con vigencia real
-- (expiración, renovación) — crearla ahora, mínima, cablea el punto de enganche
-- sin construir el sistema de pagos antes de que exista (YAGNI).
--
-- Escritura exclusiva de la RPC public.publish_property_atomic (SECURITY
-- DEFINER, extendida en 20260809000005) — sin policies de INSERT/UPDATE/DELETE
-- para `authenticated`, mismo patrón fail-closed que property_revisions
-- (20260809000003, subtarea 73.2).
--
-- Idempotente: create table if not exists, drop policy if exists + create policy.
-- Rollback: supabase/migrations/rollbacks/20260809000004_property_video_slots.sql

create table if not exists public.property_video_slots (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null unique references public.properties (id) on delete cascade,
  started_at   timestamptz not null default now(),
  is_free      boolean not null default true,
  created_at   timestamptz not null default now()
);
comment on table public.property_video_slots is
  'Abstracción de vigencia del slot de video consumido al publicar (PRD §2.2/§17.1). '
  'Beta: siempre gratis (is_free default true, video_slot_free). Semilla mínima '
  'para #76 (pagos) — started_at/is_free ya cableados para cuando exista '
  'expiración/renovación real. Escritura exclusiva de la RPC '
  'publish_property_atomic (SECURITY DEFINER), nunca directa de authenticated.';

create index if not exists property_video_slots_property_idx
  on public.property_video_slots (property_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.property_video_slots enable row level security;

-- SELECT: dueño de la propiedad o admin (mismo patrón que property_revisions_select,
-- 20260809000003). Sin policy de anon (fail-closed).
drop policy if exists property_video_slots_select on public.property_video_slots;
create policy property_video_slots_select on public.property_video_slots for select to authenticated
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_video_slots.property_id and p.owner_user_id = (select auth.uid())
    )
    or private.is_admin()
  );

-- Sin policies de INSERT/UPDATE/DELETE para `authenticated` a propósito: la
-- escritura es exclusiva de la RPC publish_property_atomic (SECURITY DEFINER,
-- corre bypassando RLS). Fail-closed por diseño.

-- ── Grants (fail-closed con dientes, patrón property_revisions/lead_status_history) ─
-- Tablas nuevas en public NO heredan grants de anon/authenticated (el blanket grant
-- de 0008 solo cubrió las tablas que existían entonces); hay que otorgar
-- explícitamente. Se revoca todo primero y se re-otorga solo SELECT: RLS es
-- quien filtra (dueño/admin ven, el resto 0 filas), no la ausencia de GRANT.
revoke all on public.property_video_slots from anon, authenticated;
grant select on public.property_video_slots to anon, authenticated;
grant select, insert, update, delete on public.property_video_slots to service_role;
