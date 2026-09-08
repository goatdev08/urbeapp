-- Migración 20260908300001 — search_places v3 (tarea #282.1, exploración 046 §E)
--
-- QUÉ CAMBIA Y POR QUÉ. La v2 (#159) usa las coordenadas SOLO para desempatar
-- similitudes empatadas (`dist asc` va DESPUÉS de `sim desc`). Con datos
-- reales del 2026-09-08 (exploración 046) esto falla: buscar "provi" desde
-- Guadalajara pone a Providencia (Guadalajara) — la colonia obvia, a un par
-- de km — en el lugar 9, porque Providima y otras homónimas/parecidas con
-- mayor similitud pero mucho más lejos ganan el desempate incondicional de
-- `sim desc`. Prefijo/similitud sin sesgo de cercanía deja pasar homónimas
-- lejanas y nombres cortos que rankean alto por trigramas pero no tienen
-- nada que ver con dónde está la persona.
--
-- v3: la cercanía pasa a mandar por TRAMOS (bucket), no solo a desempatar.
-- `bucket = floor(dist / 0.05)` (0.05° ≈ 5 km en Jalisco; dist = el mismo
-- ST_Distance contra el envelope que ya calculaba la v2) va PRIMERO en el
-- order by; dentro del mismo tramo de 5 km, prefijo/similitud siguen
-- mandando exactamente como en la v2. Con esto "provi" desde GDL trae
-- Providencia y sus variantes cercanas (mismo bucket 0) antes que cualquier
-- homónima a >5 km, sin dejar de preferir el prefijo/similitud dentro de esa
-- vecindad.
--
-- 🔴 TRADE-OFF DEL TAMAÑO DEL BUCKET (disparadores (a) contrato publicado y
-- (c) techo con datos reales, exploración 046 §E) — se explica completo aquí
-- porque el ORDER BY es precisamente lo que cambia de contrato observable:
--   - Un bucket MÁS FINO (p.ej. 0.01° ≈ 1 km) vuelve a esconder la colonia
--     base bajo sus propias secciones/variantes si quedan a 1.5-2 km entre
--     sí (regresa el síntoma original, solo que con un radio menor).
--   - Un bucket MÁS GRUESO (p.ej. 0.2° ≈ 20 km) mete de vuelta a homónimas
--     de todo el área metropolitana en el mismo tramo que la base, y ahí
--     sim/prefijo vuelven a decidir sin sesgo real de cercanía — degrada a
--     la v2 dentro del radio metropolitano completo.
--   - 0.05° (~5 km) es el techo alcanzable con el catálogo real: separa la
--     colonia + sus secciones inmediatas (mismo bucket 0, ~2-4 km entre sí
--     en el caso real de Providencia) de homónimas de otro municipio/estado
--     (bucket >=2), sin requerir distancia geodésica real (ST_Distance ya
--     usa el envelope en grados, igual que la v2 — cambiar a metros exigiría
--     ST_DistanceSphere/geography y tocar el plan de índices, fuera de
--     alcance de esta subtarea).
--
-- SIN COORDENADAS (p_lat/p_lng NULL): dist es NULL para TODAS las filas ->
-- bucket NULL para todas -> `nulls last` es un NO-OP y el orden queda
-- IDÉNTICO al de la v2. Ésa es la garantía de contrato del test 80 (§0.5.2):
-- ningún build instalado que llame sin coordenadas ve un cambio de orden.
--
-- 🔴 GATE §0.5 — POR QUÉ ESTO NO ROMPE EL CONTRATO PUBLICADO. Misma firma
-- (text, integer, double precision, double precision), mismo RETURNS TABLE,
-- mismo guard/clamp/escape, mismos grants. `create or replace` reemplaza el
-- cuerpo en la MISMA transacción de esta migración: no hay ventana en la que
-- la función no exista. No hace falta `drop function`: la firma no cambia,
-- solo el ORDER BY interno de `top_candidates`. Los builds instalados llaman
-- {p_query, p_limit} o {p_query, p_limit, p_lat, p_lng}; ambas formas siguen
-- resolviendo exactamente igual (PostgREST por nombre de parámetro).
--
-- Aditiva en datos (no toca tablas, columnas ni filas), idempotente
-- (`create or replace` + revoke/grant repetibles).
-- Rollback: rollbacks/20260908300001_search_places_v3.sql (restaura la v2).
-- Tests: supabase/tests/111_search_places_v3_test.sql (+ 80 y 43 sin tocar).

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

  -- Patrón de prefijo con los metacaracteres de LIKE neutralizados. El
  -- backslash va PRIMERO o se re-escaparían los escapes recién puestos.
  -- Solo afecta al LIKE: el operador % de pg_trgm trata estos caracteres como
  -- separadores de palabra, así que la rama difusa sigue igual de tolerante.
  v_like := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- Sesgo geográfico opcional. Fuera del rango válido (o con un solo
  -- componente) se ignora en silencio: el autocomplete nunca debe fallar por
  -- un GPS raro — degrada al orden sin sesgo, que es el comportamiento v2/v1.
  -- GOTCHA de orden: X = lng, Y = lat (igual que parse_location).
  if p_lat is not null and p_lng is not null
     and p_lat between -90 and 90 and p_lng between -180 and 180 then
    v_point := extensions.ST_SetSRID(extensions.ST_Point(p_lng, p_lat), 4326);
  end if;

  return query
  -- `ranked` toca UNA tabla por rama: nada de joins ni de extents aquí.
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
    -- 🔒 v3: `floor(dist / 0.05) asc nulls last` va PRIMERO — la cercanía por
    -- tramos de ~5 km manda sobre prefijo/similitud. Sin coordenadas, dist es
    -- NULL para TODAS las filas -> bucket NULL para todas -> `nulls last` es
    -- un NO-OP y el orden cae exactamente en las mismas claves que la v2. Ésa
    -- es la garantía de que el contrato sin coords no cambia (test 80/§0.5.2).
    select r.*, row_number() over (
      order by floor(r.dist / 0.05) asc nulls last,
               r.is_prefix desc, r.sim desc,
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
  'NULL si sin colonias cargadas; colonia: del geom). v3 (#282.1): con '
  'coordenadas, la cercanía por bucket de ~5 km (floor(dist/0.05)) MANDA sobre '
  'prefijo/similitud; dentro del mismo bucket, is_prefix/similarity siguen '
  'igual que en la v2. Sin coordenadas el orden es idéntico a la v2 (bucket '
  'NULL para todas). Llamado por el mapa como authenticated.';

revoke execute on function public.search_places(text, integer, double precision, double precision) from public, anon;
grant execute on function public.search_places(text, integer, double precision, double precision) to authenticated;
