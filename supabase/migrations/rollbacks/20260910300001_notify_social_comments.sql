-- ROLLBACK de 20260910300001_notify_social_comments (subtarea 289.4).
-- Quita los 3 escritores de notificaciones sociales de comentarios:
-- comment_on_my_property, comment_hidden, admin_comment_report vuelven a NO avisar a
-- nadie. Orden inverso al de la migración (primero cada trigger, que depende de su
-- función, luego la función, y al final el índice de dedupe).
-- No borra las notificaciones ya escritas: son avisos reales que los usuarios ya vieron
-- en su campana; borrarlas sería reescribir su bandeja. Si hiciera falta limpiarlas, es
-- una decisión aparte y explícita
--   (delete from public.notifications where type in
--     ('comment_on_my_property', 'comment_hidden', 'admin_comment_report');)
-- deliberadamente NO ejecutada aquí.
-- Idempotente: todos los DROP llevan `if exists`.

drop trigger if exists comment_reports_notify_admin on public.comment_reports;
drop function if exists public.notify_admin_comment_report();

drop trigger if exists comments_notify_hidden on public.comments;
drop function if exists public.notify_comment_hidden();

drop trigger if exists comments_notify_on_my_property on public.comments;
drop function if exists public.notify_comment_on_my_property();

drop index if exists public.notifications_comment_on_my_property_anchor_idx;
