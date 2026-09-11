-- Rollback: 20260910200001_comment_reports.sql (subtarea 289.3, tarea #289).
-- Deshace, en orden inverso: grants/RPC -> policies -> grants de tabla -> trigger/función de
-- auto-ocultar -> tabla comment_reports. 20260910200001 es la ÚNICA migración que crea estos
-- objetos.
--
-- 🔴 POR QUÉ UN DROP DE TABLA Y NO DEJARLA A MEDIAS (mismo criterio que
-- 20260828000005_user_reports.sql / 20260910100001_comments.sql): un rollback que solo
-- quitara policies/grants pero dejara comment_reports existiendo con RLS enabled quedaría
-- deny-total (errores de permiso confusos) en vez de fallar ruidoso con 42P01 "relation does
-- not exist" -- el comportamiento correcto ante un rollback: visible, no silencioso.
--
-- admin_actions.action_type es TEXT libre SIN CHECK (verificado contra
-- 20260604000007_analytics_moderation_audit.sql) -- esta migración nunca lo ensanchó, así
-- que este rollback no tiene nada que restaurar ahí: los 3 literales nuevos
-- (comment_restore/comment_keep_hidden/comment_delete) simplemente dejan de insertarse una
-- vez que resolve_comment_reports_atomic se dropea.
--
-- No toca public.comments, public.comment_status, private.is_admin() ni
-- private.is_property_comment_manager (289.2 / 0010) -- ajenos a este footprint.
--
-- Idempotente: `if exists` en todo. Aditivo y sin datos reales de producción en
-- comment_reports (tabla nueva, aún no desplegada) -- el DROP no arriesga nada vivo (§0.5).
--
-- Ruidoso a propósito (RAISE NOTICE por paso): visibilidad de qué se revirtió al correrlo
-- manualmente contra el stack local.

do $$
begin
  raise notice '[rollback 289.3] revirtiendo resolve_comment_reports_atomic (grants + función)...';
end $$;

revoke execute on function public.resolve_comment_reports_atomic(uuid, text, text) from authenticated;
drop function if exists public.resolve_comment_reports_atomic(uuid, text, text);

do $$
begin
  raise notice '[rollback 289.3] revirtiendo comment_reports: grants/policies/RLS...';
end $$;

revoke all on public.comment_reports from anon, authenticated;

drop policy if exists comment_reports_select on public.comment_reports;
drop policy if exists comment_reports_insert on public.comment_reports;

do $$
begin
  raise notice '[rollback 289.3] eliminando trigger/función de auto-ocultar...';
end $$;
drop trigger if exists comment_reports_autohide on public.comment_reports;
drop function if exists public.check_comment_reports_autohide();

do $$
begin
  raise notice '[rollback 289.3] eliminando public.comment_reports (DROP completo, ver nota de cabecera)...';
end $$;
drop table if exists public.comment_reports;
