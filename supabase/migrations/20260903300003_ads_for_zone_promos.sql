-- Migración 20260903300003 — public.ads_for_zone sirve PROMOCIONES de
-- propiedades (tarea #213, subtarea 213.3-SQL). ADITIVA.
--
-- ── El hueco que cierra ─────────────────────────────────────────────────────
-- 213.1 le dio a `ads` una segunda fuente de video (`property_id`) y 213.2 la
-- ruta para crearla, pero ads_for_zone seguía haciendo `join ad_creatives`: un
-- INNER join sobre una columna que ahora es NULL en toda promoción. Sin este
-- cambio, una promo se aprueba en /admin/ads y NUNCA llega al feed — la
-- feature completa, invisible.
--
-- ── 🔴 Producción viva (CLAUDE.md §0.5): por qué es aditiva ────────────────
-- El `returns table` cambia, así que un `create or replace` no basta: hay que
-- `drop function` + `create`. Eso es seguro AQUÍ y solo aquí porque:
--   1. Las 9 columnas actuales conservan NOMBRE, TIPO y ORDEN; `property_id
--      uuid` se agrega AL FINAL. Los builds instalados piden columnas por
--      nombre (`select('id, creative_id, …')` sobre el resultado de la RPC) y
--      una columna de más es invisible para ellos.
--   2. La firma de PARÁMETROS no se toca: el cliente llama exactamente igual.
--   3. 🔴 El `drop` se lleva los GRANTS. Se re-otorgan explícitos al final —
--      olvidarlo deja el feed entero en 42501 para todo usuario, no solo para
--      quien vea anuncios. El assert SIG5 de la suite 89 es ese candado.
--
-- ── 🔴 #235: el fallback municipal SIGUE delegado ──────────────────────────
-- Esta migración reescribe el cuerpo ENTERO de ads_for_zone, así que es el
-- punto exacto donde la copia triplicada del `order by` de #194 puede volver a
-- nacer. NO se reintroduce: el fallback llama a private.municipality_at_point,
-- igual que resolve_ad_zone y place_at_point. El resto del cuerpo (resolución
-- de zona, comentarios) se copia VERBATIM de 20260903200001 — un
-- drop-and-create reescribe la función completa y perder esos comentarios
-- perdería el porqué. Anclado por EC-31 de la suite 86 y SIG7 de la 89.
--
-- ── El criterio de "video reproducible" no se inventa ──────────────────────
-- Una promo solo se sirve si su propiedad está publicada Y tiene un video que
-- mint-video-url aceptaría firmar: properties.status='active' AND
-- properties.deleted_at IS NULL AND property_videos.status='ready' AND
-- property_videos.deleted_at IS NULL (supabase/functions/mint-video-url/
-- types.ts:43-47 y el adapter de _shared/clients.ts). Si el feed sirviera una
-- promo que el minter rechaza, el cliente la descartaría en silencio y el
-- anunciante consumiría su cupo de 30 días por un hueco.
--
-- ── Sin cambios en Edge Functions ──────────────────────────────────────────
-- mint-ad-urls sigue recibiendo solo creative_ids no nulos (el cliente
-- particiona por `property_id is null`); el video de la promo lo firma
-- mint-video-url, que ya autoriza por properties.status='active'.
--
-- Idempotente: drop if exists + create + revoke/grant repetibles.
-- Rollback: supabase/migrations/rollbacks/20260903300003_ads_for_zone_promos.sql
-- Tests: supabase/tests/89_ads_for_zone_promos_test.sql (+ 86 EC-31 intacto)

drop function if exists public.ads_for_zone(double precision, double precision, bigint, text);

create function public.ads_for_zone(
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
  agency_logo_url text,
  -- #213: la promoción de una propiedad. NULL para un anuncio display. Es la
  -- llave con la que el cliente parte el lote en dos: los display van a
  -- mint-ad-urls por creative_id y las promos a mint-video-url por property_id.
  property_id uuid
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
    -- firma: ese ya viajaba y no basta -- mint-ad-urls autoriza por creativo.
    -- #213: en una promoción esta columna es NULL y el video se firma por
    -- property_id con mint-video-url.
    a.creative_id,
    a.title,
    a.description,
    a.cta_type,
    a.cta_value,
    c.cloudflare_uid,
    ag.name::text,
    ag.logo_url,
    a.property_id
  from public.ads a
  -- #213: LEFT join. Una promoción no tiene creativo; con el INNER join
  -- anterior desaparecía del feed sin dejar rastro.
  left join public.ad_creatives c on c.id = a.creative_id
  join public.agencies ag on ag.id = a.agency_id
  where a.status = 'active'
    and now() between a.starts_at and a.ends_at
    and (
      -- Anuncio DISPLAY: su creativo debe estar listo. La condición sigue
      -- acotada a esta rama -- sin el `a.creative_id is not null`, el left
      -- join dejaría pasar cualquier fila con c.status NULL y el feed
      -- mostraría una tarjeta muda.
      (a.creative_id is not null and c.status = 'ready')
      or
      -- PROMOCIÓN: se sirve solo si su publicación sigue viva y su video es
      -- reproducible -- MISMO criterio que autoriza mint-video-url. El estado
      -- de la PUBLICACIÓN manda sobre el del anuncio: pausarla o borrarla la
      -- saca del feed aunque el ad siga 'active'.
      (a.property_id is not null and exists (
        select 1
        from public.properties p
        join public.property_videos v on v.property_id = p.id
        where p.id = a.property_id
          and p.status = 'active'
          and p.deleted_at is null
          and v.status = 'ready'
          and v.deleted_at is null
      ))
    )
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
  'Anuncios elegibles para una zona (#170.2, #192, #194, #213). Devuelve creative_id (170.8) para que el cliente pueda pedir la URL firmada de reproducción a mint-ad-urls, y property_id (#213) para las PROMOCIONES de una publicación, cuyo video se firma con mint-video-url. Un anuncio trae exactamente una de las dos. Orden de resolución: zona declarada > polígono DCAH > bbox de municipio (private.municipality_at_point, #194/#235) > inventario nacional. Una promoción solo se sirve si su publicación sigue active/no borrada y tiene un video ready no borrado: el mismo criterio que autoriza mint-video-url.';

revoke execute on function public.ads_for_zone(double precision, double precision, bigint, text) from public, anon;
grant execute on function public.ads_for_zone(double precision, double precision, bigint, text) to authenticated;
