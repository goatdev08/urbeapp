-- Rollback: 20260817000002_ad_impressions.sql (subtarea #170.5)
-- Desprograma el job de pg_cron PRIMERO (un job huérfano apuntando a una
-- función que ya no existe fallaría en silencio cada día a las 3am), luego
-- quita la función y las 2 tablas nuevas. NO se desinstala la extensión
-- pg_cron: es infraestructura compartida que 171.4 (aviso de expiración) y
-- la tarea 87 (limpieza de R2 archive/) reutilizarán -- desinstalarla
-- afectaría a cualquier otro job que ya se haya programado sobre ella.
-- Reversible por completo: son objetos 100% nuevos de esta migración, nada
-- más del esquema depende de ellos todavía (la tarea 171 que sí dependerá
-- debe revertirse ANTES que esta).

select cron.unschedule('purge_ad_impressions_daily')
where exists (select 1 from cron.job where jobname = 'purge_ad_impressions_daily');

drop function if exists public.purge_ad_impressions();

drop table if exists public.ad_impressions_monthly;
drop table if exists public.ad_impressions;
