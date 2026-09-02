-- Rollback: 20260904300001_rollup_monitor.sql (tarea #215)
-- Desprograma el job de pg_cron PRIMERO (un job huérfano apuntando a una
-- función que ya no existe fallaría en silencio cada día a las 10am UTC),
-- luego quita la función y su índice ancla. NO se desinstala pg_cron
-- (compartida con purge_ad_impressions_daily, rollup_ad_impressions_monthly_
-- daily, purge_notifications_daily y notify_ads_expiring_soon_daily -- misma
-- razón que el rollback de 20260823000004). NO se toca ninguna tabla:
-- public.notifications es de 20260604000007 y esta migración es puramente
-- aditiva (índice + función + job).
--
-- ⚠️ Las notificaciones ya escritas (type='admin_rollup_unhealthy') NO se
-- borran: son avisos reales que un admin pudo haber leído, y borrarlas sería
-- destructivo. Quedan como filas inertes que purge_notifications() limpia a
-- los 30 días por su cuenta.

select cron.unschedule('check_rollup_health_daily')
where exists (select 1 from cron.job where jobname = 'check_rollup_health_daily');

drop function if exists public.check_rollup_health();

drop index if exists public.notifications_admin_rollup_unhealthy_anchor_idx;
