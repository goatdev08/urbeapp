-- ROLLBACK de 20260914100002_notify_new_follower (subtarea 78.2).
-- Quita el aviso new_follower: seguir a alguien vuelve a NO generar notificación.
-- No borra las notificaciones ya escritas: son avisos reales que los usuarios ya
-- pudieron haber visto en su campana; borrarlas sería reescribir su bandeja. Si hiciera
-- falta limpiarlas, es una decisión aparte y explícita
--   (delete from public.notifications where type = 'new_follower';)
-- deliberadamente NO ejecutada aquí.
-- Idempotente: los DROP llevan `if exists`.

drop trigger if exists follows_notify_new_follower on public.follows;
drop function if exists public.notify_new_follower();
