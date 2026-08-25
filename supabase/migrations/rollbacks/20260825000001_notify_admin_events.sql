-- Rollback: 20260825000001_notify_admin_events.sql (subtarea #219.1)
-- Desprograma el job de pg_cron PRIMERO (un job huérfano apuntando a una
-- función que ya no existe fallaría en silencio cada día a las 11:00 UTC),
-- luego quita los 4 triggers (y sus funciones), los 3 índices únicos de
-- idempotencia y public.purge_notifications(). NO se desinstala la extensión
-- pg_cron ni se tocan los jobs rollup_ad_impressions_monthly_daily/
-- purge_ad_impressions_daily/notify_ads_expiring_soon_daily: son
-- infraestructura compartida, otros jobs dependen de ella. NO se toca
-- public.notifications (20260604000007) ni public.handle_ad_status_change
-- (20260816000006) -- son objetos preexistentes que esta migración solo
-- escribe/extiende con triggers nuevos, nunca creó ni alteró su definición.
-- Reversible por completo: todo lo que se quita abajo es 100% nuevo de esta
-- migración.

select cron.unschedule('purge_notifications_daily')
where exists (select 1 from cron.job where jobname = 'purge_notifications_daily');

drop function if exists public.purge_notifications();

drop trigger if exists property_revisions_notify_admin_resubmit on public.property_revisions;
drop trigger if exists property_revisions_notify_admin_insert on public.property_revisions;
drop function if exists public.notify_admin_revision_pending();

drop trigger if exists agent_applications_notify_admin_pending on public.agent_applications;
drop function if exists public.notify_admin_agent_application();

drop trigger if exists agencies_notify_admin_pending on public.agencies;
drop function if exists public.notify_admin_agency_pending();

drop trigger if exists ads_notify_admin_pending on public.ads;
drop function if exists public.notify_admin_ad_pending();

drop index if exists public.notifications_admin_agent_application_anchor_idx;
drop index if exists public.notifications_admin_agency_pending_anchor_idx;
drop index if exists public.notifications_admin_ad_pending_anchor_idx;
