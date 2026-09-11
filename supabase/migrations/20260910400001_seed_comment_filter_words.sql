-- Migración 20260910400001 — Semilla de app_config.comment_filter_words (subtarea
-- 289.5, tarea #289). El ConfigReader de la Edge Function post-comment lee esta key
-- (jsonb array de strings) para calibrar el filtro determinista sin publicar app
-- (patrón #266: video_slot_free/ads_enabled) — fail-open en el lector si la key
-- faltara (post-comment/types.ts), pero la key debe existir sembrada por default.
--
-- 🔴 PRODUCCIÓN VIVA (§0.5): aditivo puro, sin riesgo.
--   · Una sola fila nueva en una tabla ya existente (app_config, 20260720000001).
--   · Semántica `on conflict (key) do nothing` (NUNCA `do update`, calco de
--     video_slot_free/ads_enabled/ads_free): un `do update` resetearía a mano una
--     lista que un admin ya haya editado cada vez que esta migración se re-aplicara.
--   · Régimen fail-closed YA VIGENTE de TODA la tabla desde 20260720000001 (anon sin
--     grant, authenticated gateado por private.is_admin()) — esta migración no toca
--     RLS ni grants, solo agrega la fila.
--
-- Tests: supabase/tests/114_comment_filter_words_seed_test.sql (6 asserts).
-- Rollback: supabase/migrations/rollbacks/20260910400001_seed_comment_filter_words.sql

insert into public.app_config (key, value) values
  ('comment_filter_words', '[]'::jsonb)
on conflict (key) do nothing;
