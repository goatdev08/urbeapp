-- Rollback 0010
-- NOTA: este rollback deja las políticas RLS sin sus helpers. Para restaurar el estado previo
-- (helpers en public + políticas apuntando a public.*) se debe RE-APLICAR la migración 0008
-- después de correr este rollback.

-- Drop schema private (cascade elimina los helpers y las políticas que dependen de ellos)
drop schema if exists private cascade;

-- Quitar índices de FK agregados
drop index if exists public.agencies_approved_by_idx;
drop index if exists public.agency_tokens_created_by_idx;
drop index if exists public.agency_members_token_idx;
drop index if exists public.agent_app_token_idx;
drop index if exists public.agent_app_reviewer_idx;
drop index if exists public.events_raw_agent_idx;
drop index if exists public.events_raw_video_idx;
drop index if exists public.lead_origin_video_idx;
drop index if exists public.likes_video_idx;
drop index if exists public.property_reports_reporter_idx;
drop index if exists public.property_reports_reviewer_idx;

-- Restaurar EXECUTE de los trigger functions (estado previo)
grant execute on function public.set_updated_at()                      to public;
grant execute on function public.handle_new_user()                     to public;
grant execute on function public.enforce_max_videos_per_property()     to public;
grant execute on function public.cascade_soft_delete_property_videos() to public;

-- Después de esto, re-aplicar 0008 para recrear helpers públicos y políticas.
