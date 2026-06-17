-- Migración 0005 — Propiedades y videos
-- Propósito: la publicación (properties) con dirección exacta obligatoria y pública, ubicación
-- PostGIS, filtros nicho del MVP (pet_friendly / sin aval / estudiantes) como booleanos de primera
-- clase, 6 estados de ciclo + suspended, contadores denormalizados; y los videos (property_videos)
-- que solo referencian Cloudflare Stream (máx 5 por propiedad). Incluye 2 triggers atómicos.

-- ── properties ──────────────────────────────────────────────────────────────
create table if not exists public.properties (
  id                  uuid primary key default gen_random_uuid(),
  owner_user_id       uuid not null references public.users (id) on delete cascade,
  agency_id           uuid references public.agencies (id) on delete set null,  -- denorm al publicar
  property_type       property_type not null,
  operation_type      operation_type not null,
  address             text not null,                       -- dirección exacta: pública y obligatoria
  location            geography(Point, 4326) not null,
  state               text,
  city                text,
  zone                text,                                -- colonia
  price               numeric not null check (price >= 0),
  price_visible       boolean not null default true,
  bedrooms            int check (bedrooms is null or bedrooms >= 0),
  bathrooms           int check (bathrooms is null or bathrooms >= 0),
  square_meters       numeric check (square_meters is null or square_meters >= 0),
  description         text,
  pet_friendly        boolean not null default false,
  allows_no_guarantor boolean not null default false,      -- "sin aval"
  student_friendly    boolean not null default false,
  amenities           jsonb not null default '[]'::jsonb,  -- ['parking','furnished','pool',...]
  social_links        jsonb not null default '{}'::jsonb,
  status              property_status not null default 'draft',
  closed_reason       property_closed_reason,
  slug                text,
  like_count          int not null default 0 check (like_count >= 0),
  save_count          int not null default 0 check (save_count >= 0),
  view_count          int not null default 0 check (view_count >= 0),
  contact_count       int not null default 0 check (contact_count >= 0),
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  constraint property_closed_requires_reason check (status <> 'closed' or closed_reason is not null)
);
comment on table public.properties is
  'Publicación inmobiliaria. Contadores *_count son denormalizados, actualizados en write-time por Edge Functions (no por trigger). Video referenciado en property_videos.';

-- Índices (lineamientos §32.3)
create index if not exists properties_location_gix
  on public.properties using gist (location);                                  -- mapa/feed por radio
create index if not exists properties_feed_idx
  on public.properties (status, created_at desc) where deleted_at is null;     -- feed
create index if not exists properties_owner_idx
  on public.properties (owner_user_id, created_at desc);                       -- "Mis publicaciones"
create index if not exists properties_agency_idx
  on public.properties (agency_id) where deleted_at is null;                   -- publicaciones de inmobiliaria
create index if not exists properties_address_trgm_idx
  on public.properties using gin (address gin_trgm_ops);                       -- búsqueda de texto
create unique index if not exists properties_slug_unique_active
  on public.properties (slug) where deleted_at is null;
-- Índices parciales para filtros nicho (solo publicaciones activas y vivas)
create index if not exists properties_pet_friendly_idx
  on public.properties (status) where deleted_at is null and pet_friendly is true;
create index if not exists properties_no_guarantor_idx
  on public.properties (status) where deleted_at is null and allows_no_guarantor is true;
create index if not exists properties_student_idx
  on public.properties (status) where deleted_at is null and student_friendly is true;

drop trigger if exists set_updated_at on public.properties;
create trigger set_updated_at before update on public.properties
  for each row execute function public.set_updated_at();

-- ── property_videos ─────────────────────────────────────────────────────────
create table if not exists public.property_videos (
  id               uuid primary key default gen_random_uuid(),
  property_id      uuid not null references public.properties (id) on delete cascade,
  cloudflare_uid   text,                                   -- referencia a Cloudflare Stream
  playback_url     text,
  thumbnail_url    text,
  status           property_video_status not null default 'uploading',
  duration_seconds int check (duration_seconds is null or duration_seconds >= 0),
  size_bytes       bigint check (size_bytes is null or size_bytes >= 0),
  position         int not null check (position between 1 and 5),
  failure_reason   text,
  ready_at         timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
comment on table public.property_videos is
  'Videos de la propiedad (máx 5). El binario vive en Cloudflare Stream; aquí solo la referencia.';

create unique index if not exists property_videos_position_unique
  on public.property_videos (property_id, position) where deleted_at is null;
create unique index if not exists property_videos_cf_uid_unique
  on public.property_videos (cloudflare_uid) where cloudflare_uid is not null;
create index if not exists property_videos_property_idx
  on public.property_videos (property_id, status) where deleted_at is null;

drop trigger if exists set_updated_at on public.property_videos;
create trigger set_updated_at before update on public.property_videos
  for each row execute function public.set_updated_at();

-- ── Trigger atómico: máximo 5 videos por propiedad ──────────────────────────
-- Validación estructural simple (lineamientos §9.1). FOR UPDATE sobre la property padre
-- serializa inserciones concurrentes de la misma propiedad y evita la carrera del conteo.
create or replace function public.enforce_max_videos_per_property()
returns trigger
language plpgsql
as $$
declare
  v_count int;
begin
  perform 1 from public.properties where id = new.property_id for update;
  select count(*) into v_count
    from public.property_videos
    where property_id = new.property_id and deleted_at is null;
  if v_count >= 5 then
    raise exception 'max_videos_per_property_exceeded: una propiedad admite máximo 5 videos'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.enforce_max_videos_per_property() is
  'BEFORE INSERT en property_videos: rechaza el 6º video no borrado. Atómico (lineamientos §9.1).';

drop trigger if exists enforce_max_videos on public.property_videos;
create trigger enforce_max_videos before insert on public.property_videos
  for each row execute function public.enforce_max_videos_per_property();

-- ── Trigger atómico: cascada soft-delete propiedad -> videos (un solo salto) ─
create or replace function public.cascade_soft_delete_property_videos()
returns trigger
language plpgsql
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update public.property_videos
      set deleted_at = new.deleted_at
      where property_id = new.id and deleted_at is null;
  end if;
  return new;
end;
$$;
comment on function public.cascade_soft_delete_property_videos() is
  'AFTER UPDATE de deleted_at en properties: propaga el soft-delete a sus videos. Un solo salto, sin encadenar (lineamientos §9.1).';

drop trigger if exists cascade_soft_delete_videos on public.properties;
create trigger cascade_soft_delete_videos
  after update of deleted_at on public.properties
  for each row
  when (old.deleted_at is distinct from new.deleted_at)
  execute function public.cascade_soft_delete_property_videos();
