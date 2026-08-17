-- Migración 20260816000005 — esquema base del dominio de publicidad (subtarea
-- 169.1, exploración 039 "Tarea B"). 4 enums + 4 tablas 100% nuevos, cero ALTER
-- sobre tablas vivas (riesgo-cero para producción viva, ver CLAUDE.md §0.5).
--
-- ── Alcance ──────────────────────────────────────────────────────────────────
-- ENUMS: ad_creative_status, ad_status (sin 'approved'), ad_cta_type,
--   ad_zone_scope.
-- TABLAS: public.ad_creatives, public.ads, public.ad_zones, public.ad_prices.
-- RLS + grants fail-closed con dientes (patrón 20260809000004): las tablas
--   nuevas en public NO heredan el blanket grant de 0008 -- revoke all +
--   grant explícito por rol/columna.
--
-- ── Decisiones fijadas (test-author, 2026-08-16, ver bitácora de 169.1) ────
-- D1: ad_prices se siembra con 3 filas (los 3 alcances x 30 días), montos
--   "early partner" 1500/4000/12000 MXN. El precio vive EN LA TABLA (PRD
--   §17.2) -- ajustar un monto es un UPDATE, nunca una migración nueva.
-- D2: ad_zones.neighborhood_id es bigint (mx_neighborhoods.id es "generated
--   always as identity"), NO uuid como decía el doc de exploración 039 --
--   corrección del analista verificada contra 20260813000001:49 y las RPCs
--   hermanas de #157. ad_zones.municipality_id es text (cvegeo de 5 dígitos,
--   mx_municipalities.id, 20260727000001:37).
-- D3: cero filas en ad_zones para un ad = inventario NACIONAL, no un estado
--   inválido -- documentado en comment on table para que nadie lo "arregle"
--   en una revisión futura.
-- D4: escritura de ads/ad_zones/ad_prices exclusiva de RPC/EF security
--   definer futura (sin policy de INSERT/UPDATE para authenticated, patrón
--   property_video_slots/property_revisions). ad_creatives SÍ permite INSERT
--   directo de authenticated scoped a su propia organización (precedente
--   property_videos, 20260604000010:291-293).
--
-- Idempotente: create type solo si no existe (bloque DO + pg_type), create
-- table if not exists, drop policy if exists + create policy.
-- Rollback: supabase/migrations/rollbacks/20260816000005_ads_schema.sql

-- ════════════════════════════════════════════════════════════════════════════
-- 1) ENUMS — todos nuevos, el gotcha de ALTER TYPE ADD VALUE no aplica.
-- ════════════════════════════════════════════════════════════════════════════

do $$ begin
  create type public.ad_creative_status as enum ('uploading', 'processing', 'ready', 'failed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.ad_status as enum ('draft', 'pending_review', 'active', 'paused', 'expired', 'rejected');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.ad_cta_type as enum ('external_url', 'whatsapp', 'phone');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.ad_zone_scope as enum ('neighborhood', 'municipality', 'national');
exception when duplicate_object then null;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) public.ad_creatives — el binario del video de un anuncio, por organización.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.ad_creatives (
  id                uuid primary key default gen_random_uuid(),
  agency_id         uuid not null references public.agencies (id) on delete cascade,
  cloudflare_uid    text,
  thumbnail_url     text,
  duration_seconds  integer check (duration_seconds is null or duration_seconds between 6 and 30),
  status            ad_creative_status not null default 'uploading',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.ad_creatives is
  'Video creativo de un anuncio, propiedad de una organización (agency). Calca el '
  'ciclo de vida de property_videos (uploading/processing/ready/failed) y su unicidad '
  'de cloudflare_uid. El feed NUNCA lee esta tabla directo: recibe la URL firmada por '
  'una Edge Function futura.';

create unique index if not exists ad_creatives_cloudflare_uid_key
  on public.ad_creatives (cloudflare_uid) where cloudflare_uid is not null;

drop trigger if exists set_updated_at on public.ad_creatives;
create trigger set_updated_at before update on public.ad_creatives
  for each row execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- 3) public.ads — el anuncio comprado/publicado, referencia un creative.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.ads (
  id                uuid primary key default gen_random_uuid(),
  agency_id         uuid not null references public.agencies (id) on delete cascade,
  creative_id       uuid not null references public.ad_creatives (id) on delete restrict,
  title             text not null,
  cta_type          ad_cta_type not null,
  cta_value         text not null,
  status            ad_status not null default 'draft',
  rejection_reason  text,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  -- Enganche de #84 (Stripe): sin tabla purchases todavía, sin FK activa,
  -- queda NULL toda la beta. Llenar la columna no es migrar datos.
  purchase_id       uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ads_rejection_reason_matches_status
    check ((status = 'rejected') = (rejection_reason is not null))
);

comment on table public.ads is
  'Anuncio publicado/en revisión de una organización, referencia un ad_creatives. '
  'rejection_reason es obligatorio si y solo si status=rejected (constraint '
  'bidireccional). purchase_id es el enganche de #84 (Stripe): NULL toda la beta.';

drop trigger if exists set_updated_at on public.ads;
create trigger set_updated_at before update on public.ads
  for each row execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- 4) public.ad_zones — dónde se muestra un ad. XOR municipio/colonia; cero
