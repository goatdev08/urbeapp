-- Rollback: 20260823000005_ad_metrics_two_sources.sql
-- Restaura VERBATIM el cuerpo vigente ANTES de esta migración (el de
-- 20260821000001: agrega SOLO desde public.ad_impressions, sin leer
-- ad_impressions_monthly). No hay datos que revertir -- ambas versiones son
-- solo la definición de una función RPC de lectura; ninguna tabla ni columna
-- se tocó. Firma y grants quedan exactamente iguales antes y después.

create or replace function public.ad_metrics_for_agency(
  p_agency_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  municipality_id text,
  neighborhood_id bigint,
  impressions integer,
  views integer,
  cta_taps integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Anti-IDOR fail-closed: sin las DOS autorizaciones, devuelve vacío sin
  -- tocar ad_impressions — nunca una excepción que distinga "no existe" de
  -- "no es tuya" de "no tiene la capacidad".
  if private.agency_role_of(p_agency_id) is null
     or not private.org_can_advertise(p_agency_id) then
    return;
  end if;

  return query
  with scoped as (
    -- Filtro de autorización ya resuelto arriba; aquí solo agencia + rango
    -- por shown_at, frontera inclusiva en ambos extremos (NULL = sin límite).
    select
      ai.user_id,
      ai.municipality_id,
      ai.neighborhood_id,
      ai.viewed,
      ai.cta_tapped_at
    from public.ad_impressions ai
    where ai.agency_id = p_agency_id
      and (p_from is null or ai.shown_at >= p_from)
      and (p_to is null or ai.shown_at <= p_to)
  ),
  zone_stats as (
    -- Una fila por zona (municipality_id, neighborhood_id) con sus 3
    -- contadores y el conteo de usuarios distintos que decide el colapso.
    select
      s.municipality_id,
      s.neighborhood_id,
      count(*)::integer as impressions,
      count(*) filter (where s.viewed)::integer as views,
      count(*) filter (where s.cta_tapped_at is not null)::integer as cta_taps,
      count(distinct s.user_id) as distinct_users,
      -- Una "zona real" es la que resolvió al menos uno de los dos campos. El
      -- grupo (NULL, NULL) NO es una zona: es la ausencia de zona, y por eso
      -- nunca puede desglosarse por su cuenta por muchos usuarios que tenga.
      (s.municipality_id is not null or s.neighborhood_id is not null) as is_real_zone
    from scoped s
    group by s.municipality_id, s.neighborhood_id
  )
  -- Zonas REALES con k-anonimato >= 5 usuarios distintos: se desglosan tal cual.
  -- 🔴 `is_real_zone` NO es redundante (hallazgo del guardián, EDGE12b): sin
  -- él, un grupo (NULL, NULL) con 5+ usuarios distintos salía por ESTA rama Y
  -- otra vez por el bucket de abajo — dos filas con la MISMA llave. No perdía
  -- datos, por eso los asserts de conservación de totales no lo veían, pero
  -- contradecía el contrato ("nunca como su propia fila aparte") y le entregaba
  -- al cliente una llave duplicada: el gotcha de FlatList "same key" ya pagado
  -- en este repo. Y no es teórico: la zona no resuelve cuando el GPS está
  -- apagado o el punto cae fuera de polígono, así que 5 dispositivos distintos
  -- sin zona es lo normal, no lo raro.
  select
    z.municipality_id,
    z.neighborhood_id,
    z.impressions,
    z.views,
    z.cta_taps
  from zone_stats z
  where z.is_real_zone
    and z.distinct_users >= 5

  union all

  -- Bucket "otras zonas", UNA sola fila. Funde dos orígenes que para el
  -- anunciante significan lo mismo ("no es una zona específica"): las zonas
  -- reales colapsadas por privacidad (< 5 usuarios distintos) y las que ya
  -- nacieron sin resolver, sin importar cuántos usuarios tengan. Solo aparece
  -- si hay algo que agregar (evita una fila 0/0/0 cuando no hay nada que
  -- colapsar).
  select
    null::text as municipality_id,
    null::bigint as neighborhood_id,
    sum(z.impressions)::integer as impressions,
    sum(z.views)::integer as views,
    sum(z.cta_taps)::integer as cta_taps
  from zone_stats z
  where not z.is_real_zone
     or z.distinct_users < 5
  having sum(z.impressions) is not null;
end;
$$;

comment on function public.ad_metrics_for_agency(uuid, timestamptz, timestamptz) is
  'Métricas agregadas por zona (municipio/colonia) para el panel del anunciante '
  '(subtarea #171.1). Agrega SOLO desde ad_impressions (ad_impressions_monthly está '
  'vacía y sin escritor — un union hoy doble-contaría cuando exista el rollup, ver '
  'cabecera de la migración). k-anonimato: count(distinct user_id) >= 5 decide si una '
  'zona se desglosa; con menos, colapsa en la fila (NULL, NULL) "otras zonas" sin '
  'perder totales. La respuesta NUNCA incluye user_id ni session_id. security '
  'definer + autorización explícita en el cuerpo (private.agency_role_of + '
  'private.org_can_advertise, patrón public.get_lead_stats), sin autorización, 0 '
  'filas, nunca una excepción (anti-IDOR).';

revoke execute on function public.ad_metrics_for_agency(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.ad_metrics_for_agency(uuid, timestamptz, timestamptz) to authenticated;
