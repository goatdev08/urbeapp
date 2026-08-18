-- Rollback de 20260817000001_ads_feed_config.sql (subtarea #170.1)
-- Nota: la siembra de app_config (ads_enabled/ad_frequency_n/ad_max_per_session)
-- NO se revierte por DELETE -- mismo criterio que el resto del repo con seeds
-- (video_slot_free/ads_free nunca se borran en ningún rollback existente): en
-- producción viva un DELETE sobre filas que ya pudieron leerse/usarse es más
-- riesgoso que dejarlas huérfanas tras el rollback de la RPC. Si hace falta
-- revertir el seed, es un UPDATE/DELETE manual explícito, no parte de este
-- rollback automático.

revoke execute on function public.ads_feed_config() from authenticated;

drop function if exists public.ads_feed_config();
