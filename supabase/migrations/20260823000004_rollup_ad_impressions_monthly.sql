-- Migración 20260823000004 — public.rollup_ad_impressions_monthly() + pg_cron
-- (subtarea #201.1, hardening(170.5), tarea 201, derivada del techo conocido
-- documentado en 20260821000001 "pasados 90 días el crudo se purga y el
-- anunciante pierde el histórico"). Aditiva pura: función nueva + job nuevo,
-- ninguna tabla ni contrato existente se toca.
-- Contrato completo (firma, edge cases, invariantes, las decisiones de
-- contrato del test-author — D-RETURN/D-ELEGIBILIDAD/D-BUCKET): ver cabecera
-- de supabase/tests/68_rollup_ad_impressions_monthly_test.sql (RED
-- 2026-08-23, extendido 2026-08-24 en el commit `test(red): 201.1b` tras un
-- hallazgo BLOQUEANTE del guardián sobre el primer GREEN — ver D-ELEGIBILIDAD
-- abajo).
-- Rollback: supabase/migrations/rollbacks/20260823000004_rollup_ad_impressions_monthly.sql
--
-- ── QUÉ hace ─────────────────────────────────────────────────────────────
-- Recalcula public.ad_impressions_monthly desde el crudo (public.ad_impressions)
-- ANTES de que la purga diaria (purge_ad_impressions_daily, 9:00 UTC) borre
-- nada -- este job corre a las 8:00 UTC (1h de holgura). Es lo que convierte
-- el "trabajo futuro" mencionado en 20260821000001 (ad_metrics_for_agency
-- solo lee ad_impressions, la tabla monthly nunca tuvo escritor) en un job
-- real: sin él, el rollup permanente queda vacío para siempre y el
-- anunciante pierde su histórico más allá de la ventana de 90 días.
--
-- ── 🔴 D-ELEGIBILIDAD (hallazgo BLOQUEANTE del guardián sobre el primer
--    GREEN, 2026-08-24 — reemplaza la D-VENTANA original de esa primera
--    versión) — un mes solo se toca si su crudo está GARANTIZADO íntegro ──
-- La purga (purge_ad_impressions, 20260817000002) es ROLLING día a día por
-- created_at: en cualquier instante, un mes calendario puede estar "a
-- medias" en el crudo -- ya perdió sus días más viejos pero conserva un
-- remanente reciente. El primer GREEN recalculaba CUALQUIER mes "presente en
-- el crudo" sin distinguir esto: cada corrida borraba la fila consolidada
-- del mes y la reinsertaba con SOLO lo que quedaba ese día -- el histórico
-- permanente terminaba congelándose en una fracción del mes real (demostrado
-- en vivo por el guardián con un contra-ejemplo de purga rolling: T0
-- crudo=14 -> tras la purga crudo=4 -> la 2a corrida reescribía monthly a 4,
-- perdiendo las 10 impresiones ya consolidadas).
--
-- Contrato corregido: un mes es ELEGIBLE para recálculo si y solo si su
-- INICIO (date_trunc('month', shown_at)) es >= now() - 90 días -- LA MISMA
-- constante de retención que usa purge_ad_impressions (`c_retention_days`
-- abajo, deliberadamente NO reescrita como un número distinto; no se toca la
-- función purge_ad_impressions ya desplegada solo para compartir la
-- constante -- si esa retención cambia algún día, este literal debe cambiar
-- junto, y este comentario es el hilo que los ata). Intuición: un mes se
-- "congela" en el momento en que la frontera de retención cruza su inicio --
-- para entonces, mientras SÍ fue elegible (todo el mes anterior a cruzar esa
-- frontera), ya se agregó íntegro en corridas previas del job diario, así
-- que el último valor consolidado que alcanzó a calcular ES el valor
-- correcto y completo del mes. Meses NO elegibles se dejan INTACTOS -- NI
-- DELETE NI INSERT, en absoluto -- incluyendo un mes sin ningún crudo hoy
-- (consolidado hace mucho: el loop ni siquiera lo visita, nunca aparece en
-- el `distinct` de abajo) y un mes con un remanente parcial post-purga (el
-- loop lo excluye explícitamente por la condición de elegibilidad aunque SÍ
-- haya filas suyas en el crudo hoy). Con esta compuerta, la promesa "un mes
-- purgado nunca se toca" (ya prometida en el primer GREEN) pasa de ser una
-- coincidencia del `distinct` a ser cierta POR CONSTRUCCIÓN.
--
-- ── Estrategia de escritura: DELETE + INSERT del mes completo, no upsert ──
-- Por cada mes ELEGIBLE: 1) DELETE de ad_impressions_monthly donde
-- year_month = ese mes (cualquier agencia/anuncio/zona), 2) INSERT del
-- recálculo completo de ese mes. Se prefiere sobre "insert ... on conflict
-- do update" porque el conjunto de LLAVES de un mes puede cambiar entre
-- corridas -- una zona que antes tenía 5 usuarios distintos y hoy cae a 4 (o
-- viceversa) deja de tener/empieza a tener fila propia; on conflict do
-- update nunca borraría la fila vieja que ya no corresponde (fuga de una
-- zona por debajo del umbral de k-anonimato que debía haberse fundido en el
-- bucket). Validado por el guardian en el primer GREEN -- lo que faltaba no
-- era la estrategia de escritura, era la compuerta de elegibilidad de ARRIBA
-- que decide QUÉ meses entran al loop.
--
-- ── D-BUCKET / k-anonimato AL AGREGAR (precedente fijo de Abraham "zona ⇒
--    k≥5; sin zona ⇒ libre", exploración 040 y #171) ─────────────────────
-- MISMA semántica que public.ad_metrics_for_agency (20260821000001): una
-- zona real (municipality_id o neighborhood_id no nulo) con
-- count(distinct user_id) >= 5 en el mes se desglosa con fila propia.
-- Cualquier otra combinación -- zona real con < 5 usuarios distintos, o
-- impresiones que ya nacieron sin zona (NULL, NULL) -- se funde en UNA sola
-- fila bucket (agency_id, ad_id, NULL, NULL, year_month). Minimización de
-- datos: el histórico PERMANENTE nunca contiene una zona por debajo del
-- umbral -- a diferencia de ad_metrics_for_agency (que re-evalúa el umbral
-- en cada consulta sobre el crudo), este rollup fija la decisión de
-- privacidad en el momento de agregar, porque monthly no guarda user_ids y
-- por tanto sería IMPOSIBLE re-derivar el umbral después. count(distinct
-- user_id), nunca count(*): un umbral por impresiones no protege a nadie
-- (una sola persona con 5 impresiones desbloquearía su propia colonia).
-- Totales SIEMPRE se conservan (es dinero, base de #172): colapsar nunca
-- pierde impresiones, solo cambia dónde se ven.
--
-- ── D-RETURN: `void`, no un conteo ──────────────────────────────────────
-- Patrón EXACTO de public.purge_ad_impressions (mismo dominio/migración,
-- mismo job diario): el SUT recalcula/sobreescribe una tabla completa, no
-- inserta filas nuevas contables de forma estable entre corridas -- se
-- verifica leyendo la tabla, nunca el retorno.
--
-- ── Carrera con la purga ─────────────────────────────────────────────────
-- schedule '0 8 * * *' (8:00 UTC = 2:00 CDMX), 1h ANTES de
-- purge_ad_impressions_daily ('0 9 * * *' = 3:00 CDMX). El rollup debe
-- correr sobre el crudo ANTES de que la purga borre nada de lo que ese
-- mismo crudo todavía tiene -- si corrieran en el orden contrario (o
-- simultáneo), una purga que alcanza a ejecutarse primero podría dejar sin
-- agregar impresiones del último día de un mes que cruza la frontera de
-- retención. cron.schedule() con el MISMO jobname actualiza el job
-- existente en vez de duplicarlo (mismo comportamiento verificado
-- empíricamente en 20260817000002) -- la migración es re-aplicable sin
-- generar jobs huérfanos. security definer + revoke/grant explícitos,
-- mismo patrón que purge_ad_impressions (el job de cron corre como
-- postgres, superusuario, bypassa RLS igual; queda invocable de forma
-- segura también fuera del cron). NO se reinstala pg_cron (create extension)
-- -- ya lo instaló 20260817000002/170.5.
--
-- Idempotente: create or replace function, revoke/grant explícitos,
-- cron.schedule idempotente por jobname (confirmado en 20260817000002).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.rollup_ad_impressions_monthly()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_month date;
  -- D-ELEGIBILIDAD: MISMA constante de retención que public.purge_ad_impressions
  -- (20260817000002, `now() - interval '90 days'`) -- ver el comentario
  -- extenso de cabecera. Se calcula UNA vez por corrida (no por fila).
  c_retention_days constant integer := 90;
  v_retention_cutoff constant timestamptz := now() - (c_retention_days || ' days')::interval;
begin
  -- Recalcula únicamente los meses ELEGIBLES presentes en el crudo -- aquellos
  -- cuyo INICIO todavía está dentro de la ventana de retención (D-ELEGIBILIDAD
  -- arriba). Un mes cuyo inicio ya cruzó la frontera se salta por completo,
  -- aun si conserva un remanente de crudo (purga a medias): ese remanente ya
  -- no representa el mes completo y recalcular con él corrompería el
  -- histórico consolidado en corridas previas.
  for v_month in
    select distinct date_trunc('month', ai.shown_at)::date
    from public.ad_impressions ai
    where date_trunc('month', ai.shown_at) >= v_retention_cutoff
    order by 1
  loop
    -- DELETE + INSERT del mes completo (no upsert): garantiza que una zona
    -- que deja de calificar para fila propia (o empieza a calificar) no deja
    -- basura de la corrida anterior. Acotado a year_month = v_month, y solo
    -- para meses que pasaron la compuerta de elegibilidad de arriba -- un mes
    -- no elegible nunca llega a este DELETE.
    delete from public.ad_impressions_monthly where year_month = v_month;

    insert into public.ad_impressions_monthly
      (agency_id, ad_id, municipality_id, neighborhood_id, year_month,
       impressions, views, completions, cta_taps)
    with scoped as (
      select
        ai.agency_id,
        ai.ad_id,
        ai.user_id,
        ai.municipality_id,
        ai.neighborhood_id,
        ai.viewed,
        ai.completed,
        ai.cta_tapped_at
      from public.ad_impressions ai
      where date_trunc('month', ai.shown_at)::date = v_month
    ),
    zone_stats as (
      -- Una fila por (agency_id, ad_id, zona) con sus 4 contadores y el
      -- conteo de usuarios distintos que decide el colapso por k-anonimato.
      select
        s.agency_id,
        s.ad_id,
        s.municipality_id,
        s.neighborhood_id,
        count(*)::integer as impressions,
        count(*) filter (where s.viewed)::integer as views,
        count(*) filter (where s.completed)::integer as completions,
        count(*) filter (where s.cta_tapped_at is not null)::integer as cta_taps,
        count(distinct s.user_id) as distinct_users,
        -- Una "zona real" resolvió al menos uno de los dos campos. El grupo
        -- (NULL, NULL) no es una zona: es la ausencia de zona, y por eso
        -- nunca puede tener fila propia por muchos usuarios que tenga.
        (s.municipality_id is not null or s.neighborhood_id is not null) as is_real_zone
      from scoped s
      group by s.agency_id, s.ad_id, s.municipality_id, s.neighborhood_id
    )
    -- Zonas reales con k-anonimato >= 5 usuarios distintos: fila propia.
    select
      z.agency_id, z.ad_id, z.municipality_id, z.neighborhood_id, v_month,
      z.impressions, z.views, z.completions, z.cta_taps
    from zone_stats z
    where z.is_real_zone and z.distinct_users >= 5

    union all

    -- Bucket (NULL, NULL) por (agency_id, ad_id): funde las zonas reales
    -- colapsadas por privacidad (< 5 usuarios distintos) con las impresiones
    -- que ya nacieron sin zona resuelta -- una sola fila, totales conservados.
    select
      z.agency_id, z.ad_id, null::text, null::bigint, v_month,
      sum(z.impressions)::integer, sum(z.views)::integer,
      sum(z.completions)::integer, sum(z.cta_taps)::integer
    from zone_stats z
    where not z.is_real_zone or z.distinct_users < 5
    group by z.agency_id, z.ad_id
    having sum(z.impressions) is not null;
  end loop;
end;
$$;

comment on function public.rollup_ad_impressions_monthly() is
  'Recalcula public.ad_impressions_monthly desde el crudo (ad_impressions) '
  'para los meses ELEGIBLES (D-ELEGIBILIDAD): aquellos cuyo inicio sigue '
  'dentro de la ventana de retención (90 días, misma constante que '
  'purge_ad_impressions). Un mes NO elegible -- incluyendo uno con un '
  'remanente de crudo tras una purga parcial -- se deja INTACTO, ni delete '
  'ni insert; su último valor consolidado (calculado mientras SÍ fue '
  'elegible) es el valor correcto y completo. Por mes elegible: DELETE + '
  'INSERT completo (no upsert) -- una zona que deja de calificar para fila '
  'propia no deja basura. k-anonimato AL AGREGAR, misma semántica que '
  'ad_metrics_for_agency: count(distinct user_id) >= 5 decide si una zona '
  'real se desglosa; el resto (zonas colapsadas + impresiones sin zona) se '
  'funde en la fila (NULL, NULL) del mes. Totales siempre se conservan. '
  'Programada diario vía pg_cron (jobname rollup_ad_impressions_monthly_daily, '
  '0 8 * * * UTC), 1h ANTES de purge_ad_impressions_daily (0 9 * * * UTC) -- '
  'corre sobre el crudo antes de que la purga borre nada.';

revoke execute on function public.rollup_ad_impressions_monthly() from public, anon, authenticated;
grant execute on function public.rollup_ad_impressions_monthly() to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- pg_cron — job propio, ANTES de purge_ad_impressions_daily. La extensión ya
-- está instalada por 20260817000002/170.5 (NO create extension aquí).
-- ════════════════════════════════════════════════════════════════════════════

select cron.schedule(
  'rollup_ad_impressions_monthly_daily',
  '0 8 * * *',
  'select public.rollup_ad_impressions_monthly();'
);
