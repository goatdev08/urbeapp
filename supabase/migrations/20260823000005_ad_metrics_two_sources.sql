-- Migración 20260823000005 — public.ad_metrics_for_agency lee AMBAS fuentes
-- (subtarea #201.2, tarea 201, hardening(170.5)). 🔴 create-or-replace de una
-- función EXISTENTE — el cuerpo de abajo reemplaza por completo el vigente
-- de 20260821000001 (gotcha del repo: la última migración que toca la
-- función es la que manda, no el archivo original). Contrato de salida
-- INTACTO: misma firma public.ad_metrics_for_agency(p_agency_id uuid,
-- p_from timestamptz, p_to timestamptz), mismas 5 columnas de retorno
-- (municipality_id, neighborhood_id, impressions, views, cta_taps) — builds
-- instalados la llaman (§0.5 producción viva).
-- Rollback: supabase/migrations/rollbacks/20260823000005_ad_metrics_two_sources.sql
-- (restaura verbatim el cuerpo vigente de 20260821000001).
-- Tests: supabase/tests/69_ad_metrics_two_sources_test.sql (27 asserts).
--
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ cambia respecto al cuerpo vigente (20260821000001): esa versión SOLO
-- agregaba desde public.ad_impressions (crudo) y documentaba explícitamente
-- que ad_impressions_monthly "tiene cero escritores... la tabla está vacía y
-- se queda vacía" — eso dejó de ser cierto en 20260823000004/201.1: el job
-- diario rollup_ad_impressions_monthly() ya consolida ahí los meses que la
-- purga (90 días) está a punto de borrar del crudo. Esta migración cierra el
-- hueco: la RPC ahora lee las DOS fuentes y las combina sin doblar ningún
-- dato ni abrir una fuga de k-anonimato. Las dos defensas de privacidad y la
-- conservación de totales de la versión anterior (ver cabecera de
-- 20260821000001) siguen intactas — esta migración las EXTIENDE, no las
-- reemplaza.
--
-- ── REGLA DE FRONTERA (única, compartida con las otras dos funciones) ─────
-- Un mes es ELEGIBLE ⟺ su inicio es >= now() - 90 días — LA MISMA constante
-- `c_retention_days` que usa public.purge_ad_impressions (20260817000002) Y
-- public.rollup_ad_impressions_monthly (20260823000004). Se repite el
-- literal (90) aquí, deliberadamente, en vez de refactorizar las tres
-- funciones para compartir una sola constante en SQL (no existe un lugar
-- natural para eso sin agregar una tabla de configuración o una función
-- auxiliar solo para un entero — YAGNI, ver ponytail de 20260823000004): si
-- la retención cambia algún día, este comentario es el hilo que ata las TRES
-- apariciones y las tres deben cambiar juntas.
-- El crudo (ad_impressions) aporta SOLO meses elegibles; monthly
-- (ad_impressions_monthly) aporta SOLO meses NO elegibles. Es INCONDICIONAL,
-- independiente de p_from/p_to: un mes elegible NUNCA lee monthly (aunque
-- ya exista ahí una fila — el job diario recalcula el mes en curso, así que
-- en producción SIEMPRE habrá una fila monthly "viva" para el mes actual, y
-- se ignora por completo) y un mes no-elegible NUNCA lee crudo (aunque
-- sobreviva un remanente por purga rezagada).
--
-- ── 🔴 D-MEZCLA (k-anonimato al mezclar) ───────────────────────────────────
-- monthly NO guarda user_id — es IMPOSIBLE re-derivar el umbral k>=5 sobre
-- sus filas ahí, así que sus filas de zona real se toman tal cual: ya se
-- anonimizaron AL AGREGAR (misma semántica count(distinct user_id)>=5,
-- 20260823000004). El crudo sigue evaluando su PROPIO k sobre el conjunto
-- YA filtrado a meses elegibles, exactamente como en 20260821000001, sin
-- ningún cambio a esa lógica — es lo que garantiza automáticamente que la
-- porción de crudo bajo el umbral NUNCA llegue a la fila de zona: cae en el
-- bucket del crudo por construcción, igual que hoy. Cuando la MISMA zona
-- tiene también una fila monthly real (ya segura por su cuenta), el UNION +
-- GROUP BY de abajo la suma con lo que el crudo sí logró desglosar — nunca
-- con lo que el crudo colapsó. Anti-differencing: sumar SIEMPRE (monthly
-- seguro + crudo sub-umbral) permitiría a un lector con memoria del valor
-- congelado de monthly restar "lo que ya sabía" del total nuevo y aislar el
-- aporte de un puñado de personas del mes en curso — exactamente la
-- re-identificación que el k-anonimato existe para impedir. Fundir la
-- porción sub-umbral del crudo en el bucket (en vez de perderla) preserva la
-- conservación de totales (dinero, #172) sin abrir esa rendija.
--
-- ── D-RANGO-MONTHLY ─────────────────────────────────────────────────────
-- Una fila monthly con year_month=M representa el intervalo calendario
-- [M, M + 1 mes). Se incluye si y solo si ese intervalo SE TRASLAPA con
-- [p_from, p_to] (frontera inclusiva en ambos extremos, igual que el filtro
-- ya existente sobre shown_at): (p_from IS NULL OR M + 1 mes > p_from) AND
-- (p_to IS NULL OR M <= p_to). La elegibilidad crudo-vs-monthly (arriba) es
-- INCONDICIONAL — se evalúa PRIMERO y no depende de este filtro de rango.
--
-- ── Forma de combinar (por qué no hace falta un caso especial por escenario)
-- Zonas reales: UNION ALL de (crudo con su propio k>=5) y (monthly, siempre
-- de fiar) agrupado por (municipality_id, neighborhood_id) con SUM — una
-- zona con un solo origen sale tal cual, una zona con ambos se suma, una
-- zona que en el crudo cayó bajo el umbral simplemente NUNCA entra a este
-- UNION por el lado del crudo (se fue al bucket), así que si monthly la
-- respalda, la fila final es SOLO la porción monthly. Bucket: UNION ALL de
-- (crudo: zonas reales bajo el umbral + impresiones sin zona, MISMA lógica
-- que 20260821000001) y (monthly: su propia fila (NULL,NULL) ya congelada al
-- agregar) — SUMADOS en una sola fila (NULL,NULL), nunca dos.
--
-- ── security definer / autorización / anti-IDOR ────────────────────────────
-- Sin cambios respecto a 20260821000001: private.agency_role_of +
-- private.org_can_advertise, fail-closed (0 filas, nunca una excepción),
-- security definer, set search_path = '' (todo calificado por schema).
-- ════════════════════════════════════════════════════════════════════════════

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
declare
  -- REGLA DE FRONTERA: MISMA constante (90) que public.purge_ad_impressions
  -- (20260817000002) y public.rollup_ad_impressions_monthly (20260823000004)
  -- — ver cabecera de esta migración.
  c_retention_days constant integer := 90;
  v_retention_cutoff constant timestamptz := now() - (c_retention_days || ' days')::interval;
begin
  -- Anti-IDOR fail-closed: sin las DOS autorizaciones, devuelve vacío sin
  -- tocar ninguna de las dos tablas — nunca una excepción que distinga "no
  -- existe" de "no es tuya" de "no tiene la capacidad".
  if private.agency_role_of(p_agency_id) is null
     or not private.org_can_advertise(p_agency_id) then
    return;
  end if;

  return query
  with scoped as (
    -- Crudo: agencia + rango por shown_at (igual que 20260821000001) MÁS la
    -- compuerta de elegibilidad — SOLO meses cuyo inicio sigue dentro de la
    -- ventana de retención. Un mes ya fuera de esa ventana (remanente por
    -- purga rezagada) queda excluido aquí, incondicionalmente.
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
      and date_trunc('month', ai.shown_at) >= v_retention_cutoff
  ),
  zone_stats as (
    -- Una fila por zona (municipality_id, neighborhood_id) con sus 3
    -- contadores y el conteo de usuarios distintos que decide el colapso.
    -- Lógica IDÉNTICA a 20260821000001 -- no cambia con la segunda fuente.
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
    -- Monthly: agencia + SOLO meses NO elegibles (incondicional, ver arriba)
    -- MÁS el traslape de rango D-RANGO-MONTHLY (independiente de la
    -- elegibilidad). Ya viene anonimizado desde 201.1 -- sus filas de zona
    -- real se toman tal cual, sin re-evaluar ningún umbral.
    select
      aim.municipality_id,
      aim.neighborhood_id,
      aim.impressions,
      aim.views,
      aim.cta_taps
    from public.ad_impressions_monthly aim
    where aim.agency_id = p_agency_id
      and aim.year_month::timestamptz < v_retention_cutoff
      and (p_from is null or (aim.year_month + interval '1 month') > p_from)
      and (p_to is null or aim.year_month::timestamptz <= p_to)
  ),
  real_zone_parts as (
    -- Zonas reales de AMBAS fuentes: crudo que pasó su propio k>=5, y
    -- monthly (siempre de fiar, ya anonimizado al agregar). Una zona
    -- sub-umbral del crudo simplemente NO aparece aquí por ese lado -- se
    -- fue al bucket (abajo) -- así que si monthly la respalda, sale SOLO la
    -- porción monthly (D-MEZCLA).
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
    -- Bucket de AMBAS fuentes: crudo (zonas reales sub-umbral + sin zona,
    -- MISMA lógica que 20260821000001) + monthly (su propia fila (NULL,NULL)
    -- ya congelada al agregar en 201.1).
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

comment on function public.ad_metrics_for_agency(uuid, timestamptz, timestamptz) is
  'Métricas agregadas por zona (municipio/colonia) para el panel del anunciante '
  '(#171.1, extendida #201.2). Combina DOS fuentes sin doble contar: '
  'ad_impressions (crudo) aporta SOLO meses elegibles (inicio >= now() - 90 '
  'días, misma constante que purge_ad_impressions/rollup_ad_impressions_monthly); '
  'ad_impressions_monthly (rollup permanente, #201.1) aporta SOLO meses NO '
  'elegibles. k-anonimato: el crudo evalúa su propio count(distinct user_id) '
  '>= 5 (sin cambios); monthly ya viene anonimizado al agregar y se toma tal '
  'cual. Una zona con ambos orígenes se suma; una zona sub-umbral en el crudo '
  'con respaldo monthly muestra SOLO la porción monthly (el aporte del crudo '
  'se funde en el bucket, nunca se suma a la zona -- anti-differencing). '
  'La respuesta NUNCA incluye user_id ni session_id. security definer + '
  'autorización explícita (private.agency_role_of + private.org_can_advertise): '
  'sin autorización, 0 filas, nunca una excepción (anti-IDOR).';

-- Defense-in-depth: revoke/grant sin cambios respecto a 20260821000001
-- (idempotente, re-aplicable sin efecto si ya estaban así).
revoke execute on function public.ad_metrics_for_agency(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.ad_metrics_for_agency(uuid, timestamptz, timestamptz) to authenticated;
