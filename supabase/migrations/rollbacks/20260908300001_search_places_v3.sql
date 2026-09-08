-- Rollback de 20260908300001_search_places_v3.sql (tarea #282.1)
--
-- Restaura public.search_places(text, integer, double precision, double
-- precision) EXACTAMENTE como la dejó 20260902200001_search_places_v2.sql:
-- mismo cuerpo, mismo comment, mismos grants. Misma firma que la v3 (no hace
-- falta drop): `create or replace` reemplaza el cuerpo en la MISMA
-- transacción de este rollback — no hay ventana sin función.
--
-- ⚠️ Revertir REINTRODUCE el síntoma de la exploración 046: la cercanía
-- vuelve a desempatar solo similitudes empatadas en vez de mandar por
-- tramos, y "provi" desde Guadalajara vuelve a enterrar a Providencia bajo
-- homónimas lejanas con mayor similitud. Solo tiene sentido como paso de
-- emergencia.
--
-- Ejecutar con:
--   docker exec -i supabase_db_urbea-app psql -U postgres -v ON_ERROR_STOP=1 -q \
--     < supabase/migrations/rollbacks/20260908300001_search_places_v3.sql

create or replace function public.search_places(
  p_query text,
  p_limit integer default 10,
  p_lat   double precision default null,
  p_lng   double precision default null
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
  v_like  text;
  v_limit integer;
  v_point extensions.geometry;
begin
  v_q := private.normalize_search_text(trim(p_query));
  -- Guard: menos de 2 caracteres útiles no dispara ningún scan (cada keystroke
  -- del autocomplete llega aquí; 1 char matchearía media tabla).
  if v_q is null or length(v_q) < 2 then
    return;
  end if;
  v_limit := least(greatest(coalesce(p_limit, 10), 1), 20);

  -- (a) Patrón de prefijo con los metacaracteres de LIKE neutralizados. El
  -- backslash va PRIMERO o se re-escaparían los escapes recién puestos.
  -- Solo afecta al LIKE: el operador % de pg_trgm trata estos caracteres como
  -- separadores de palabra, así que la rama difusa sigue igual de tolerante.
  v_like := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- (c) Sesgo geográfico opcional. Fuera del rango válido (o con un solo
  -- componente) se ignora en silencio: el autocomplete nunca debe fallar por
  -- un GPS raro — degrada al orden sin sesgo, que es el comportamiento v1.
  -- GOTCHA de orden: X = lng, Y = lat (igual que parse_location).
  if p_lat is not null and p_lng is not null
     and p_lat between -90 and 90 and p_lng between -180 and 180 then
    v_point := extensions.ST_SetSRID(extensions.ST_Point(p_lng, p_lat), 4326);
  end if;

  return query
  -- (b) `ranked` toca UNA tabla por rama: nada de joins ni de extents aquí.
  with ranked as (
    select
      'municipality'::text as kind,
      m.id                 as muni_id,
      null::bigint         as nbhd_id,
      m.name               as name,
      (m.name_normalized like v_like escape '\')    as is_prefix,
      extensions.similarity(m.name_normalized, v_q) as sim,
      -- Proximidad como PROXY, no como distancia real: rectángulo envolvente
      -- contra el punto, en grados planos. Solo tiene que ordenar, y así el
      -- costo es el mismo para colonias y municipios (ambos vía bbox, que
      -- PostGIS ya trae cacheado en la cabecera del geom).
      extensions.ST_Distance(
        extensions.ST_MakeEnvelope(m.bbox_min_lng, m.bbox_min_lat,
                                   m.bbox_max_lng, m.bbox_max_lat, 4326),
        v_point)                                    as dist
    from public.mx_municipalities m
    where m.name_normalized like v_like escape '\'
       or m.name_normalized % v_q
    union all
    select
      'neighborhood'::text,
      null::text,
      n.id,
      n.name,
      (n.name_normalized like v_like escape '\'),
      extensions.similarity(n.name_normalized, v_q),
      extensions.ST_Distance(
        extensions.ST_Envelope(n.geom::extensions.geometry), v_point)
    from public.mx_neighborhoods n
    where n.name_normalized like v_like escape '\'
       or n.name_normalized % v_q
  ),
  top_candidates as (
    -- 🔒 `dist asc nulls last` es un NO-OP cuando no vienen coordenadas: todas
    -- las filas quedan con dist NULL y el desempate cae en las mismas claves
    -- que la v1. Ésa es la garantía de que el contrato viejo devuelve lo mismo.
    -- Y va DESPUÉS de sim: la cercanía desempata, no adelanta a una candidata
    -- que se parece más a lo que la persona escribió.
    select r.*, row_number() over (
      order by r.is_prefix desc, r.sim desc, r.dist asc nulls last,
               (r.kind = 'municipality') desc, r.name asc
    ) as rn
    from ranked r
    order by rn
    limit v_limit
  )
  select
    t.kind,
    coalesce(t.muni_id, t.nbhd_id::text),
    t.name,
    case when t.kind = 'municipality' then s.name
         else m.name || ', ' || s.abbr end,
    case when t.kind = 'municipality' then m.bbox_min_lat
         else extensions.ST_YMin(n.geom::extensions.geometry) end,
    case when t.kind = 'municipality' then m.bbox_min_lng
         else extensions.ST_XMin(n.geom::extensions.geometry) end,
    case when t.kind = 'municipality' then m.bbox_max_lat
         else extensions.ST_YMax(n.geom::extensions.geometry) end,
    case when t.kind = 'municipality' then m.bbox_max_lng
         else extensions.ST_XMax(n.geom::extensions.geometry) end
  from top_candidates t
  left join public.mx_neighborhoods  n on n.id = t.nbhd_id
  left join public.mx_municipalities m on m.id = coalesce(t.muni_id, n.municipality_id)
  left join public.mx_states         s on s.id = m.state_id
  order by t.rn;
end;
$$;

comment on function public.search_places(text, integer, double precision, double precision) is
  'Autocomplete unificado de lugares: colonias (mx_neighborhoods) + municipios '
  '(mx_municipalities), match por prefijo o similitud trgm sobre nombres '
  'normalizados. Devuelve kind/id/name/context + bbox (municipio: precalculado, '
  'NULL si sin colonias cargadas; colonia: del geom). #159/#163 (v2): los '
  'metacaracteres de LIKE se escapan; el context y los extents se resuelven '
  'DESPUÉS del LIMIT; p_lat/p_lng son OPCIONALES y solo desempatan candidatas '
  'de igual similitud por cercanía (sin ellas el orden es idéntico al de la v1). '
  'Llamado por el mapa como authenticated.';

revoke execute on function public.search_places(text, integer, double precision, double precision) from public, anon;
grant execute on function public.search_places(text, integer, double precision, double precision) to authenticated;
