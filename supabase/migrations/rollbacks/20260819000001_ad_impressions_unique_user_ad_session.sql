-- Rollback: 20260819000001_ad_impressions_unique_user_ad_session.sql (subtarea #170.6)
-- La constraint es 100% nueva (sin versión previa que restaurar) — drop basta.
-- Re-ejecutable (if exists).

alter table public.ad_impressions
  drop constraint if exists ad_impressions_user_ad_session_key;
