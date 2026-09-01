-- Rollback de 20260902200001_search_places_v2.sql (tarea #159)
--
-- Restaura public.search_places(text, integer) EXACTAMENTE como la dejó
-- 20260813000002_place_search_rpcs.sql y elimina la firma de 4 argumentos.
-- El orden importa y por eso el drop va primero: si convivieran las dos, la
-- llamada de dos argumentos de los builds instalados (PostgREST resuelve por
-- nombre de parámetro) sería ambigua y Postgres tiraría 42725.
--
-- ⚠️ Revertir REINTRODUCE los defectos de #163: '%%' vuelve a matchear el
-- catálogo entero en un keystroke y los extents se recalculan para cada fila
-- candidata. Solo tiene sentido como paso de emergencia.
--
-- Ejecutar con:
--   docker exec -i supabase_db_urbea-app psql -U postgres -v ON_ERROR_STOP=1 -q \
--     < supabase/migrations/rollbacks/20260902200001_search_places_v2.sql

drop function if exists public.search_places(text, integer, double precision, double precision);

create or replace function public.search_places(
  p_query text,
  p_limit integer default 10
)
returns table (
  kind    text,
  id      text,
  name    text,
  context text,
  min_lat double precision,
  min_lng double precision,
  max_lat double precision,
  max_lng double precision
)
language plpgsql
security definer
set search_path = public, extensions, private
as $$
declare
  v_q     text;
  v_limit integer;
begin
  v_q := private.normalize_search_text(trim(p_query));
  if v_q is null or length(v_q) < 2 then
    return;
  end if;
  v_limit := least(greatest(coalesce(p_limit, 10), 1), 20);

  return query
  select t.kind, t.id, t.name, t.context, t.min_lat, t.min_lng, t.max_lat, t.max_lng
  from (
    select
      'municipality'::text as kind,
      m.id::text           as id,
      m.name               as name,
      s.name               as context,
      m.bbox_min_lat       as min_lat,
      m.bbox_min_lng       as min_lng,
      m.bbox_max_lat       as max_lat,
      m.bbox_max_lng       as max_lng,
      (m.name_normalized like v_q || '%')          as is_prefix,
      extensions.similarity(m.name_normalized, v_q) as sim
    from public.mx_municipalities m
    join public.mx_states s on s.id = m.state_id
    where m.name_normalized like v_q || '%'
       or m.name_normalized % v_q
    union all
    select
      'neighborhood'::text,
      n.id::text,
      n.name,
      m.name || ', ' || s.abbr,
      extensions.ST_YMin(n.geom::extensions.geometry),
      extensions.ST_XMin(n.geom::extensions.geometry),
      extensions.ST_YMax(n.geom::extensions.geometry),
      extensions.ST_XMax(n.geom::extensions.geometry),
      (n.name_normalized like v_q || '%'),
      extensions.similarity(n.name_normalized, v_q)
    from public.mx_neighborhoods n
    join public.mx_municipalities m on m.id = n.municipality_id
    join public.mx_states s on s.id = m.state_id
    where n.name_normalized like v_q || '%'
       or n.name_normalized % v_q
  ) t
  order by t.is_prefix desc, t.sim desc, (t.kind = 'municipality') desc, t.name asc
  limit v_limit;
end;
$$;

comment on function public.search_places(text, integer) is
  'Autocomplete unificado de lugares: colonias (mx_neighborhoods) + municipios (mx_municipalities), match por prefijo o similitud trgm sobre nombres normalizados. Devuelve kind/id/name/context + bbox (municipio: precalculado, NULL si sin colonias cargadas; colonia: del geom). Llamado por el mapa como authenticated.';

revoke execute on function public.search_places(text, integer) from public, anon;
grant execute on function public.search_places(text, integer) to authenticated;
