-- Migración 20260901000002 — tarea #230: el CHECK de duración de ad_creatives
-- seguía en 6–30 y REVENTABA el webhook en producción.
-- Rollback: supabase/migrations/rollbacks/20260901000002_ad_creatives_duration_check_10_120.sql
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL BUG (logs de producción, 2026-09-01 03:19–03:23Z): #228 subió el rango de
-- duración de anuncios a 10–120 s en TRES capas (cliente, mint-ad-upload-url,
-- stream-webhook)… y esta era la CUARTA: el CHECK de columna de la migración
-- 20260816000005:68 (`between 6 and 30`). Un video de >30 s subía al 100%,
-- Stream lo transcodificaba, Cloudflare entregaba el webhook y mark_ready
-- moría con `violates check constraint "ad_creatives_duration_seconds_check"`
-- → 500 → reintento de Cloudflare → 500… El creativo quedaba 'uploading' para
-- siempre y el wizard clavado en "procesando video".
--
-- POR QUÉ NINGÚN TEST LO VIO: la suite Deno del webhook mockea el updater
-- (jamás toca el CHECK real) y ningún pgTAP anclaba los límites del CHECK a
-- las constantes del webhook. Ese ancla llega con esta migración
-- (supabase/tests/78_ad_creatives_duration_check_test.sql).
--
-- ADITIVA y compatible (§0.5): solo AMPLÍA lo que la columna acepta; ninguna
-- fila existente viola el rango nuevo (solo hay NULL y valores 6–30 anteriores
-- al cambio de producto — y BETWEEN 10 AND 120 admite los 10–30 ya escritos;
-- filas históricas 6–9 s: no existen en producción, y en local el rango viejo
-- solo produjo NULLs). MISMO nombre de constraint. Idempotente.
-- Al aplicarla, el reintento pendiente de Cloudflare marca solo el creativo
-- atorado (35737117…) — no hace falta tocar la fila a mano.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.ad_creatives
  drop constraint if exists ad_creatives_duration_seconds_check;

alter table public.ad_creatives
  add constraint ad_creatives_duration_seconds_check
  check (duration_seconds is null or duration_seconds between 10 and 120);

comment on column public.ad_creatives.duration_seconds is
  'Duración real reportada por el webhook de Stream (segundos, entera). '
  'CHECK espejo del rango de producto [10,120] (#228/#230 — MISMO rango que '
  'propiedades; antes 6–30). NULL mientras el creativo no llega a ready. '
  '⚠️ Cuatro capas comparten este rango: ads/lib/validation.ts (cliente), '
  'mint-ad-upload-url (maxDurationSeconds), stream-webhook (AD_MIN/AD_MAX) y '
  'este CHECK — anclado por supabase/tests/78_ad_creatives_duration_check_test.sql.';
