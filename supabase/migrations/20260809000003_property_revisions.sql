-- Migración 20260809000003 — property_revisions (subtarea 73.2, PRD §15.5-15.6)
-- Propósito: tabla snapshot para la edición pendiente de una propiedad ya publicada.
-- Invariante 🔒 §15.6 (doble versión): la propiedad PUBLICADA (properties, "live") y su
-- REVISIÓN pendiente coexisten sin pisarse — el feed/detalle público sigue leyendo
-- `properties` mientras hay una revisión 'pending'/'needs_changes' en curso. Esta migración
-- solo crea el shape + invariantes de datos; aplicar el snapshot al aprobar y descartarlo al
-- rechazar es lógica de Edge Function (subtarea 73.6, fuera de alcance aquí) — property_revisions
-- NO tiene policies de escritura para `authenticated`, solo service_role puede escribir.
--
-- Estilo calcado de agent_applications [20260604000003:108-133] (tabla + índice único
-- parcial "una activa a la vez") y admin_actions [20260604000007:78-95] (auditoría
-- inmutable: submitted_by on delete RESTRICT, no set null).
--
-- Idempotente: create type con guard pg_type, create table if not exists, índices/policies
-- con "if not exists"/"drop policy if exists" previo.
-- Rollback: supabase/migrations/rollbacks/20260809000003_property_revisions.sql

-- ── enum property_revision_status ────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'property_revision_status') then
    create type property_revision_status as enum ('pending', 'needs_changes', 'rejected', 'approved');
  end if;
end $$;

-- ── property_revisions ───────────────────────────────────────────────────────
create table if not exists public.property_revisions (
  id                    uuid primary key default gen_random_uuid(),
  property_id           uuid not null references public.properties (id) on delete cascade,
  status                property_revision_status not null default 'pending',
  changed_fields        jsonb not null,
  submitted_by          uuid not null references public.users (id) on delete restrict,
  reviewed_by_admin_id  uuid references public.users (id) on delete set null,
  reviewed_at           timestamptz,
  rejection_reason      text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
comment on table public.property_revisions is
  'Snapshot de la edición pendiente de una propiedad ya publicada (doble versión §15.6). '
  'La propiedad viva (public.properties) es la única que ve el feed/detalle público mientras '
  'la revisión está pending/needs_changes. Escritura exclusiva de service_role (Edge Function 73.6).';

-- *** INVARIANTE 🔒 §15.6: a lo más UNA revisión activa (pending/needs_changes) por propiedad.
-- approved/rejected históricas coexisten sin problema (índice PARCIAL, no total). ***
create unique index if not exists property_revisions_one_active_per_property
  on public.property_revisions (property_id) where status in ('pending', 'needs_changes');

create index if not exists property_revisions_property_idx
  on public.property_revisions (property_id);
create index if not exists property_revisions_submitted_by_idx
  on public.property_revisions (submitted_by);
create index if not exists property_revisions_reviewer_idx
  on public.property_revisions (reviewed_by_admin_id);
create index if not exists property_revisions_queue_idx
  on public.property_revisions (status, created_at desc);  -- cola de revisión admin

drop trigger if exists set_updated_at on public.property_revisions;
create trigger set_updated_at before update on public.property_revisions
  for each row execute function public.set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.property_revisions enable row level security;

-- SELECT: dueño de la propiedad o admin. Sin policy para anon (fail-closed).
drop policy if exists property_revisions_select on public.property_revisions;
create policy property_revisions_select on public.property_revisions for select to authenticated
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_revisions.property_id and p.owner_user_id = (select auth.uid())
    )
    or private.is_admin()
  );

-- Sin policies de INSERT/UPDATE/DELETE para `authenticated` a propósito: la escritura es
-- exclusiva de service_role (Edge Function de la subtarea 73.6). Fail-closed por diseño.

-- ── Grants (fail-closed con dientes, patrón lead_status_history/user_consents) ─
-- Tablas nuevas en public NO heredan grants de anon/authenticated (el blanket grant de
-- 0008 solo cubrió las tablas que existían entonces); hay que otorgar explícitamente. Se
-- revoca todo primero y se re-otorga solo SELECT: RLS es quien filtra (dueño/admin ven,
-- el resto 0 filas), no la ausencia de GRANT — así anon/authenticated obtienen 0 filas
-- (comportamiento observable correcto), no un error de permiso a nivel de tabla.
revoke all on public.property_revisions from anon, authenticated;
grant select on public.property_revisions to anon, authenticated;
grant select, insert, update, delete on public.property_revisions to service_role;
