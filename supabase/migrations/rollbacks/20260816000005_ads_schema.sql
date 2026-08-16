-- Rollback: 20260816000005_ads_schema.sql
-- Elimina las 4 tablas nuevas (ad_zones -> ads -> ad_creatives por FK, ad_prices
-- independiente) y los 4 enums nuevos. Reversible por completo: son objetos
-- 100% nuevos de esta migración, ningún otro objeto del esquema depende de
-- ellos todavía (las tareas 169.2/169.3/170.x/171.1 que sí dependerán deben
-- revertirse ANTES que esta).

drop table if exists public.ad_zones;
drop table if exists public.ads;
drop table if exists public.ad_creatives;
drop table if exists public.ad_prices;

drop type if exists public.ad_zone_scope;
drop type if exists public.ad_cta_type;
drop type if exists public.ad_status;
drop type if exists public.ad_creative_status;
