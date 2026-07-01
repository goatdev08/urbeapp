-- Rollback: 20260701000001_engagement_count_triggers.sql
-- Deshace los triggers y funciones de contadores denormalizados (like_count / save_count).
-- Nota: NO se restablecen los contadores a 0 para no perder información.
--       Si se requiere un reset manual, ejecutar por separado:
--         UPDATE public.properties SET like_count = 0, save_count = 0;

drop trigger if exists trg_like_count on public.likes;
drop trigger if exists trg_save_count on public.saves;

drop function if exists public.update_like_count();
drop function if exists public.update_save_count();