--    filas = inventario nacional (invariante 🔒, ver comment on table).
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.ad_zones (
  id                uuid primary key default gen_random_uuid(),
  ad_id             uuid not null references public.ads (id) on delete cascade,
  municipality_id   text references public.mx_municipalities (id) on delete restrict,
  neighborhood_id   bigint references public.mx_neighborhoods (id) on delete restrict,
  created_at        timestamptz not null default now(),
  constraint ad_zones_exactly_one_scope
    check (num_nonnulls(municipality_id, neighborhood_id) = 1)
);

comment on table public.ad_zones is
  'Dónde se muestra un ad: exactamente una de municipality_id/neighborhood_id no '
  'nula por fila (CHECK ad_zones_exactly_one_scope). 🔒 Invariante que parece bug y '
  'no lo es: un ad con CERO filas aquí es inventario NACIONAL (se muestra en '
  'cualquier zona), no un estado inválido -- no "arreglar" agregando un NOT NULL o '
  'un trigger que exija al menos una fila.';

create index if not exists ad_zones_ad_id_idx on public.ad_zones (ad_id);
create index if not exists ad_zones_municipality_id_idx on public.ad_zones (municipality_id) where municipality_id is not null;
create index if not exists ad_zones_neighborhood_id_idx on public.ad_zones (neighborhood_id) where neighborhood_id is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) public.ad_prices — catálogo de precios por alcance (PRD §17.2: el precio
--    vive EN LA TABLA, jamás en código).
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.ad_prices (
  id           uuid primary key default gen_random_uuid(),
  scope        ad_zone_scope not null,
  days         integer not null,
  amount_mxn   numeric not null,
  currency     text not null default 'MXN',
  valid_from   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

comment on table public.ad_prices is
  'Catálogo de precios por alcance (PRD §17.2). El precio vive EN LA TABLA, nunca '
  'hardcodeado en código -- ajustar un monto es un UPDATE administrado, no una '
  'migración nueva. Sembrada con 3 filas (D1, subtarea 169.1): los 3 alcances a '
  '30 días de vigencia estándar, montos "early partner".';

-- D1: siembra idempotente -- solo si la tabla aún no tiene ninguna fila para el
-- alcance dado (permite re-correr la migración sin duplicar ni pisar un UPDATE
-- administrado posterior).
insert into public.ad_prices (scope, days, amount_mxn, currency)
select v.scope, v.days, v.amount_mxn, 'MXN'
from (values
  ('neighborhood'::ad_zone_scope, 30, 1500::numeric),
  ('municipality'::ad_zone_scope, 30, 4000::numeric),
  ('national'::ad_zone_scope,     30, 12000::numeric)
) as v(scope, days, amount_mxn)
where not exists (select 1 from public.ad_prices p where p.scope = v.scope);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) RLS — habilitar en las 4 tablas.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.ad_creatives enable row level security;
alter table public.ads enable row level security;
alter table public.ad_zones enable row level security;
alter table public.ad_prices enable row level security;

-- ── ad_creatives: SELECT scoped a la propia organización + admin; INSERT
--    directo de authenticated scoped a su propia organización (precedente
--    property_videos, 20260604000010:291-293). Sin UPDATE/DELETE para
--    authenticated a propósito (el ciclo de procesamiento lo mueve una EF).
drop policy if exists ad_creatives_select on public.ad_creatives;
create policy ad_creatives_select on public.ad_creatives for select to authenticated
  using (private.agency_role_of(agency_id) is not null or private.is_admin());

drop policy if exists ad_creatives_insert on public.ad_creatives;
create policy ad_creatives_insert on public.ad_creatives for insert to authenticated
  with check (private.agency_role_of(agency_id) is not null or private.is_admin());

-- ── ads: SELECT = miembro de la propia organización (cualquier estado, es su
--    anuncio) OR (status=active AND vigente) para cualquier authenticated (el
--    feed lo necesita cross-org). Sin policy de INSERT/UPDATE: exclusivo de
--    RPC/EF security definer futura.
drop policy if exists ads_select on public.ads;
create policy ads_select on public.ads for select to authenticated
  using (
    private.agency_role_of(agency_id) is not null
    or private.is_admin()
    or (status = 'active' and now() between starts_at and ends_at)
  );

-- ── ad_zones: sin policy de SELECT/INSERT/UPDATE para authenticated a
--    propósito -- el feed consulta zonas vía RPC (security definer, tareas
--    170.x), nunca contra la tabla directo.

-- ── ad_prices: SELECT abierto a cualquier authenticated (catálogo público-
--    para-logueados, PRD §17.2); sin escritura para authenticated.
drop policy if exists ad_prices_select on public.ad_prices;
create policy ad_prices_select on public.ad_prices for select to authenticated
  using (true);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) Grants fail-closed con dientes (patrón 20260809000004): las 4 tablas
--    nuevas NO heredan el blanket grant de 0008 -- revoke all primero, luego
--    grant explícito y mínimo. anon: AUSENCIA TOTAL de grant en las 4 (42501,
--    no "RLS filtra a 0 filas").
-- ════════════════════════════════════════════════════════════════════════════

revoke all on public.ad_creatives from anon, authenticated;
grant select, insert on public.ad_creatives to authenticated;
grant select, insert, update, delete on public.ad_creatives to service_role;

revoke all on public.ads from anon, authenticated;
grant select on public.ads to authenticated;
grant select, insert, update, delete on public.ads to service_role;

revoke all on public.ad_zones from anon, authenticated;
grant select, insert, update, delete on public.ad_zones to service_role;

revoke all on public.ad_prices from anon, authenticated;
grant select on public.ad_prices to authenticated;
grant select, insert, update, delete on public.ad_prices to service_role;
