-- Migración 20260817000001 — Kill-switch de publicidad en el feed: siembra de
-- app_config + RPC public.ads_feed_config() (subtarea #170.1, exploración 039
-- "Tarea C"). ES LA PRIMERA MIGRACIÓN DE LA TAREA 170 A PROPÓSITO: la vía de
-- escape (ads_enabled) existe ANTES de que una sola línea de publicidad llegue
-- al feed.
--
-- Contrato completo (firma, edge cases, invariantes 🔒): ver cabecera de
-- supabase/tests/50_ads_feed_config_test.sql (RED, 2026-08-17).
--
-- ── 1) Siembra: 3 claves nuevas en app_config, naming CANÓNICO fijado por el
--    plan de #170.1 (NO los alias "ads_every_n"/"ads_session_cap" de la tarea
--    padre) ─────────────────────────────────────────────────────────────────
-- 🔴 ads_enabled nace en FALSE -- kill-switch APAGADO por defecto. Sembrarlo
--    en true encendería publicidad en producción viva el día del deploy.
-- Semántica `on conflict (key) do nothing` (NUNCA `do update`, calco de
-- video_slot_free / ads_free): un `do update` resetearía a mano un flip que
-- un operador ya hizo cada vez que esta migración se re-aplicara -- bug
-- operativo grave, no un detalle de estilo.
insert into public.app_config (key, value) values
  ('ads_enabled',        'false'::jsonb),
  ('ad_frequency_n',     '8'::jsonb),
  ('ad_max_per_session', '5'::jsonb)
on conflict (key) do nothing;

-- ── 2) RPC public.ads_feed_config() — ventana mínima y auditada a app_config
--    ────────────────────────────────────────────────────────────────────────
-- Existe porque app_config es fail-closed TAMBIÉN para el cliente
-- (20260720000001_stream_schema.sql:59-67: revoke all from anon,authenticated
-- + grant select a authenticated, pero la ÚNICA policy es
-- app_config_admin_select ⇒ un authenticated normal lee 0 filas de la tabla
-- directo). SECURITY DEFINER + search_path fijo (patrón de
-- grant_ad_slot_atomic, 20260816000007) para leer la tabla saltándose esa
-- policy sin exponerla completa: SOLO devuelve estas 3 columnas, nunca
-- ads_free, signed_url_ttl_seconds, video_slot_free ni
-- archived_retention_days.
--
-- Default seguro por columna vía COALESCE: si una key faltara en app_config
-- (borrada a mano), la función NO lanza -- simplemente no encuentra fila,
-- COALESCE cae al literal de la derecha. Fail-closed, nunca fail-open: el
-- modo degradado de un kill-switch es "apagado" (ads_enabled -> false).
-- ad_frequency_n/ad_max_per_session caen a los mismos defaults que la siembra
-- (8/5) por consistencia, aunque solo ads_enabled tiene lectura de seguridad.
create or replace function public.ads_feed_config()
returns table(ads_enabled boolean, ad_frequency_n integer, ad_max_per_session integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce((select (value)::boolean from public.app_config where key = 'ads_enabled'), false),
    coalesce((select (value)::integer from public.app_config where key = 'ad_frequency_n'), 8),
    coalesce((select (value)::integer from public.app_config where key = 'ad_max_per_session'), 5);
$$;

comment on function public.ads_feed_config() is
  'Kill-switch de publicidad en el feed (subtarea #170.1): ventana mínima y '
  'auditada a app_config para authenticated -- app_config es fail-closed '
  'también para el cliente (única policy = app_config_admin_select), esta '
  'RPC SECURITY DEFINER expone SOLO ads_enabled/ad_frequency_n/'
  'ad_max_per_session, nunca otra key. Default seguro por COALESCE si falta '
  'una key: fail-closed (ads_enabled=false), nunca fail-open. El flip de '
  'ads_enabled se lee en runtime -- no requiere publicar app ni OTA.';

-- Fail-closed con dientes (patrón 20260816000008/20260809000004): Postgres
-- otorga EXECUTE a PUBLIC por default al crear la función -- revoke
-- explícito antes del grant mínimo. A diferencia de org_can_advertise
-- (service_role-only), esta RPC SÍ es para el cliente: authenticated la
-- necesita para saber si debe llamar a ads_for_zone/record-ad-impressions.
revoke execute on function public.ads_feed_config() from public, anon, authenticated;
grant execute on function public.ads_feed_config() to authenticated;
