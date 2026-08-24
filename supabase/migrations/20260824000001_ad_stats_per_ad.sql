-- Migración 20260824000001 — 3 RPCs de lectura POR ANUNCIO para el dashboard
-- de anuncios (subtarea #212.1, tarea #212, dependiente de #201). Aditiva
-- pura: 3 funciones NUEVAS, cero llamadores instalados. Rollback: drop de
-- las 3 (supabase/migrations/rollbacks/20260824000001_ad_stats_per_ad.sql).
-- Tests: supabase/tests/70_ad_stats_per_ad_test.sql (82 asserts).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Las 3 firmas (todas p_ad_id uuid obligatorio, p_from/p_to timestamptz
-- opcionales, frontera INCLUSIVA en ambos extremos como ad_metrics_for_agency):
--
--   public.ad_stats_totals(p_ad_id, p_from, p_to)
--     returns table (impressions integer, views integer, cta_taps integer)
--     -- 3 números del card "Máximo" del panel del anunciante, UNA fila.
--
--   public.ad_stats_daily(p_ad_id, p_from, p_to)
--     returns table (day date, impressions integer, views integer, cta_taps integer)
--     -- serie diaria para el gráfico de línea, una fila por día CON actividad.
--
--   public.ad_stats_zones(p_ad_id, p_from, p_to)
--     returns table (municipality_id text, neighborhood_id bigint,
--       impressions integer, views integer, cta_taps integer)
--     -- desglose por zona k>=5 + bucket "otras zonas" (NULL,NULL).
--
-- Las 3 calcan el patrón anti-IDOR / dos-fuentes EXACTO de
-- public.ad_metrics_for_agency (20260821000001/20260823000005) pero
-- desglosado POR ANUNCIO en vez de por agencia: security definer, stable,
-- set search_path = '', revoke execute from public,anon, grant execute to
-- authenticated (el anti-IDOR interno es el gate real, no el grant).
--
-- ── Autorización (idéntica en las 3) ────────────────────────────────────────
-- v_agency_id := (select agency_id from public.ads where id = p_ad_id) — un
-- p_ad_id inexistente deja v_agency_id NULL. Exige
-- private.agency_role_of(v_agency_id) is not null AND
-- private.org_can_advertise(v_agency_id) — fail-closed, 0 filas, NUNCA una
-- excepción (ambos helpers ya toleran un p_agency_id NULL sin lanzar: ver
-- 20260805000003/20260815000001). Esto cubre las 4 causas de rechazo:
-- stranger sin membresía, agencia sin can_advertise, owner de OTRA agencia
-- (el ad debe pertenecer a SU agencia), y ad_id que no existe en absoluto.
--
-- ── REGLA DE FRONTERA (misma constante que el resto de la familia) ─────────
-- Un mes es ELEGIBLE ⟺ su inicio >= now() - 90 días — MISMA constante
-- c_retention_days que public.purge_ad_impressions (20260817000002),
-- public.rollup_ad_impressions_monthly (20260823000004) y
-- public.ad_metrics_for_agency (20260823000005). Se repite el literal (90)
-- en las 3 funciones de este archivo, deliberadamente, por la MISMA razón
-- documentada en 20260823000005: no hay un lugar natural para centralizarlo
-- sin una tabla de configuración o una función auxiliar solo para un entero
-- (YAGNI). Si la retención cambia, este comentario es el hilo que ata las
-- SEIS apariciones (las 3 de este archivo + las 3 de la familia previa) y
-- las seis deben cambiar juntas.
--
-- ── ad_stats_totals: dos fuentes, SIN desglose de zona ──────────────────────
-- A diferencia de ad_stats_zones, esta RPC nunca agrupa por zona: suma TODO
-- lo que matchea (ad_id [+ rango + elegibilidad]) en una sola fila. Eso es
-- seguro (no hay k-anonimato que romper) precisamente PORQUE es un agregado
-- total sin dimensión geográfica — no expone ninguna zona individual, sea
-- cual sea su tamaño. Crudo: SOLO meses elegibles. Monthly: SOLO meses NO
-- elegibles (incondicional) que además traslapan [p_from, p_to]
-- (D-RANGO-MONTHLY, igual que la familia previa). Total = suma(crudo) +
-- suma(monthly), coalesce a 0 si cualquiera de las dos fuentes no aporta
-- filas — SIEMPRE UNA fila (nunca 0 filas si la autorización pasó, aunque el
-- anuncio no tenga ninguna actividad).
--
-- ── ad_stats_daily (D-DAILY-ELIGIBLE, decisión de contrato de este RED) ─────
-- SOLO del crudo (monthly no tiene granularidad diaria) — pero el crudo se
-- filtra con la MISMA compuerta de elegibilidad que decide crudo-vs-monthly
-- en totals/zones: un remanente "stray" de un mes YA congelado (purga
-- rezagada) NO aparece como día huérfano. Consecuencia ASIMÉTRICA y
-- deliberada: un mes elegible aporta sus días normalmente; un mes NO
-- elegible aporta CERO días a la serie diaria, aunque SÍ aporte su cifra
-- consolidada a totals/zones vía monthly — el cliente nunca ve línea de
-- tiempo para periodos históricos, solo el número agregado del selector
-- "Máximo". SIN umbral k (regla fija de Abraham: "zona ⇒ k≥5; sin zona ⇒
-- libre" — la serie diaria no tiene dimensión geográfica, no hay zona que
-- anonimizar; un día con un solo usuario distinto aparece completo). Una
-- fila por día CON actividad, sin relleno de ceros (lo rellena el cliente).
-- Orden day ascendente.
--
-- ── ad_stats_zones — D-GRANULARIDAD-AD ──────────────────────────────────────
-- Mismo patrón exacto de ad_metrics_for_agency (dos fuentes, D-MEZCLA,
-- bucket que funde 3 orígenes, D-RANGO-MONTHLY) pero el k-anonimato se
-- evalúa POR (ad_id, zona), NUNCA por (agencia, zona): el crudo se filtra
-- por ad_id = p_ad_id ANTES de agrupar y contar distinct user_id, así que un
-- anuncio hermano de la MISMA agencia con usuarios propios en la MISMA zona
-- JAMÁS se suma al conteo de distintos de este anuncio. El monthly
-- (ad_impressions_monthly) YA tiene columna ad_id y sus filas de zona real
-- se sembraron/calculan por (agency_id, ad_id, zona) desde el rollup
-- (201.1) — filtrar por ad_id = p_ad_id le da exactamente la granularidad
-- correcta sin ningún re-cálculo: se pasa tal cual, como ya venía siendo de
-- fiar en la versión por agencia (más fino aún que ahí, según el plan
-- 212.1). D-MEZCLA sin cambios: una zona con AMBOS orígenes y crudo BAJO su
-- propio k muestra SOLO la porción monthly (el crudo se funde al bucket,
-- nunca se suma a la zona — anti-differencing); si el crudo SÍ pasa su
-- propio k, se suma limpio con la porción monthly.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) ad_stats_totals ──────────────────────────────────────────────────────
create or replace function public.ad_stats_totals(
  p_ad_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  impressions integer,
  views integer,
  cta_taps integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_retention_days constant integer := 90;
  v_retention_cutoff constant timestamptz := now() - (c_retention_days || ' days')::interval;
  v_agency_id uuid;
begin
  v_agency_id := (select ads.agency_id from public.ads where ads.id = p_ad_id);

  -- Anti-IDOR fail-closed: sin las DOS autorizaciones (incluye p_ad_id
  -- inexistente, que deja v_agency_id NULL), devuelve vacío sin tocar
  -- ninguna de las dos tablas — nunca una excepción.
  if private.agency_role_of(v_agency_id) is null
     or not private.org_can_advertise(v_agency_id) then
    return;
  end if;

  return query
  with raw_scoped as (
    -- Crudo: SOLO este anuncio, rango por shown_at (frontera inclusiva) MÁS
    -- la compuerta de elegibilidad — SOLO meses cuyo inicio sigue dentro de
    -- la ventana de retención.
    select
      count(*)::integer as impressions,
      count(*) filter (where ai.viewed)::integer as views,
      count(*) filter (where ai.cta_tapped_at is not null)::integer as cta_taps
    from public.ad_impressions ai
    where ai.ad_id = p_ad_id
      and (p_from is null or ai.shown_at >= p_from)
      and (p_to is null or ai.shown_at <= p_to)
      and date_trunc('month', ai.shown_at) >= v_retention_cutoff
  ),
  monthly_scoped as (
    -- Monthly: SOLO este anuncio, SOLO meses NO elegibles (incondicional)
    -- MÁS el traslape D-RANGO-MONTHLY.
    select
      coalesce(sum(aim.impressions), 0)::integer as impressions,
      coalesce(sum(aim.views), 0)::integer as views,
      coalesce(sum(aim.cta_taps), 0)::integer as cta_taps
    from public.ad_impressions_monthly aim
    where aim.ad_id = p_ad_id
      and aim.year_month::timestamptz < v_retention_cutoff
      and (p_from is null or (aim.year_month + interval '1 month') > p_from)
      and (p_to is null or aim.year_month::timestamptz <= p_to)
  )
  select
    (r.impressions + m.impressions)::integer,
    (r.views + m.views)::integer,
    (r.cta_taps + m.cta_taps)::integer
  from raw_scoped r, monthly_scoped m;
end;
$$;

comment on function public.ad_stats_totals(uuid, timestamptz, timestamptz) is
  'Totales (impressions/views/cta_taps) de UN anuncio para el card "Máximo" '
  'del dashboard (#212.1). Combina DOS fuentes sin doble contar (patrón '
  'ad_metrics_for_agency/20260823000005): ad_impressions aporta SOLO meses '
  'elegibles (inicio >= now() - 90 días), ad_impressions_monthly aporta SOLO '
  'meses NO elegibles. Sin desglose de zona -- una agregación total no tiene '
  'k-anonimato que romper. SIEMPRE una fila si la autorización pasa (0 si el '
  'anuncio no tiene actividad). security definer + anti-IDOR '
  '(private.agency_role_of + private.org_can_advertise sobre la agencia '
  'dueña del ad): sin autorización, 0 filas, nunca una excepción.';

revoke execute on function public.ad_stats_totals(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.ad_stats_totals(uuid, timestamptz, timestamptz) to authenticated;

-- ── 2) ad_stats_daily ────────────────────────────────────────────────────────
create or replace function public.ad_stats_daily(
  p_ad_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  day date,
  impressions integer,
  views integer,
  cta_taps integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_retention_days constant integer := 90;
  v_retention_cutoff constant timestamptz := now() - (c_retention_days || ' days')::interval;
  v_agency_id uuid;
begin
  v_agency_id := (select ads.agency_id from public.ads where ads.id = p_ad_id);

  if private.agency_role_of(v_agency_id) is null
     or not private.org_can_advertise(v_agency_id) then
    return;
  end if;

  return query
  -- SOLO crudo (monthly no tiene granularidad diaria). MISMA compuerta de
  -- elegibilidad que decide crudo-vs-monthly en totals/zones
  -- (D-DAILY-ELIGIBLE): un mes YA congelado aporta CERO días, aunque sí
  -- aporte su cifra consolidada a totals/zones vía monthly. SIN umbral k
  -- (regla fija: sin dimensión geográfica no hay zona que anonimizar). Una
  -- fila por día CON actividad, sin relleno de ceros.
  select
    ai.shown_at::date as day,
    count(*)::integer as impressions,
    count(*) filter (where ai.viewed)::integer as views,
    count(*) filter (where ai.cta_tapped_at is not null)::integer as cta_taps
  from public.ad_impressions ai
  where ai.ad_id = p_ad_id
    and (p_from is null or ai.shown_at >= p_from)
    and (p_to is null or ai.shown_at <= p_to)
    and date_trunc('month', ai.shown_at) >= v_retention_cutoff
  group by ai.shown_at::date
  -- 🔴 order by la EXPRESIÓN, no el alias "day": el nombre de columna de
  -- retorno "day" (OUT parameter de la función) sombrea el alias del SELECT
  -- dentro del cuerpo PL/pgSQL -- referenciarlo bareword aquí resuelve al
  -- OUT parameter (NULL en este punto), no a la columna de la consulta, y
  -- Postgres lanza en tiempo de ejecución. La expresión repetida evita la
  -- ambigüedad sin cambiar el resultado.
  order by ai.shown_at::date asc;
end;
$$;

comment on function public.ad_stats_daily(uuid, timestamptz, timestamptz) is
  'Serie diaria (impressions/views/cta_taps) de UN anuncio para el gráfico '
  'de línea del dashboard (#212.1). SOLO del crudo (ad_impressions) -- '
  'ad_impressions_monthly no tiene granularidad diaria -- filtrado con la '
  'MISMA compuerta de elegibilidad (90 días) que usan ad_stats_totals/zones '
  'para decidir crudo-vs-monthly: un mes YA congelado (representado por su '
  'fila monthly en totals/zones) aporta CERO días aquí -- asimetría '
  'deliberada, el cliente nunca ve línea de tiempo para periodos históricos, '
  'solo el agregado de "Máximo". SIN umbral k (sin dimensión geográfica no '
  'hay zona que anonimizar). Una fila por día CON actividad, orden '
  'ascendente, sin relleno de ceros (lo rellena el cliente). security '
  'definer + anti-IDOR: sin autorización, 0 filas, nunca una excepción.';

revoke execute on function public.ad_stats_daily(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.ad_stats_daily(uuid, timestamptz, timestamptz) to authenticated;

-- ── 3) ad_stats_zones ────────────────────────────────────────────────────────
create or replace function public.ad_stats_zones(
  p_ad_id uuid,
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
declare
  c_retention_days constant integer := 90;
  v_retention_cutoff constant timestamptz := now() - (c_retention_days || ' days')::interval;
  v_agency_id uuid;
begin
  v_agency_id := (select ads.agency_id from public.ads where ads.id = p_ad_id);

  if private.agency_role_of(v_agency_id) is null
     or not private.org_can_advertise(v_agency_id) then
    return;
  end if;

  return query
  with scoped as (
    -- Crudo: SOLO este anuncio (D-GRANULARIDAD-AD -- nunca por agencia),
    -- rango por shown_at (frontera inclusiva) MÁS la compuerta de
    -- elegibilidad.
    select
      ai.user_id,
      ai.municipality_id,
      ai.neighborhood_id,
      ai.viewed,
      ai.cta_tapped_at
    from public.ad_impressions ai
    where ai.ad_id = p_ad_id
      and (p_from is null or ai.shown_at >= p_from)
      and (p_to is null or ai.shown_at <= p_to)
      and date_trunc('month', ai.shown_at) >= v_retention_cutoff
  ),
  zone_stats as (
    -- Una fila por zona con sus 3 contadores y el conteo de usuarios
    -- distintos DE ESTE ANUNCIO que decide el colapso. Lógica idéntica a
    -- ad_metrics_for_agency, solo que `scoped` ya viene filtrado por ad_id
    -- en vez de agency_id.
    select
      s.municipality_id,
      s.neighborhood_id,
      count(*)::integer as impressions,
      count(*) filter (where s.viewed)::integer as views,
      count(*) filter (where s.cta_tapped_at is not null)::integer as cta_taps,
      count(distinct s.user_id) as distinct_users,
      (s.municipality_id is not null or s.neighborhood_id is not null) as is_real_zone
    from scoped s
    group by s.municipality_id, s.neighborhood_id
  ),
  monthly_scoped as (
    -- Monthly: SOLO este anuncio (ya viene a granularidad (agency, ad, zona)
    -- desde el rollup #201.1 -- se pasa tal cual, sin re-evaluar ningún
    -- umbral) -- SOLO meses NO elegibles (incondicional) MÁS el traslape
    -- D-RANGO-MONTHLY.
    select
      aim.municipality_id,
      aim.neighborhood_id,
      aim.impressions,
      aim.views,
      aim.cta_taps
    from public.ad_impressions_monthly aim
    where aim.ad_id = p_ad_id
      and aim.year_month::timestamptz < v_retention_cutoff
      and (p_from is null or (aim.year_month + interval '1 month') > p_from)
      and (p_to is null or aim.year_month::timestamptz <= p_to)
  ),
  real_zone_parts as (
    -- Zonas reales de AMBAS fuentes: crudo que pasó su propio k>=5 POR
    -- (ad_id, zona), y monthly (siempre de fiar, ya anonimizado al agregar
    -- por (agency, ad, zona)). Una zona sub-umbral del crudo NO aparece
    -- aquí -- se fue al bucket (abajo) -- así que si monthly la respalda,
    -- sale SOLO la porción monthly (D-MEZCLA).
    select z.municipality_id, z.neighborhood_id, z.impressions, z.views, z.cta_taps
    from zone_stats z
    where z.is_real_zone and z.distinct_users >= 5

    union all

    select ms.municipality_id, ms.neighborhood_id, ms.impressions, ms.views, ms.cta_taps
    from monthly_scoped ms
    where ms.municipality_id is not null or ms.neighborhood_id is not null
  ),
  real_zones as (
    -- Suma por zona: una sola fuente sale tal cual, ambas fuentes se suman.
    select
      p.municipality_id,
      p.neighborhood_id,
      sum(p.impressions)::integer as impressions,
      sum(p.views)::integer as views,
      sum(p.cta_taps)::integer as cta_taps
    from real_zone_parts p
    group by p.municipality_id, p.neighborhood_id
  ),
  bucket_parts as (
    -- Bucket de AMBAS fuentes: crudo (zonas reales sub-umbral + sin zona) +
    -- monthly (su propia fila (NULL,NULL) ya congelada al agregar).
    select z.impressions, z.views, z.cta_taps
    from zone_stats z
    where not z.is_real_zone or z.distinct_users < 5

    union all

    select ms.impressions, ms.views, ms.cta_taps
    from monthly_scoped ms
    where ms.municipality_id is null and ms.neighborhood_id is null
  )
  select
    r.municipality_id,
    r.neighborhood_id,
    r.impressions,
    r.views,
    r.cta_taps
  from real_zones r

  union all

  -- Bucket "otras zonas", UNA sola fila -- funde crudo sub-umbral/sin-zona
  -- con el bucket congelado de monthly. Solo aparece si hay algo que sumar.
  select
    null::text as municipality_id,
    null::bigint as neighborhood_id,
    sum(b.impressions)::integer as impressions,
    sum(b.views)::integer as views,
    sum(b.cta_taps)::integer as cta_taps
  from bucket_parts b
  having sum(b.impressions) is not null;
end;
$$;

comment on function public.ad_stats_zones(uuid, timestamptz, timestamptz) is
  'Desglose por zona (municipio/colonia) de UN anuncio para el dashboard '
  '(#212.1). Patrón EXACTO de ad_metrics_for_agency/20260823000005 (dos '
  'fuentes sin doble contar, D-MEZCLA, bucket (NULL,NULL) que funde 3 '
  'orígenes) pero el k-anonimato (count(distinct user_id) >= 5) se evalúa '
  'POR (ad_id, zona) -- D-GRANULARIDAD-AD -- NUNCA por (agencia, zona): un '
  'anuncio hermano de la MISMA agencia con usuarios propios en la MISMA '
  'zona jamás se suma al conteo de distintos de este anuncio. monthly ya '
  'viene a esa granularidad desde el rollup #201.1 -- se pasa tal cual. '
  'security definer + anti-IDOR (private.agency_role_of + '
  'private.org_can_advertise sobre la agencia dueña del ad): sin '
  'autorización, 0 filas, nunca una excepción.';

revoke execute on function public.ad_stats_zones(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.ad_stats_zones(uuid, timestamptz, timestamptz) to authenticated;
