-- Migración 20260903200001 — private.municipality_at_point (tarea #235,
-- hardening de 232.1)
--
-- ════════════════════════════════════════════════════════════════════════════
-- POR QUÉ
--
-- #194 fijó el criterio del fallback municipal por bbox —cuando el punto no
-- cae en ningún polígono del DCAH, gana el municipio cuyo bbox precalculado lo
-- contiene con MENOR ÁREA, desempatando por id— y lo escribió "palabra por
-- palabra" en DOS funciones. 232.1 agregó la tercera. Hoy la misma regla de
-- negocio vive triplicada en:
--
--   · public.ads_for_zone    — dónde se SIRVE el anuncio.
--   · public.resolve_ad_zone — dónde se CONTABILIZA la impresión FACTURABLE.
--   · public.place_at_point  — a qué zona de catálogo resuelve una dirección
--                              geocodificada (buscador unificado de #232).
--
-- #194 ya documentó el costo de divergir: el anuncio se sirve en un municipio
-- y se cobra en otro, y el rollup de ad_impressions_monthly —la base de cobro—
-- queda mal atribuido. Con dos copias eso dependía de la disciplina de quien
-- editara; con tres, de la suerte. La regla se extrae a un helper y las tres
-- delegan, así que ya no PUEDEN divergir.
--
-- ── Qué cambia y qué NO ─────────────────────────────────────────────────────
-- SOLO cambia el CUERPO de las tres funciones. Firmas, `returns table`
-- (columnas, orden y tipos), volatilidad, SECURITY DEFINER, search_path,
-- grants y comments quedan BYTE POR BYTE como estaban: son contratos vivos en
-- producción y a ads_for_zone la llaman builds instalados (§0.5). Los asserts
-- EC-20..EC-22 y EC-29/EC-30 de 86_municipality_at_point_test.sql lo fijan.
--
-- ⚠️ La única diferencia de FORMA en place_at_point: antes filtraba por bbox +
-- `order by` + `limit 1` sobre el join con mx_states; ahora filtra por
-- `m.id = private.municipality_at_point(...)`. Es equivalente porque
-- mx_municipalities.state_id es NOT NULL con FK a mx_states (ON DELETE
-- RESTRICT): el inner join no puede descartar ningún candidato, así que el
-- ganador del `order by` es el mismo antes y después. Y `m.id` es la PK, así
-- que sigue devolviendo 0 o 1 fila sin necesitar `limit`.
--
-- Aditiva: crea una función en `private` y reemplaza tres cuerpos. No toca
-- tablas, columnas, filas, tipos ni grants. Idempotente: create or replace +
-- revoke repetibles. No requiere OTA ni redeploy de Edge Functions (el
-- contrato que consumen no se mueve).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) El helper ────────────────────────────────────────────────────────────
-- SECURITY DEFINER + STABLE + search_path fijado: el patrón de los helpers de
-- `private` (0008/0010, private.is_admin). STABLE y no VOLATILE porque solo
-- lee: si fuera volátil el planner perdería la posibilidad de evaluarlo una
-- sola vez por consulta en place_at_point.
create or replace function private.municipality_at_point(
  p_lat double precision,
  p_lng double precision
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  -- 🔴 #194 — CRITERIO ÚNICO del fallback municipal por bbox. Los bboxes son
  -- rectángulos sobre formas irregulares, así que los de municipios vecinos
  -- SIEMPRE se solapan: sin `order by`, un punto en el traslape resolvía a uno
  -- cualquiera según el orden físico de las filas. Gana el de MENOR ÁREA (un
  -- municipio pequeño anidado en el bbox de uno grande es la respuesta
  -- correcta, y es la mejor aproximación disponible: mx_municipalities NO
  -- tiene columna de polígono, solo bbox_min/max_*). Desempate por id para que
  -- dos áreas idénticas también sean deterministas.
  --
  -- `between` deja fuera NULL, NaN e Infinity: una coordenada imposible no
  -- está en ningún bbox y el resultado es NULL. 🔒 NUNCA inventa un municipio.
  select m.id
  from public.mx_municipalities m
  where p_lat between m.bbox_min_lat and m.bbox_max_lat
    and p_lng between m.bbox_min_lng and m.bbox_max_lng
  order by (m.bbox_max_lat - m.bbox_min_lat) * (m.bbox_max_lng - m.bbox_min_lng) asc,
           m.id asc
  limit 1;
$$;

comment on function private.municipality_at_point(double precision, double precision) is
  'Municipio del catálogo INEGI cuyo bbox precalculado contiene el punto: el de '
  'MENOR ÁREA, desempatando por id (criterio de #194). NULL si ningún bbox lo '
  'contiene o si la coordenada es NULL/NaN/fuera de rango — 🔒 nunca fabrica un '
  'municipio. Es el fallback para el hueco de cobertura de polígonos del DCAH '
  '(#157); la colonia, cuando existe, gana antes de llegar aquí. '
  '🔴 CUALQUIER OTRO RESOLUTOR DE MUNICIPIO POR PUNTO DEBE DELEGAR EN ESTA '
  'FUNCIÓN, no re-escribir el order by. #194 documentó el costo de divergir: '
  'ads_for_zone decide dónde se SIRVE el anuncio, resolve_ad_zone dónde se '
  'CONTABILIZA la impresión facturable y place_at_point a qué zona resuelve una '
  'dirección; si discrepan sobre el mismo punto, el anuncio se sirve en un '
  'municipio y se cobra en otro, y ad_impressions_monthly queda mal atribuido. '
  'La copia triplicada que motivó esta extracción es la tarea #235. '
  'NO es un contrato público: EXECUTE revocado a public/anon/authenticated, solo '
  'la invocan las funciones SECURITY DEFINER de public que la envuelven. '
  'Los asserts EC-14..EC-19 de supabase/tests/86_municipality_at_point_test.sql '
  'se ponen ROJOS si alguien vuelve a copiar el order by en vez de delegar.';

revoke execute on function private.municipality_at_point(double precision, double precision)
  from public, anon, authenticated;

-- ── 2) public.ads_for_zone — delega ─────────────────────────────────────────
create or replace function public.ads_for_zone(
  p_lat double precision,
  p_lng double precision,
  p_neighborhood_id bigint default null,
  p_municipality_id text default null
)
returns table (
  id uuid,
  creative_id uuid,
  title text,
  description text,
  cta_type ad_cta_type,
  cta_value text,
  cloudflare_uid text,
  agency_name text,
  agency_logo_url text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_neighborhood_id bigint;
  v_municipality_id text;
  v_point           extensions.geography;
begin
  if p_neighborhood_id is not null then
    -- 1a) Colonia declarada gana sobre el GPS -- resuelve también su
    -- municipio para que el inventario municipal de esa zona se sirva.
    v_neighborhood_id := p_neighborhood_id;
    select n.municipality_id into v_municipality_id
    from public.mx_neighborhoods n
    where n.id = p_neighborhood_id;
  elsif p_municipality_id is not null then
    -- 1b) Municipio declarado gana sobre el GPS -- SIN colonia implícita
    -- (declarar el municipio no implica una colonia específica).
    v_municipality_id := p_municipality_id;
  else
    -- 2) Sin zona activa: resolver por coordenadas. GOTCHA de orden: x=lng,
    -- y=lat (misma convención que properties_within_radius/publish_property_atomic).
    v_point := extensions.ST_SetSRID(extensions.ST_Point(p_lng, p_lat), 4326)::extensions.geography;

    select n.id, n.municipality_id
      into v_neighborhood_id, v_municipality_id
    from public.mx_neighborhoods n
    where extensions.ST_Intersects(n.geom, v_point)
    order by n.id  -- #194: determinista si dos polígonos llegaran a solaparse
    limit 1;

    if v_neighborhood_id is null then
      -- 3) Hueco de cobertura DCAH: fallback por bbox precalculado del
      -- municipio. Solo municipio, sin colonia (no hay colonia resuelta).
      --
      -- #235: el criterio de #194 (menor área, desempate por id) vive en
      -- private.municipality_at_point, no aquí. public.resolve_ad_zone y
      -- public.place_at_point llaman al MISMO helper, así que ya no pueden
      -- divergir: el anuncio se sirve y se cobra en el mismo municipio por
      -- construcción, no por copiar bien el order by.
      v_municipality_id := private.municipality_at_point(p_lat, p_lng);
    end if;
    -- 4) Si tampoco hay bbox: v_neighborhood_id y v_municipality_id quedan
    -- NULL -- el WHERE de abajo sirve únicamente el inventario nacional
    -- (🔒 nunca vacío).
  end if;

  return query
  select
    a.id,
    -- 170.8: el cliente necesita el creative_id para pedirle a mint-ad-urls la
    -- URL firmada de reproducción. Sin esto el anuncio era una tarjeta
    -- estática en un feed de video. NO se expone cloudflare_uid como llave de
    -- firma: ese ya viajaba y no basta — mint-ad-urls autoriza por creativo.
    a.creative_id,
    a.title,
    a.description,
    a.cta_type,
    a.cta_value,
    c.cloudflare_uid,
    ag.name::text,
    ag.logo_url
  from public.ads a
  join public.ad_creatives c on c.id = a.creative_id
  join public.agencies ag on ag.id = a.agency_id
  where a.status = 'active'
    and now() between a.starts_at and a.ends_at
    and c.status = 'ready'
    and (
      -- D3 (169.1): cero filas en ad_zones = inventario nacional.
      not exists (select 1 from public.ad_zones z where z.ad_id = a.id)
      or (
        v_neighborhood_id is not null
        and exists (
          select 1 from public.ad_zones z
          where z.ad_id = a.id and z.neighborhood_id = v_neighborhood_id
        )
      )
      or (
        v_municipality_id is not null
        and exists (
          select 1 from public.ad_zones z
          where z.ad_id = a.id and z.municipality_id = v_municipality_id
        )
      )
    );
