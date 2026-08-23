-- Rollback: 20260823000004_rollup_ad_impressions_monthly.sql (subtarea #201.1)
-- Desprograma el job de pg_cron PRIMERO (un job huérfano apuntando a una
-- función que ya no existe fallaría en silencio cada día a las 8am UTC),
-- luego quita la función. NO se desinstala pg_cron (compartida con
-- purge_ad_impressions_daily y otros jobs futuros -- misma razón que el
-- rollback de 20260817000002). NO se toca ninguna tabla: ad_impressions y
-- ad_impressions_monthly son de 20260817000002, esta migración es puramente
-- aditiva (función + job) sobre tablas que ya existían.

select cron.unschedule('rollup_ad_impressions_monthly_daily')
where exists (select 1 from cron.job where jobname = 'rollup_ad_impressions_monthly_daily');

drop function if exists public.rollup_ad_impressions_monthly();
