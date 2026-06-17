-- Migración 0006 — Engagement y CRM básico
-- Propósito: interacciones de estado del buscador (likes, saves) y el CRM mínimo del MVP:
-- leads (lista cronológica SIN scoring ni funnel) y lead_origin_properties (de qué propiedades/
-- videos vino el contacto, para "propiedades vistas"). Regla central: un lead por par agente-usuario.

-- ── likes (granularidad: video) ─────────────────────────────────────────────
create table if not exists public.likes (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users (id) on delete cascade,
  property_video_id uuid not null references public.property_videos (id) on delete cascade,
  property_id       uuid not null references public.properties (id) on delete cascade,  -- denorm
  created_at        timestamptz not null default now()
);
comment on table public.likes is 'Like a un VIDEO específico. El conteo se mantiene denormalizado en properties.like_count.';

create unique index if not exists likes_user_video_unique
  on public.likes (user_id, property_video_id);
create index if not exists likes_property_idx on public.likes (property_id);
create index if not exists likes_user_idx on public.likes (user_id, created_at desc);

-- ── saves (granularidad: propiedad) ─────────────────────────────────────────
create table if not exists public.saves (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  created_at  timestamptz not null default now()
);
comment on table public.saves is 'Guardado de una PROPIEDAD completa (privado, lista "Guardados").';

create unique index if not exists saves_user_property_unique
  on public.saves (user_id, property_id);
create index if not exists saves_property_idx on public.saves (property_id);
create index if not exists saves_user_idx on public.saves (user_id, created_at desc);

-- ── leads (sin score/funnel — MVP cronológico) ──────────────────────────────
create table if not exists public.leads (
  id               uuid primary key default gen_random_uuid(),
  agent_id         uuid not null references public.users (id) on delete cascade,  -- dueño del lead
  user_id          uuid not null references public.users (id) on delete cascade,  -- buscador que contactó
  status           lead_status not null default 'new',
  internal_notes   text,
  first_contact_at timestamptz not null default now(),
  last_contact_at  timestamptz,
  closed_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint lead_agent_not_self check (agent_id <> user_id)
);
comment on table public.leads is
  'CRM básico: un lead por par (agent_id, user_id). Sin scoring (diferido a fase posterior). El buscador NO ve el lead.';

create unique index if not exists leads_agent_user_unique_active
  on public.leads (agent_id, user_id) where deleted_at is null;     -- un lead por par
create index if not exists leads_agent_crm_idx
  on public.leads (agent_id, status, last_contact_at desc) where deleted_at is null;  -- CRM del agente
create index if not exists leads_user_idx on public.leads (user_id);

drop trigger if exists set_updated_at on public.leads;
create trigger set_updated_at before update on public.leads
  for each row execute function public.set_updated_at();

-- ── lead_origin_properties (propiedades/videos de origen del contacto) ──────
create table if not exists public.lead_origin_properties (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid not null references public.leads (id) on delete cascade,
  property_id       uuid not null references public.properties (id) on delete cascade,
  property_video_id uuid references public.property_videos (id) on delete set null,
  contacted_at      timestamptz not null default now()
);
comment on table public.lead_origin_properties is 'De qué propiedades/videos surgió el contacto del lead.';

create unique index if not exists lead_origin_lead_property_unique
  on public.lead_origin_properties (lead_id, property_id);
create index if not exists lead_origin_property_idx
  on public.lead_origin_properties (property_id);
