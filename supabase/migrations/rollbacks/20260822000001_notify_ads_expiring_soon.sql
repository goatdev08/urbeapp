-- Rollback: 20260822000001_notify_ads_expiring_soon.sql (subtarea #171.4)
-- Desprograma el job de pg_cron PRIMERO (un job huérfano apuntando a una
-- función que ya no existe fallaría en silencio cada día a las 9am CDMX),
-- luego quita la función y el índice único de idempotencia. NO se desinstala
-- la extensión pg_cron ni se toca el job purge_ad_impressions_daily (170.5):
-- es infraestructura compartida, otros jobs pueden depender de ella.
-- public.notifications (20260604000007) NO se toca -- es una tabla
-- preexistente que esta migración solo escribe, nunca creó ni alteró.
-- Reversible por completo: función, índice y job son 100% nuevos de esta
-- migración.

select cron.unschedule('notify_ads_expiring_soon_daily')
where exists (select 1 from cron.job where jobname = 'notify_ads_expiring_soon_daily');

drop function if exists public.notify_ads_expiring_soon();

drop index if exists public.notifications_ad_expiring_soon_anchor_idx;
