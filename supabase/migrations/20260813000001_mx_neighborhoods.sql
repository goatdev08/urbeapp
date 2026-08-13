-- Migración 0065 — Catálogo de colonias con geometría (mx_neighborhoods)
-- Tarea #157.1 (búsqueda en mapa: autocomplete + perímetro + filtro espacial).
-- Aditiva e idempotente. Rollback: rollbacks/20260813000001_mx_neighborhoods.sql
-- Tests: supabase/tests/42_mx_neighborhoods_test.sql
--
-- Propósito: base del "buscar colonia estilo Google Maps" (plan aprobado 2026-08-13).
--   El teléfono manda texto -> search_places (migración siguiente) sugiere colonias y
--   municipios; al seleccionar colonia, el cliente baja SU polígono y el backend filtra
--   propiedades con ST_Intersects. Patrón industria (Zillow/Redfin): los polígonos viven
--   en base propia porque Google no los expone por API y el filtrado exige join espacial
--   con properties.location.
--
-- Datos: esta migración crea SOLO el schema. El dataset (~74k colonias nacionales,
--   INE/datos.gob.mx) entra por script de import aparte (supabase/scripts/
--   import-neighborhoods.sh, psql \copy + upsert por source_key) — 74k filas con
--   geometría no caben en una migración y el import debe ser reanudable por estados.
--
-- Decisiones (plan #157):
--   D1: geom es geography (no geometry) — properties.location ya es geography con GiST
--       (properties_location_gix); ST_Intersects(geography, geography) usa ese índice
--       sin casts ni índices funcionales nuevos.
--   D2: sin unaccent (20260727000002 ya la evitó por el wrapper IMMUTABLE). La
--       normalización de acentos es private.normalize_search_text (lower+translate del
--       set español) — mismo contrato práctico que el NFD-strip client-side de
--       mobile/src/features/search/lib/zones.ts (filter_zones).
--   D4: bbox municipal PREcalculado en 4 columnas de mx_municipalities (las llena el
--       import con ST_Extent de sus colonias). NULL = municipio sin colonias cargadas.
--       Calcular el extent agregado en cada keystroke del autocomplete sería caro.

-- ── Normalización para búsqueda (sin unaccent) ──────────────────────────────
-- IMMUTABLE es requisito doble: columna GENERADA + índice. translate/lower son de
-- pg_catalog (visibles con search_path vacío — cumple el advisor function_search_path).
-- STRICT: NULL -> NULL, no revienta la columna generada.
create or replace function private.normalize_search_text(p_text text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select lower(translate(p_text, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
$$;

comment on function private.normalize_search_text(text) is
  'Normaliza texto para búsqueda: minúsculas + acentos españoles removidos (á->a, ñ->n, ü->u). Sin unaccent a propósito (decisión 20260727000002). Usada por columnas generadas name_normalized y por search_places.';

-- ── Tabla de colonias ───────────────────────────────────────────────────────
create table if not exists public.mx_neighborhoods (
  id              bigint generated always as identity primary key,
  -- Clave estable del dataset fuente (o hash cvegeo|nombre|cp calculado por el script
  -- de import si la fuente no trae id). Ancla del ON CONFLICT del upsert idempotente.
  source_key      text not null unique,
  municipality_id text not null references public.mx_municipalities (id) on delete restrict,
  name            text not null,
  name_normalized text generated always as (private.normalize_search_text(name)) stored,
  postal_code     text,
  geom            extensions.geography(MultiPolygon, 4326) not null,
  created_at      timestamptz not null default now()
);

comment on table public.mx_neighborhoods is
  'Catálogo de colonias con polígono (dataset abierto nacional, import por script). Alimenta el autocomplete del mapa (search_places), el perímetro dibujado (get_neighborhood_geojson) y el filtro espacial (properties_within_neighborhood).';

-- ── Índices ─────────────────────────────────────────────────────────────────
-- GiST(geom): ST_Intersects contra properties.location (filtro espacial).
create index if not exists mx_neighborhoods_geom_gix
  on public.mx_neighborhoods using gist (geom);
-- GIN trgm: autocomplete (LIKE 'prefijo%' y similitud % — ambos usan gin_trgm_ops).
create index if not exists mx_neighborhoods_name_trgm_idx
  on public.mx_neighborhoods using gin (name_normalized extensions.gin_trgm_ops);
-- btree: joins/agrupaciones por municipio (bbox del import, context del autocomplete).
create index if not exists mx_neighborhoods_muni_idx
  on public.mx_neighborhoods (municipality_id);

-- ── mx_municipalities: columnas aditivas para el autocomplete unificado ─────
-- name_normalized generada (mismo mecanismo que la tabla nueva) + bbox precalculado (D4).
alter table public.mx_municipalities
  add column if not exists name_normalized text
    generated always as (private.normalize_search_text(name)) stored,
  add column if not exists bbox_min_lat double precision,
  add column if not exists bbox_min_lng double precision,
  add column if not exists bbox_max_lat double precision,
  add column if not exists bbox_max_lng double precision;

comment on column public.mx_municipalities.bbox_min_lat is
  'Bbox precalculado por el import de colonias (ST_Extent de sus colonias). NULL = municipio sin colonias cargadas: la sugerencia del autocomplete solo completa texto, sin encuadre.';

create index if not exists mx_municipalities_name_trgm_idx
  on public.mx_municipalities using gin (name_normalized extensions.gin_trgm_ops);

-- ── RLS: lectura pública; escritura SOLO service_role (patrón 20260727000001) ──
-- Sin política de escritura a propósito: RLS habilitada + cero policies de INSERT/
-- UPDATE/DELETE = denegado por defecto. El ciclo de vida del catálogo es "se
-- re-importa por script", no "se edita desde la app".
alter table public.mx_neighborhoods enable row level security;

drop policy if exists mx_neighborhoods_select on public.mx_neighborhoods;
create policy mx_neighborhoods_select on public.mx_neighborhoods for select to anon, authenticated
  using (true);

grant select on public.mx_neighborhoods to anon, authenticated;
grant select, insert, update, delete on public.mx_neighborhoods to service_role;

-- 🔒 TRUNCATE no lo filtra la RLS y pg_default_acl lo regala a anon/authenticated en
-- toda tabla nueva de public (mismo agujero sellado en 72.1 para mx_states/municipios).
revoke truncate on public.mx_neighborhoods from anon, authenticated;
