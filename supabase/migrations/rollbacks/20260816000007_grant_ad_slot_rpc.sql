-- Rollback de 20260816000007_grant_ad_slot_rpc.sql (subtarea #169.3)
-- Nota: la siembra de app_config.ads_free NO se revierte por DELETE -- mismo
-- criterio que el resto del repo con seeds (video_slot_free nunca se borra en
-- ningún rollback existente): en producción viva un DELETE sobre una fila que
-- ya pudo leerse/usarse es más riesgoso que dejarla huérfana tras el rollback
-- de la función. Si hace falta revertir el seed, es un UPDATE/DELETE manual
-- explícito, no parte de este rollback automático.

revoke execute on function public.grant_ad_slot_atomic(uuid, uuid, text, ad_cta_type, text, jsonb, int)
  from service_role;

drop function if exists public.grant_ad_slot_atomic(uuid, uuid, text, ad_cta_type, text, jsonb, int);
