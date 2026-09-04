-- ROLLBACK de 20260905200002_notify_admin_advertising_request (#246).
-- Quita el 5º escritor del catálogo admin: la solicitud de cuenta comercial
-- vuelve a NO avisar a nadie. Orden inverso al de la migración (primero el
-- trigger, que depende de la función).
-- No borra las notificaciones ya escritas: son avisos reales que los admins
-- ya vieron en su campana; borrarlas sería reescribir su bandeja. Si hiciera
-- falta limpiarlas, es una decisión aparte y explícita
--   (delete from public.notifications where type = 'admin_advertising_request_pending';)
-- deliberadamente NO ejecutada aquí.
-- Idempotente: los tres DROP llevan `if exists`.

drop trigger if exists advertising_requests_notify_admin_pending on public.advertising_requests;

drop function if exists public.notify_admin_advertising_request_pending();

drop index if exists public.notifications_admin_advertising_request_anchor_idx;
