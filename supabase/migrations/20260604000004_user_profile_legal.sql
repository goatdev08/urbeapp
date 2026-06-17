-- Migración 0004 — Perfil de usuario y cumplimiento legal
-- Propósito: onboarding del buscador (user_preferences), versionado de documentos legales
-- (terms_versions), consentimientos inmutables (user_consents) y solicitudes de eliminación
-- de cuenta con ventana de gracia (account_deletion_requests, requisito de tiendas + LFPDPPP básico).

-- ── user_preferences (onboarding del buscador, 1:1 con users) ────────────────
create table if not exists public.user_preferences (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null unique references public.users (id) on delete cascade,
  location                geography(Point, 4326),
  location_radius_km      numeric not null default 5
                            check (location_radius_km > 0 and location_radius_km <= 100),
  search_operation_type   operation_type,
  search_property_types   property_type[] not null default '{}',
  budget_min              numeric check (budget_min is null or budget_min >= 0),
  budget_max              numeric check (budget_max is null or budget_max >= 0),
  bedrooms_min            int check (bedrooms_min is null or bedrooms_min >= 0),
  bathrooms_min           int check (bathrooms_min is null or bathrooms_min >= 0),
  onboarding_completed_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint prefs_budget_range check (
    budget_max is null or budget_min is null or budget_max >= budget_min
  )
);
comment on table public.user_preferences is 'Onboarding del buscador: ubicación + operación + presupuesto + filtros.';

create index if not exists user_preferences_location_idx
  on public.user_preferences using gist (location);

drop trigger if exists set_updated_at on public.user_preferences;
create trigger set_updated_at before update on public.user_preferences
  for each row execute function public.set_updated_at();

-- ── terms_versions (documentos legales versionados) ─────────────────────────
create table if not exists public.terms_versions (
  id             uuid primary key default gen_random_uuid(),
  doc_type       doc_type not null,
  version        text not null,
  content        text not null,
  is_current     boolean not null default false,
  effective_from timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
comment on table public.terms_versions is 'Versiones de Términos y Aviso de Privacidad.';

create unique index if not exists terms_versions_doctype_version_unique
  on public.terms_versions (doc_type, version);
-- A lo más una versión vigente por tipo de documento (garantía atómica).
create unique index if not exists terms_versions_one_current_per_doctype
  on public.terms_versions (doc_type) where is_current is true;

-- ── user_consents (inmutable: sin UPDATE/DELETE vía RLS) ────────────────────
create table if not exists public.user_consents (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users (id) on delete cascade,
  consent_type     consent_type not null,
  terms_version_id uuid references public.terms_versions (id) on delete restrict,
  accepted_at      timestamptz not null default now(),
  ip_address       inet,
  created_at       timestamptz not null default now(),
  constraint consent_version_presence check (
    (consent_type in ('terms', 'privacy') and terms_version_id is not null)
    or (consent_type in ('age', 'whatsapp') and terms_version_id is null)
  )
);
comment on table public.user_consents is 'Registro de consentimientos (auditoría LFPDPPP). Inmutable.';

create index if not exists user_consents_user_idx
  on public.user_consents (user_id, consent_type, accepted_at desc);
create index if not exists user_consents_version_idx
  on public.user_consents (terms_version_id);

-- ── account_deletion_requests (eliminación con gracia de 15 días) ───────────
create table if not exists public.account_deletion_requests (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users (id) on delete cascade,
  reason             deletion_request_reason not null,
  reason_text        text,
  status             deletion_request_status not null default 'pending',
  grace_period_until timestamptz not null,
  requested_at       timestamptz not null default now(),
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.account_deletion_requests is
  'Solicitud de baja de cuenta. grace_period_until = requested_at + 15 días (set en Edge Function).';

-- Máximo una solicitud abierta por usuario.
create unique index if not exists deletion_req_one_open_per_user
  on public.account_deletion_requests (user_id) where status in ('pending', 'confirmed');
create index if not exists deletion_req_purge_idx
  on public.account_deletion_requests (status, grace_period_until);  -- cron de purga

drop trigger if exists set_updated_at on public.account_deletion_requests;
create trigger set_updated_at before update on public.account_deletion_requests
  for each row execute function public.set_updated_at();
