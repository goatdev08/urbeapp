-- Rollback: 20260808000001_events_raw_rls.sql
-- Restaura public.events_raw al estado "solo service_role" de 20260604000007/000008:
-- quita las 2 policies nuevas, revoca el grant a authenticated y elimina los 2 índices
-- nuevos. NO toca los índices de 20260604000007/000010 (type/property/user/created/
-- agent/video) -- esos no los creó esta migración.
-- Nota: no hay datos que revertir -- esta migración no escribió filas, solo permisos.

drop policy if exists events_raw_select on public.events_raw;
drop policy if exists events_raw_insert on public.events_raw;

revoke insert, select on public.events_raw from authenticated;

drop index if exists public.events_raw_property_event_type_idx;
drop index if exists public.events_raw_user_property_idx;
