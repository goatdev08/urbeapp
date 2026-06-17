-- Migración 0007 — Analítica, moderación, notificaciones y auditoría
-- Propósito: events_raw (append-only para métricas/recomendaciones, solo service_role),
-- property_reports (cola simple de moderación, sin auto-suspensión), notifications (centro in-app
-- con retención 30d) y admin_actions (auditoría básica append-only, solo INSERT).

-- ── events_raw (append-only, solo service_role; sin updated_at/deleted_at) ───
create table if not exists public.events_raw (
  id                bigint generated always as identity primary key,
  event_type        text not null,
  user_id           uuid references public.users (id) on delete set null,
  property_id       uuid references public.properties (id) on delete set null,
  property_video_id uuid references public.property_videos (id) on delete set null,
  agent_id          uuid references public.users (id) on delete set null,
  payload           jsonb not null default '{}'::jsonb,
  device            text,
  session_id        uuid,
  created_at        timestamptz not null default now()
);
comment on table public.events_raw is
  'Eventos crudos para métricas y futuras recomendaciones. Append-only. Accesible solo por service_role.';

create index if not exists events_raw_type_idx on public.events_raw (event_type, created_at desc);
create index if not exists events_raw_property_idx on public.events_raw (property_id, created_at desc);
create index if not exists events_raw_user_idx on public.events_raw (user_id, created_at desc);
create index if not exists events_raw_created_idx on public.events_raw (created_at);

-- ── property_reports (cola de moderación; auto-suspensión diferida) ─────────
create table if not exists public.property_reports (
  id                   uuid primary key default gen_random_uuid(),
  property_id          uuid not null references public.properties (id) on delete cascade,
  reported_by_user_id  uuid not null references public.users (id) on delete cascade,
  reason               property_report_reason not null,
  reason_text          text,
  status               property_report_status not null default 'new',
  reviewed_by_admin_id uuid references public.users (id) on delete set null,
  reviewed_at          timestamptz,
  resolution           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.property_reports is
  'Reportes de publicaciones. Un usuario no reporta dos veces la misma propiedad. La suspensión es manual (admin).';

create unique index if not exists property_reports_one_per_user
  on public.property_reports (property_id, reported_by_user_id);  -- un usuario, un reporte
create index if not exists property_reports_queue_idx
  on public.property_reports (status, created_at desc);          -- cola de moderación
create index if not exists property_reports_property_idx
  on public.property_reports (property_id);

drop trigger if exists set_updated_at on public.property_reports;
create trigger set_updated_at before update on public.property_reports
  for each row execute function public.set_updated_at();

-- ── notifications (centro in-app, retención 30 días) ────────────────────────
create table if not exists public.notifications (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users (id) on delete cascade,
  type                text not null,                       -- catálogo crece -> text, no enum
  title               text not null,
  body                text,
  deep_link           text,
  related_entity_type text,
  related_entity_id   uuid,
  data                jsonb not null default '{}'::jsonb,
  read_at             timestamptz,
  created_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
comment on table public.notifications is 'Notificaciones in-app del MVP (push FCM es fase posterior). Retención 30d.';

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc) where deleted_at is null;
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read_at is null and deleted_at is null;  -- badge

-- ── admin_actions (auditoría básica, append-only) ───────────────────────────
create table if not exists public.admin_actions (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid not null references public.users (id) on delete restrict,
  action_type text not null,
  entity_type text not null,
  entity_id   uuid not null,
  old_values  jsonb,
  new_values  jsonb,
  reason      text,
  ip_address  inet,
  created_at  timestamptz not null default now()
);
comment on table public.admin_actions is
  'Auditoría de acciones de admin. Append-only (solo INSERT vía RLS). Retención permanente.';

create index if not exists admin_actions_admin_idx
  on public.admin_actions (admin_id, created_at desc);
create index if not exists admin_actions_entity_idx
  on public.admin_actions (entity_type, entity_id, created_at desc);