end;
$$;

comment on function public.ads_for_zone(double precision, double precision, bigint, text) is
  'Anuncios elegibles para una zona (#170.2, #192, #194). Devuelve creative_id (170.8) para que el cliente pueda pedir la URL firmada de reproducción a mint-ad-urls. Orden de resolución: zona declarada > polígono DCAH > bbox de municipio (el de MENOR ÁREA, #194) > inventario nacional.';

revoke execute on function public.ads_for_zone(double precision, double precision, bigint, text) from public, anon;
grant execute on function public.ads_for_zone(double precision, double precision, bigint, text) to authenticated;

-- ── 3) public.resolve_ad_zone — delega ──────────────────────────────────────
create or replace function public.resolve_ad_zone(
  p_lat double precision,
  p_lng double precision
)
returns table (
  municipality_id text,
  neighborhood_id bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_neighborhood_id bigint;
  v_municipality_id text;
  v_point           extensions.geography;
begin
  -- GOTCHA de orden (mismo que properties_within_radius / ads_for_zone):
  -- x = lng, y = lat.
  v_point := extensions.ST_SetSRID(extensions.ST_Point(p_lng, p_lat), 4326)::extensions.geography;

  select n.id, n.municipality_id
    into v_neighborhood_id, v_municipality_id
  from public.mx_neighborhoods n
  where extensions.ST_Intersects(n.geom, v_point)
  order by n.id  -- #194: mismo criterio que ads_for_zone
  limit 1;

  if v_neighborhood_id is null then
    -- Hueco de cobertura DCAH: fallback por bbox precalculado del
    -- municipio. Solo municipio, sin colonia.
    --
    -- #235: esta función decide en qué municipio se CONTABILIZA la impresión
    -- facturable y public.ads_for_zone en cuál se SIRVE el anuncio. Antes el
    -- `order by` estaba copiado en ambas y coincidían por disciplina; ahora
    -- comparten private.municipality_at_point y coinciden por construcción.
    v_municipality_id := private.municipality_at_point(p_lat, p_lng);
  end if;
  -- Si tampoco hay bbox: ambas columnas quedan NULL — la fila de
  -- ad_impressions se escribe igual (inventario nacional, 🔒 nunca se
  -- rechaza un item por falta de zona).

  return query select v_municipality_id, v_neighborhood_id;
end;
$$;

comment on function public.resolve_ad_zone(double precision, double precision) is
  'Resuelve municipality_id/neighborhood_id por coordenadas para record-ad-impressions (#170.6): ST_Intersects contra mx_neighborhoods.geom, fallback a bbox de mx_municipalities, NULL/NULL si no hay match (inventario nacional). #194: el fallback por bbox usa el MISMO order by que public.ads_for_zone (menor área, desempate por id) — si divergieran, el anuncio se serviría en un municipio y su impresión se cobraría en otro. SOLO service_role la invoca.';

revoke execute on function public.resolve_ad_zone(double precision, double precision) from public, anon, authenticated;

-- ── 4) public.place_at_point — delega ───────────────────────────────────────
create or replace function public.place_at_point(
  p_lat double precision,
  p_lng double precision
)
returns table (
  kind text,
  id text,
  name text,
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
  v_point extensions.geography;
  v_id    bigint;
begin
  -- Guard de rango: sin él, el cast a geography lanza "Latitude/longitude is
  -- out of range" y el buscador se cae por un GPS raro o un geocoder que
  -- devolvió basura. Un punto imposible no está en ninguna zona: 0 filas.
  -- `between` ya deja fuera NULL, NaN e Infinity.
  if not (p_lat between -90 and 90) or not (p_lng between -180 and 180) then
    return;
  end if;

  -- GOTCHA de orden: X = lng, Y = lat (igual que parse_location y ads_for_zone).
  v_point := extensions.ST_SetSRID(extensions.ST_Point(p_lng, p_lat), 4326)::extensions.geography;

  -- 1) La colonia gana: es la zona más específica que el catálogo puede dar.
  select n.id into v_id
  from public.mx_neighborhoods n
  where extensions.ST_Intersects(n.geom, v_point)
  order by n.id  -- #194: determinista si dos polígonos llegaran a solaparse
  limit 1;

  if v_id is not null then
    return query
    select
      'neighborhood'::text,
      n.id::text,
      n.name,
      m.name || ', ' || s.abbr,
      extensions.ST_YMin(n.geom::extensions.geometry),
      extensions.ST_XMin(n.geom::extensions.geometry),
      extensions.ST_YMax(n.geom::extensions.geometry),
      extensions.ST_XMax(n.geom::extensions.geometry)
    from public.mx_neighborhoods n
    join public.mx_municipalities m on m.id = n.municipality_id
    join public.mx_states s on s.id = m.state_id
    where n.id = v_id;
    return;
  end if;

  -- 2) Hueco de cobertura del DCAH (la cobertura de polígonos es incompleta —
  -- gotcha de #157): fallback al bbox precalculado del municipio.
  --
  -- #235: el criterio de #194 (menor área, desempate por id) lo resuelve
  -- private.municipality_at_point, el MISMO que usan ads_for_zone y
  -- resolve_ad_zone — así la dirección que el buscador resuelve a un municipio
  -- es el municipio en el que después se sirve y se cobra el anuncio.
  -- Filtrar por la PK devuelve 0 o 1 fila sin necesitar `limit`; el join con
  -- mx_states no descarta candidatos porque state_id es NOT NULL con FK.
  return query
  select
    'municipality'::text,
    m.id,
    m.name,
    s.name,
    m.bbox_min_lat,
    m.bbox_min_lng,
    m.bbox_max_lat,
    m.bbox_max_lng
  from public.mx_municipalities m
  join public.mx_states s on s.id = m.state_id
  where m.id = private.municipality_at_point(p_lat, p_lng);

  -- 3) Ni polígono ni bbox: 0 filas. 🔒 No hay rama que invente una zona.
end;
$$;

comment on function public.place_at_point(double precision, double precision) is
  'Resuelve un punto (lat, lng) a una zona DE CATÁLOGO, con el MISMO shape de '
  'fila que search_places para que el buscador unificado de #232 mezcle '
  'sugerencias y direcciones geocodificadas en una sola lista. Orden: colonia '
  'de mx_neighborhoods por ST_Intersects (incluye la frontera) > municipio '
  'cuyo bbox precalculado contiene el punto, el de MENOR ÁREA con desempate '
  'por id (#194) > 0 filas. 🔒 Fuera de cobertura devuelve 0 filas: nunca '
  'fabrica una zona. Coordenadas fuera de rango, NaN o NULL -> 0 filas. '
  'Llamada por el cliente como authenticated.';

revoke execute on function public.place_at_point(double precision, double precision) from public, anon;
grant execute on function public.place_at_point(double precision, double precision) to authenticated;
