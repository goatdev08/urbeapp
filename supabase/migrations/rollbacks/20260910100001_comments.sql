-- Rollback: 20260910100001_comments.sql (subtarea 289.2, tarea #289).
-- Deshace, en orden inverso: grants -> policies -> RLS -> helper -> trigger/función de
-- conteo -> properties.comment_count -> índice -> tabla comments -> enum comment_status.
-- 20260910100001 es la ÚNICA migración que crea estos objetos.
--
-- 🔴 POR QUÉ UN DROP DE TABLA Y NO DEJARLA A MEDIAS (mismo criterio que
-- 20260828000005_user_reports.sql): un rollback que solo quitara policies/grants pero
-- dejara comments existiendo con RLS enabled quedaría deny-total (errores de permiso
-- confusos) en vez de fallar ruidoso con 42P01 "relation does not exist" -- el
-- comportamiento correcto ante un rollback: visible, no silencioso.
--
-- Nota (mismo criterio que 20260701000001/20260807000004): NO se resetea
-- properties.comment_count a 0 antes de dropear la columna -- se pierde junto con la
-- columna, no hace falta un UPDATE previo.
--
-- Idempotente: `if exists` en todo. Aditivo hasta que 289.2 despliegue -- sin datos reales
-- de producción en comments todavía, así que el DROP no arriesga nada vivo (§0.5).
--
-- Ruidoso a propósito (RAISE NOTICE por paso): visibilidad de qué se revirtió al correrlo
-- manualmente contra el stack local.

do $$
begin
  raise notice '[rollback 289.2] revirtiendo comments: grants/policies/RLS...';
end $$;

revoke all on public.comments from anon, authenticated;

drop policy if exists comments_update on public.comments;
drop policy if exists comments_select on public.comments;

do $$
begin
  raise notice '[rollback 289.2] eliminando helper private.is_property_comment_manager...';
end $$;
drop function if exists private.is_property_comment_manager(uuid);

do $$
begin
  raise notice '[rollback 289.2] eliminando trigger/función de comment_count...';
end $$;
drop trigger if exists trg_comment_count on public.comments;
drop function if exists public.update_comment_count();

do $$
begin
  raise notice '[rollback 289.2] eliminando properties.comment_count (se pierde el conteo)...';
end $$;
alter table public.properties
  drop column if exists comment_count;

do $$
begin
  raise notice '[rollback 289.2] eliminando public.comments (DROP completo, ver nota de cabecera)...';
end $$;
drop table if exists public.comments;

-- El enum solo se elimina si ninguna otra columna/tabla lo usa (DROP explícito, sin
-- efecto si algo más lo referencia -- mismo criterio que 20260807000004/lead_temperature).
do $$
begin
  raise notice '[rollback 289.2] eliminando enum public.comment_status (no-op si algo más lo usa)...';
end $$;
drop type if exists public.comment_status;
