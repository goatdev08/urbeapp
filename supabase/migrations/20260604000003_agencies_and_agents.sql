-- Migración 0003 — Inmobiliarias y agentes (alcance esencial)
-- Propósito: entidad organizacional `agencies` y la gestión de sus agentes:
--   agency_members (con la regla "máx 1 inmobiliaria activa por agente"),
--   agency_invitation_tokens (guardan HASH del token),
--   agent_applications (independiente requiere admin; bajo-inmobiliaria con token válido es automático),
--   agent_interest_submissions (formulario público "Quiero ser agente").
-- También cierra la FK circular users.agency_id -> agencies(id).

-- ── agencies ────────────────────────────────────────────────────────────────
create table if not exists public.agencies (
  id                   uuid primary key default gen_random_uuid(),
  name                 citext not null,
  slug                 text not null,
  logo_url             text,
  contact_name         text,
  contact_phone        text,
  contact_email        citext,
  status               agency_status not null default 'pending_approval',
  created_by_user_id   uuid not null references public.users (id) on delete restrict,
  approved_by_admin_id uuid references public.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);
comment on table public.agencies is 'Inmobiliaria: entidad organizacional (no es un rol de usuario).';

create unique index if not exists agencies_slug_unique_active
  on public.agencies (slug) where deleted_at is null;
create unique index if not exists agencies_name_unique_active
  on public.agencies (name) where deleted_at is null;
create index if not exists agencies_status_idx
  on public.agencies (status) where deleted_at is null;
create index if not exists agencies_name_trgm_idx
  on public.agencies using gin (name gin_trgm_ops);  -- búsqueda por nombre (lineamientos §32.3)
create index if not exists agencies_created_by_idx
  on public.agencies (created_by_user_id);

drop trigger if exists set_updated_at on public.agencies;
create trigger set_updated_at before update on public.agencies
  for each row execute function public.set_updated_at();

-- Cierra la dependencia circular: users.agency_id -> agencies(id)
alter table public.users
  drop constraint if exists users_agency_id_fkey;
alter table public.users
  add constraint users_agency_id_fkey
  foreign key (agency_id) references public.agencies (id) on delete set null;

-- ── agency_invitation_tokens ────────────────────────────────────────────────
-- `token` almacena el HASH (sha256) del token; el valor plano nunca toca la BD.
create table if not exists public.agency_invitation_tokens (
  id                 uuid primary key default gen_random_uuid(),
  agency_id          uuid not null references public.agencies (id) on delete cascade,
  token              text not null,
  target_email       citext,
  max_uses           int check (max_uses is null or max_uses > 0),  -- null = ilimitado
  current_uses       int not null default 0 check (current_uses >= 0),
  expires_at         timestamptz,
  created_by_user_id uuid not null references public.users (id) on delete restrict,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint tokens_uses_within_max check (max_uses is null or current_uses <= max_uses)
);
comment on table public.agency_invitation_tokens is
  'Tokens para invitar agentes a una inmobiliaria. Validez = no revocado, no expirado, current_uses < max_uses. El consumo (current_uses+1) es atómico vía UPDATE condicional en Edge Function.';

create unique index if not exists agency_tokens_token_unique
  on public.agency_invitation_tokens (token);
create index if not exists agency_tokens_agency_idx
  on public.agency_invitation_tokens (agency_id);

drop trigger if exists set_updated_at on public.agency_invitation_tokens;
create trigger set_updated_at before update on public.agency_invitation_tokens
  for each row execute function public.set_updated_at();

-- ── agency_members ──────────────────────────────────────────────────────────
create table if not exists public.agency_members (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null references public.agencies (id) on delete cascade,
  user_id             uuid not null references public.users (id) on delete cascade,
  member_role         agency_member_role not null default 'agent',
  status              agency_member_status not null default 'active',
  joined_at           timestamptz not null default now(),
  removed_at          timestamptz,
  invitation_token_id uuid references public.agency_invitation_tokens (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.agency_members is
  'Relación agente<->inmobiliaria. member_role owner administra; agent es miembro.';

-- *** REGLA CLAVE: un agente pertenece a lo más a 1 inmobiliaria activa. Enforzada atómicamente. ***
create unique index if not exists agency_members_one_active_per_user
  on public.agency_members (user_id) where status = 'active';
create unique index if not exists agency_members_agency_user_active
  on public.agency_members (agency_id, user_id) where status = 'active';
create index if not exists agency_members_agency_active_idx
  on public.agency_members (agency_id) where status = 'active';  -- listar agentes activos
create index if not exists agency_members_user_idx
  on public.agency_members (user_id);

drop trigger if exists set_updated_at on public.agency_members;
create trigger set_updated_at before update on public.agency_members
  for each row execute function public.set_updated_at();

-- ── agent_applications ──────────────────────────────────────────────────────
create table if not exists public.agent_applications (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.users (id) on delete cascade,
  application_type     agent_application_type not null,
  agency_id            uuid references public.agencies (id) on delete set null,
  invitation_token_id  uuid references public.agency_invitation_tokens (id) on delete set null,
  status               agent_application_status not null default 'pending',
  rejection_reason     text,
  reviewed_by_admin_id uuid references public.users (id) on delete set null,
  reviewed_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint agent_app_agency_required check (
    application_type = 'independent'
    or (application_type = 'under_agency' and agency_id is not null)
  )
);
comment on table public.agent_applications is
  'Solicitud para volverse agente. Independiente -> aprueba admin. Bajo inmobiliaria con token válido -> automático (Edge Function).';

create unique index if not exists agent_app_one_pending_per_user
  on public.agent_applications (user_id) where status = 'pending';
create index if not exists agent_app_queue_idx
  on public.agent_applications (status, created_at desc);  -- cola de revisión admin
create index if not exists agent_app_agency_idx
  on public.agent_applications (agency_id);

drop trigger if exists set_updated_at on public.agent_applications;
create trigger set_updated_at before update on public.agent_applications
  for each row execute function public.set_updated_at();

-- ── agent_interest_submissions (landing pública "Quiero ser agente") ─────────
create table if not exists public.agent_interest_submissions (
  id          uuid primary key default gen_random_uuid(),
  first_name  text not null,
  last_name   text not null,
  phone       text not null,
  email       citext not null,
  source      agent_interest_source not null default 'landing',
  status      agent_interest_status not null default 'new',
  ip_address  inet,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.agent_interest_submissions is
  'Captación de oferta desde landing. INSERT público (anon) con rate-limit en Edge Function.';

create index if not exists agent_interest_queue_idx
  on public.agent_interest_submissions (status, created_at desc);
create index if not exists agent_interest_email_idx
  on public.agent_interest_submissions (email);

drop trigger if exists set_updated_at on public.agent_interest_submissions;
create trigger set_updated_at before update on public.agent_interest_submissions
  for each row execute function public.set_updated_at();
